import { open, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { findTranscript } from "../host/agent-transcripts";
import { agentSessionSchema, type AgentSession } from "../shared/saved-review";

/** The first bytes of a transcript, where the agent records its directory. */
async function head(path: string, bytes = 64 * 1024) {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}
/** The complete lines of the last `bytes` of a transcript. */
async function tail(path: string, bytes = 256 * 1024) {
  const handle = await open(path, "r");
  try {
    const { size } = await handle.stat();
    const start = Math.max(0, size - bytes);
    const buffer = Buffer.alloc(size - start);
    await handle.read(buffer, 0, buffer.length, start);
    const from = start > 0 ? buffer.indexOf(10) + 1 : 0;
    return buffer.toString("utf8", from).split("\n");
  } finally {
    await handle.close();
  }
}
const firstCwd = (text: string) => {
  const match = /"cwd":("(?:[^"\\]|\\.)*")/.exec(text);
  if (!match) return undefined;
  try {
    return JSON.parse(match[1]!) as string;
  } catch {
    return undefined;
  }
};

/** The directory a session started in, from the start of its transcript. */
async function sessionDirectory(entry: Pick<AgentSession, "agent" | "id">, home: string) {
  const path = await findTranscript(entry, home);
  return path ? firstCwd(await head(path).catch(() => "")) : undefined;
}

/** A subagent whose transcript changed this recently may run the command. */
const LIVE_MS = 30 * 60_000;
/** A background command's call gets its result at once; a call this recent
 * still counts as the one that runs. */
const RECENT_MS = 20_000;
/** Claude Code writes a call to the transcript as its tool starts (about
 * 60 ms in Claude Code 2.1); a lookup waits this long for it. */
const FLUSH_MS = 1500;

/**
 * Whether a transcript's newest lines hold a call of a command that matches
 * `command` and runs now: it has no result yet, or it is recent. `own` is a
 * call of the session itself; `side`, of a subagent (`isSidechain`), as in
 * a subagent's own transcript.
 */
async function callsCommand(path: string, command: RegExp, now: number) {
  const lines = await tail(path).catch(() => [] as string[]);
  const calls = new Map<string, { at: number; side: boolean }>();
  const results = new Set<string>();
  for (const line of lines) {
    if (!line.includes('"tool_use"') && !line.includes('"tool_result"')) continue;
    let entry: { timestamp?: unknown; isSidechain?: unknown; message?: { content?: unknown } };
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content as Record<string, unknown>[]) {
      const input = block.input as { command?: unknown } | undefined;
      if (
        block.type === "tool_use" &&
        typeof block.id === "string" &&
        typeof input?.command === "string" &&
        command.test(input.command)
      )
        calls.set(block.id, {
          at: Date.parse(String(entry.timestamp)),
          side: entry.isSidechain === true,
        });
      else if (block.type === "tool_result" && typeof block.tool_use_id === "string")
        results.add(block.tool_use_id);
    }
  }
  const running = [...calls].filter(([id, call]) => !results.has(id) || now - call.at < RECENT_MS);
  return {
    own: running.some(([, call]) => !call.side),
    side: running.some(([, call]) => call.side),
  };
}

/** The transcripts of a session's subagents that changed in the last LIVE_MS. */
async function liveSubagents(folder: string, now: number) {
  const names = await readdir(folder).catch(() => [] as string[]);
  const live: string[] = [];
  for (const name of names) {
    if (!/^agent-[\w-]+\.jsonl$/.test(name)) continue;
    const info = await stat(join(folder, name)).catch(() => undefined);
    if (info && now - info.mtimeMs < LIVE_MS) live.push(join(folder, name));
  }
  return live;
}

/**
 * Which agent of a Claude Code session runs this command: the session
 * itself, one of its subagents, or "unknown". A subagent has its parent's
 * CLAUDE_CODE_SESSION_ID, so the environment cannot tell them apart. Claude
 * Code keeps a subagent's work in `<session>/subagents/agent-<id>.jsonl`
 * and writes each tool call before the tool runs: the transcript with this
 * command's call is the caller's. Without live subagents, it is the session.
 */
