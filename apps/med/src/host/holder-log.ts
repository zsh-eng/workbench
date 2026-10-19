// The session log and files of an agent's holder (holder.ts). This module
// imports only Node's own modules, because the holder runs it as it is.
//
// A holder keeps one agent process for Med. It writes each line between Med
// and the agent to a log, numbered and appended only, so a Med host that
// starts later reads the session from its first line. A log line is
// `<number> <kind> <time> <text>`: the text is the agent's line as it came,
// or JSON for Med's own records.

import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The version of the holder's files and socket messages. */
export const HOLDER_VERSION = 1;

/**
 * `h` opens a holder's log. `o` is a line that the agent wrote, `e` a line
 * of its error output, and `i` a line that Med wrote to it. `m` is Med's own
 * record. `x` says that the agent exited. `l` is not in the file: the
 * holder sends it after the lines that it read back, before live ones.
 */
export type LogKind = "h" | "o" | "e" | "i" | "m" | "x" | "l";

export interface LogEntry {
  n: number;
  kind: LogKind;
  at: number;
  text: string;
}

/** How the agent ended, in an `x` entry. */
export interface AgentExit {
  code: number | null;
  signal: string | null;
  /** The last lines of its error output. */
  errors: string;
  /** Med or the user asked the agent to stop. */
  requested: boolean;
  /** The holder could not start the agent. */
  error?: string;
}

export const formatEntry = (entry: LogEntry) =>
  `${entry.n} ${entry.kind} ${entry.at} ${entry.text}\n`;

/** A log line without its line end, or undefined for a torn one. */
export function parseEntry(line: string): LogEntry | undefined {
  const first = line.indexOf(" ");
  const second = line.indexOf(" ", first + 1);
  const third = line.indexOf(" ", second + 1);
  if (first < 1 || second < 0 || third < 0) return undefined;
  const n = Number(line.slice(0, first));
  const kind = line.slice(first + 1, second) as LogKind;
  const at = Number(line.slice(second + 1, third));
  if (!Number.isSafeInteger(n) || !Number.isFinite(at) || !"hoeimxl".includes(kind))
    return undefined;
  return { n, kind, at, text: line.slice(third + 1) };
}

/** What the holder tells about itself, in `<id>.json` beside its log. */
export interface HolderInfo {
  version: number;
  sessionId: string;
  kind: string;
  name: string;
  cwd: string;
  /** The holder's own process. */
  pid: number;
  /** The agent's process. */
  agentPid?: number;
  socket: string;
  /** Names this holder's lifetime; its log starts again with the next. */
  generation: string;
  startedAt: number;
}

/** What Med gives a holder to start, in a file that the holder removes. */
export interface HolderSpec {
  version: number;
  sessionId: string;
  kind: string;
  name: string;
  command: string;
  args: string[];
  cwd: string;
  /** The agent's environment; JSON leaves out the variables without values. */
  env: Record<string, string | undefined>;
  /** The folder of the holders' files. */
  directory: string;
  socket: string;
}

export const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** The holders' files for a session, in Med's state folder. */
export function holderFiles(directory: string, sessionId: string) {
  return {
    info: join(directory, `${sessionId}.json`),
    log: join(directory, `${sessionId}.log`),
    socket: socketPath(directory, sessionId),
  };
}

/** macOS takes a socket path of at most 104 bytes. A state folder with a
 * long path keeps its sockets in the user's temporary folder. */
function socketPath(directory: string, sessionId: string) {
  const near = join(directory, `${sessionId}.sock`);
  if (Buffer.byteLength(near) <= 100) return near;
  const hash = createHash("sha256").update(`${directory}\0${sessionId}`).digest("hex");
  return join(tmpdir(), `med-${process.getuid?.() ?? "user"}`, `${hash.slice(0, 20)}.sock`);
}
