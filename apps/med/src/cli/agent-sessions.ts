import { open } from "node:fs/promises";
import { homedir } from "node:os";
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

/**
 * The sessions to record with a review: each `agent:id` given with --session,
 * and the Claude Code session that runs this command, unless turned off.
 */
export async function agentSessions(
  values: string[] = [],
  options: { environment?: NodeJS.ProcessEnv; detect?: boolean; home?: string } = {},
): Promise<AgentSession[]> {
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
  if (options.detect !== false && running && !wanted.some((entry) => entry.id === running))
    wanted.push({ agent: "claude", id: running });
  const sessions: AgentSession[] = [];
  for (const entry of wanted) {
    const cwd = (await sessionDirectory(entry, home)) ?? process.cwd();
    const parsed = agentSessionSchema.safeParse({ ...entry, cwd });
    if (!parsed.success) throw new Error(`Invalid session: ${parsed.error.issues[0]!.message}`);
    sessions.push(parsed.data);
  }
  return sessions;
}
