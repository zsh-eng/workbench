import { open, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
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

/** Claude Code keeps each session in ~/.claude/projects/<project>/<id>.jsonl. */
async function claudeDirectory(id: string, home: string) {
  const projects = join(home, ".claude", "projects");
  let entries: string[];
  try {
    entries = await readdir(projects);
  } catch {
    return undefined;
  }
  for (const project of entries) {
    try {
      return firstCwd(await head(join(projects, project, `${id}.jsonl`)));
    } catch {
      /* Not in this project. */
    }
  }
  return undefined;
}

/** Codex keeps sessions in ~/.codex/sessions/YYYY/MM/DD/rollout-…-<id>.jsonl.
 * Newer days are searched first, and only a bounded number of them. */
async function codexDirectory(id: string, home: string) {
  const root = join(home, ".codex", "sessions");
  const sorted = async (path: string) => {
    try {
      return (await readdir(path)).sort().reverse();
    } catch {
      return [];
    }
  };
  let days = 0;
  for (const year of await sorted(root))
    for (const month of await sorted(join(root, year)))
      for (const day of await sorted(join(root, year, month))) {
        if (++days > 400) return undefined;
        const folder = join(root, year, month, day);
        const file = (await sorted(folder)).find((name) => name.endsWith(`${id}.jsonl`));
        if (file) return firstCwd(await head(join(folder, file)).catch(() => ""));
      }
  return undefined;
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
    const cwd =
      (entry.agent === "claude"
        ? await claudeDirectory(entry.id, home)
        : await codexDirectory(entry.id, home)) ?? process.cwd();
    const parsed = agentSessionSchema.safeParse({ ...entry, cwd });
    if (!parsed.success) throw new Error(`Invalid session: ${parsed.error.issues[0]!.message}`);
    sessions.push(parsed.data);
  }
  return sessions;
}