export async function claudeCaller(
  id: string,
  command: RegExp,
  options: { home?: string; now?: () => number; wait?: number } = {},
): Promise<"session" | "subagent" | "unknown"> {
  const now = options.now ?? Date.now;
  const main = await findTranscript({ agent: "claude", id }, options.home);
  if (!main) return "session";
  const folder = join(dirname(main), id, "subagents");
  const deadline = Date.now() + (options.wait ?? FLUSH_MS);
  for (;;) {
    const live = await liveSubagents(folder, now());
    const found = await Promise.all(
      [main, ...live].map((path) => callsCommand(path, command, now())),
    );
    const own = found.some((entry) => entry.own);
    const side = found.some((entry) => entry.side);
    if (!live.length && !side) return "session";
    if (own !== side) return own ? "session" : "subagent";
    if ((own && side) || Date.now() >= deadline) return "unknown";
    await delay(100);
  }
}

/** Why Med did not record the Claude Code session that runs a command. */
export function callerNote(caller: "subagent" | "unknown", id: string) {
  return caller === "subagent"
    ? `Session: this command runs in a subagent of Claude Code session ${id}. A subagent has its parent's session ID, and Med cannot show a subagent's own thread, so Med recorded no session: the review's Session pane would show the parent's chat. Give the review link to your parent agent.`
    : `Session: Claude Code session ${id} has subagents at work, and Med could not tell which agent runs this command, so Med recorded no session. If the session itself runs it, add --session claude:${id}.`;
}

/**
 * The sessions to record with a review: each `agent:id` given with --session,
 * and the Claude Code session that runs this command, unless turned off or
 * the command runs in one of its subagents (`note` says so). `detected` is
 * the running session, when Med recorded it.
 */
export async function agentSessions(
  values: string[] = [],
  options: {
    environment?: NodeJS.ProcessEnv;
    detect?: boolean;
    home?: string;
    /** The command's words, such as "review create", to find its call. */
    command?: string;
  } = {},
): Promise<{
  sessions: AgentSession[];
  detected?: string;
  note?: string;
  /** A subagent runs the command, or Med cannot tell. */
  caller?: "subagent" | "unknown";
}> {
  const environment = options.environment ?? process.env;
  const home = options.home ?? homedir();
  const wanted: { agent: AgentSession["agent"]; id: string }[] = [];
  for (const value of values) {
    const match = /^(claude|codex):(.+)$/.exec(value.trim());
    if (!match)
      throw new Error("Use --session claude:<session-id> or --session codex:<session-id>.");
    wanted.push({ agent: match[1] as AgentSession["agent"], id: match[2]! });
  }
  const running = environment.CLAUDE_CODE_SESSION_ID;
  const named = !!running && wanted.some((entry) => entry.id === running);
  let detected: string | undefined;
  let note: string | undefined;
  let caller: Awaited<ReturnType<typeof claudeCaller>> | undefined;
  // A session named with --session is recorded; it is the caller's only when
  // the session itself, not one of its subagents, runs the command.
  if (running && (options.detect !== false || named)) {
    const words = (options.command ?? "review").trim().split(/\s+/).map(escape).join("\\s+");
    caller = await claudeCaller(running, new RegExp(`\\b${words}\\b`), { home });
    if (caller === "session") {
      if (!named) wanted.push({ agent: "claude", id: running });
      detected = running;
    } else if (!named) note = callerNote(caller, running);
  }
  const sessions: AgentSession[] = [];
  for (const entry of wanted) {
    const cwd = (await sessionDirectory(entry, home)) ?? process.cwd();
    const parsed = agentSessionSchema.safeParse({ ...entry, cwd });
    if (!parsed.success) throw new Error(`Invalid session: ${parsed.error.issues[0]!.message}`);
    sessions.push(parsed.data);
  }
  return {
    sessions,
    ...(detected && { detected }),
    ...(note && { note }),
    ...(caller && caller !== "session" && { caller }),
  };
}
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
