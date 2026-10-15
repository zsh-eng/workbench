import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { SessionPlace } from "../shared/agent-inbox";
import { runProcess } from "./runtime/process";
import { userHome } from "./service/discover";

// Whether another process runs a Claude Code session, such as `claude` in a
// terminal or in the Claude app, and where. Two writers on one transcript
// would mix it, so Med sends a prompt only to a session that no other process
// runs.
//
// Claude Code keeps a record for each running process in
// `~/.claude/sessions/<pid>.json`. Med reads only its `sessionId`, its
// `procStart`, and its `entrypoint`. `procStart` is the output of
// `ps -o lstart= -p <pid>` with LC_ALL=C and TZ=UTC when the process started,
// such as "Thu Oct 15 09:12:03 2026". A record counts when its process is
// alive and starts at that time, so a record whose pid the system gave to a
// new process does not count. A record that Med cannot read counts: a false
// "runs elsewhere" only holds a message, while two writers on one transcript
// break it. A session started with its ID in its arguments, such as
// `claude --resume <id>`, also counts.
//
// `entrypoint` is the CLAUDE_CODE_ENTRYPOINT of the process. Claude Code 2.1
// sets `cli` for `claude` in a terminal, and the Claude app sets
// `claude-desktop`, or `claude-desktop-3p` with another model provider. The
// other values name an IDE, the SDK, an integration, or a remote session.

/** A record is a few hundred bytes; a larger file is not one. */
const MAX_RECORD_BYTES = 64 * 1024;
/** Claude Code reads the start time in this form. */
const PS_ENVIRONMENT = { LC_ALL: "C", TZ: "UTC" };

type Verdict = "yes" | "no" | "unsure";

/** Where a process with this entrypoint has its session open. */
function placeOf(entrypoint: unknown): SessionPlace {
  if (entrypoint === "cli") return "terminal";
  if (entrypoint === "claude-desktop" || entrypoint === "claude-desktop-3p") return "claude-app";
  return "other-app";
}

/** Whether the process exists. A process of another user still exists. */
function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function ps(args: string[]) {
  try {
    const { stdout } = await runProcess("ps", args, {
      cwd: "/",
      timeoutMs: 5000,
      env: PS_ENVIRONMENT,
    });
    return stdout.toString();
  } catch {
    return undefined;
  }
}

export interface SessionProcesses {
  /**
   * The sessions of `ids` that another process runs, with where each is open.
   * `maxAgeMs` accepts an answer of that age; a decision to send reads anew.
   */
  elsewhere(ids: readonly string[], maxAgeMs?: number): Promise<Map<string, SessionPlace>>;
}

export function createSessionProcesses(
  options: {
    /** The home directory whose `.claude/sessions` Claude Code writes. */
    home?: () => string;
    /** The processes that Med runs itself. */
    ownPids?: () => Iterable<number>;
  } = {},
): SessionProcesses {
  const home = options.home ?? userHome;
  const answers = new Map<string, { at: number; place: SessionPlace | undefined }>();

  /** What one record says about the sessions of `wanted`. */
  const verdict = async (
    name: string,
    wanted: ReadonlySet<string>,
    own: ReadonlySet<number>,
  ): Promise<{ verdict: Verdict; session?: string; place?: SessionPlace }> => {
    const pid = Number(name.slice(0, -".json".length));
    if (!Number.isSafeInteger(pid) || pid <= 1 || pid === process.pid || own.has(pid))
      return { verdict: "no" };
    if (!alive(pid)) return { verdict: "no" };
    let record: unknown;
    try {
      const text = await readFile(join(home(), ".claude", "sessions", name), "utf8");
      if (text.length > MAX_RECORD_BYTES) return { verdict: "unsure" };
      record = JSON.parse(text);
    } catch {
      // A record that went with its process says nothing.
      return { verdict: alive(pid) ? "unsure" : "no" };
    }
    const fields = (record && typeof record === "object" ? record : {}) as {
      sessionId?: unknown;
      procStart?: unknown;
      entrypoint?: unknown;
    };
    if (typeof fields.sessionId !== "string") return { verdict: "unsure" };
    if (!wanted.has(fields.sessionId)) return { verdict: "no" };
    const session = fields.sessionId;
    if (typeof fields.procStart !== "string" || !fields.procStart)
      return { verdict: "unsure", session };
    const started = (await ps(["-o", "lstart=", "-p", String(pid)]))?.trim();
    if (!started) return { verdict: alive(pid) ? "unsure" : "no" };
    // The pid belongs to a newer process now.
    if (started !== fields.procStart) return { verdict: "no" };
    // A fork that answers a question (questions.ts) reads the session and
    // writes its own transcript.
    const args = await ps(["-o", "args=", "-p", String(pid)]);
    if (args === undefined) return { verdict: "unsure", session };
    if (args.includes("--fork-session")) return { verdict: "no" };
    return { verdict: "yes", session, place: placeOf(fields.entrypoint) };
  };

  /** The sessions of `wanted` that a running process names in its arguments. */
  const named = async (wanted: ReadonlySet<string>, own: ReadonlySet<number>) => {
    const listing = await ps(["-A", "-o", "pid=,args="]);
    if (listing === undefined) return undefined;
    const found = new Set<string>();
    for (const line of listing.split("\n")) {
      const match = /^\s*(\d+)\s+(.*)$/.exec(line);
      if (!match || own.has(Number(match[1])) || Number(match[1]) === process.pid) continue;
      const args = match[2]!;
      if (!/claude/i.test(args) || args.includes("--fork-session")) continue;
      for (const id of wanted) if (args.includes(id)) found.add(id);
    }
    return found;
  };

  /** Where the sessions of `ids` are open. Med does not know where for a
   * record that it cannot place or a process found by its arguments. */
  const read = async (ids: readonly string[]) => {
    const wanted = new Set(ids);
    const everywhere = () => new Map(ids.map((id) => [id, "other-app" as SessionPlace]));
    const own = new Set(options.ownPids?.() ?? []);
    const found = new Map<string, SessionPlace>();
    let names: string[] = [];
    try {
      names = (await readdir(join(home(), ".claude", "sessions"))).filter((name) =>
        /^\d+\.json$/.test(name),
      );
    } catch (error) {
      // An older Claude Code keeps no records; the arguments still tell.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return everywhere();
    }
    for (const name of names) {
      const { verdict: result, session, place = "other-app" } = await verdict(name, wanted, own);
      if (result === "no") continue;
      // A record that Med cannot read could name any of them.
      if (!session) return everywhere();
      // Two processes in different places: Med does not say which.
      const before = found.get(session);
      found.set(session, before && before !== place ? "other-app" : place);
    }
    const rest = new Set([...wanted].filter((id) => !found.has(id)));
    if (!rest.size) return found;
    const byArguments = await named(rest, own);
    if (!byArguments) return everywhere();
    for (const id of byArguments) found.set(id, "other-app");
    return found;
  };

  return {
    async elsewhere(ids, maxAgeMs = 0) {
      const now = Date.now();
      const due = ids.filter((id) => {
        const answer = answers.get(id);
        return !answer || now - answer.at > maxAgeMs;
      });
      if (due.length) {
        const found = await read(due);
        const at = Date.now();
        if (answers.size > 256) answers.clear();
        for (const id of due) answers.set(id, { at, place: found.get(id) });
      }
      const places = new Map<string, SessionPlace>();
      for (const id of ids) {
        const place = answers.get(id)?.place;
        if (place) places.set(id, place);
      }
      return places;
    },
  };
}
