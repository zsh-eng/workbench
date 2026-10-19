import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { connect, type Socket } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  holderFiles,
  HOLDER_VERSION,
  parseEntry,
  SESSION_ID,
  type AgentExit,
  type HolderInfo,
  type HolderSpec,
  type LogEntry,
} from "./holder-log";

// The host's side of an agent's holder (holder.ts): it starts a holder,
// attaches to one that runs, or reads the log of one that ended. Each gives
// the runner the session's log entries in order, the earlier ones first.

/** How long the host waits for a new holder's socket. */
const START_MS = 5000;

/** An agent process that a holder keeps. */
export interface HeldAgent {
  /** The agent's process, while the holder runs it. */
  pid(): number | undefined;
  /** Writes a line to the agent, through the log. */
  write(line: string): void;
  /** Adds Med's own record to the log. */
  record(data: unknown): void;
  /** Adds Med's state at a quiet moment; a long log starts again there. */
  checkpoint(data: unknown): void;
  /** Asks the holder to stop the agent. */
  stop(): void;
  /** Leaves the agent running, as when the host closes. */
  detach(): void;
}

export interface HeldEvents {
  /** A log entry. `replay` marks the entries from before the host attached,
   * which the runner reads for its state without acting on them again. */
  entry(entry: LogEntry, replay: boolean): void;
  /** The earlier entries are read; new ones follow live. */
  live(): void;
  /** The agent ended. `lost` says that its holder ended without a word, as
   * in a reboot or a kill. */
  exit(exit: AgentExit & { lost?: boolean }, replay: boolean): void;
}

/** How the host starts a holder: the release binary runs `med __hold`, a
 * built Med `dist/holder.js`, and Med from its source `holder.ts`. */
function holderCommand(): string[] {
  if ((globalThis as { __medAssets?: unknown }).__medAssets) return [process.execPath, "__hold"];
  for (const candidate of ["./holder.ts", "../holder.js", "./holder.js"]) {
    const path = fileURLToPath(new URL(candidate, import.meta.url));
    if (existsSync(path)) return [process.execPath, path];
  }
  throw new Error("Med cannot find its agent holder.");
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

/** The holder of a session, if one runs. */
export async function readHolder(directory: string, sessionId: string) {
  if (!SESSION_ID.test(sessionId)) return undefined;
  try {
    const info = JSON.parse(
      await readFile(holderFiles(directory, sessionId).info, "utf8"),
    ) as HolderInfo;
    return info.version === HOLDER_VERSION && alive(info.pid) ? info : undefined;
  } catch {
    return undefined;
  }
}

/** The holders that run now, from their files in `directory`. */
export async function listHolders(directory: string): Promise<HolderInfo[]> {
  let names: string[];
  try {
    names = await readdir(directory);
  } catch {
    return [];
  }
  const found = await Promise.all(
    names
      .filter((name) => name.endsWith(".json") && !name.startsWith("."))
      .map((name) => readHolder(directory, name.slice(0, -5))),
  );
  return found.filter((info): info is HolderInfo => !!info);
}

/** Asks a holder to stop its agent, and waits until it ends. */
export async function stopHolder(info: HolderInfo, timeoutMs = 8000) {
  try {
    process.kill(info.pid, "SIGTERM");
  } catch {
    return;
  }
  const until = Date.now() + timeoutMs;
  while (alive(info.pid) && Date.now() < until) await new Promise((done) => setTimeout(done, 50));
}

/** Waits until no holder runs the session, as before Med starts another. */
export async function holderEnded(directory: string, sessionId: string, timeoutMs = 8000) {
  const until = Date.now() + timeoutMs;
  while ((await readHolder(directory, sessionId)) && Date.now() < until)
    await new Promise((done) => setTimeout(done, 50));
}

/** Removes a session's log once the host has read how its agent ended. */
export async function forgetLog(directory: string, sessionId: string) {
  if (SESSION_ID.test(sessionId))
    await rm(holderFiles(directory, sessionId).log, { force: true }).catch(() => {});
}

/** Starts a holder for a new agent process, and attaches to it. */
export function startHeld(
  directory: string,
  spec: Omit<HolderSpec, "version" | "directory" | "socket">,
  events: HeldEvents,
): HeldAgent {
  const files = holderFiles(directory, spec.sessionId);
  const held = attachment(directory, spec.sessionId, events);
  void (async () => {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    // A log from an earlier process of the session has been read.
    await rm(files.log, { force: true });
    const specFile = join(directory, `.spec-${randomUUID()}.json`);
    const full: HolderSpec = { ...spec, version: HOLDER_VERSION, directory, socket: files.socket };
    await writeFile(specFile, JSON.stringify(full), { mode: 0o600 });
    const [command, ...args] = holderCommand();
    const holder = spawn(command!, [...args, specFile], { detached: true, stdio: "ignore" });
    holder.unref();
    held.connect(Date.now() + START_MS);
  })().catch((error: unknown) => held.fail(error instanceof Error ? error.message : String(error)));
  return held.agent;
}

/**
 * Attaches to the holder of a session that a host before this one started.
 * Without a holder, it reads the log that one left. Undefined when the
 * session has neither.
 */
export async function attachHeld(
  directory: string,
  sessionId: string,
  events: HeldEvents,
): Promise<HeldAgent | undefined> {
  const files = holderFiles(directory, sessionId);
  if (await readHolder(directory, sessionId)) {
    const held = attachment(directory, sessionId, events);
    held.connect(Date.now() + 1000);
    return held.agent;
  }
  if (!existsSync(files.log)) return undefined;
  const held = attachment(directory, sessionId, events);
  await held.offline();
  return held.agent;
}

function attachment(directory: string, sessionId: string, events: HeldEvents) {
  const files = holderFiles(directory, sessionId);
  let socket: Socket | undefined;
  let pid: number | undefined;
  let detached = false;
  let ended = false;
  let replaying = true;
  let last = 0;
  // Lines that wait for the socket.
  const queue: string[] = [];
  const send = (message: object) => {
    const line = `${JSON.stringify(message)}\n`;
    if (socket && !replaying) socket.write(line);
    else queue.push(line);
  };
  const end = (exit: AgentExit & { lost?: boolean }, replay: boolean) => {
    if (ended) return;
    ended = true;
    pid = undefined;
    events.exit(exit, replay);
  };
  const take = (entry: LogEntry, replay: boolean) => {
    if (entry.kind === "l") {
      replaying = false;
      events.live();
      for (const line of queue.splice(0)) socket?.write(line);
      return;
    }
    last = Math.max(last, entry.n);
    if (entry.kind === "x") {
      let exit: AgentExit;
      try {
        exit = JSON.parse(entry.text) as AgentExit;
      } catch {
        exit = { code: null, signal: null, errors: "", requested: false };
      }
      end(exit, replay);
      return;
    }
    events.entry(entry, replay);
  };
  /** The log as the holder left it, for a holder that ended. */
  const offline = async () => {
    let text = "";
    try {
      text = await readFile(files.log, "utf8");
    } catch {
      /* Read as empty. */
    }
    // Before the host attached, the entries are earlier work; after, they
    // are new, such as the agent's exit.
    for (const line of text.split("\n")) {
      const entry = parseEntry(line);
      if (entry && entry.n > last) take(entry, replaying);
    }
    if (replaying) take({ n: last, kind: "l", at: Date.now(), text: "{}" }, true);
    end({ code: null, signal: null, errors: "", requested: false, lost: true }, false);
  };
  /** No holder answers by `deadline`: the log says how its agent ended. */
  const give = () =>
    existsSync(files.log) ? void offline() : fail("The agent's holder did not start.");
  const fail = (error: string) =>
    end({ code: null, signal: null, errors: "", requested: false, error }, false);
  const connect = (deadline: number) => {
    const attempt = () => {
      if (detached || ended) return;
      void readHolder(directory, sessionId).then((info) => {
        if (detached || ended) return;
        if (!info) {
          if (Date.now() < deadline) setTimeout(attempt, 25);
          else give();
          return;
        }
        const current = connectSocket(info.socket);
        current.once("connect", () => {
          socket = current;
          pid = info.agentPid;
          current.write(`${JSON.stringify({ type: "attach", after: last })}\n`);
        });
        current.once("error", () => {
          if (socket === current) return;
          if (Date.now() < deadline) setTimeout(attempt, 25);
          else give();
        });
        let buffered = "";
        current.on("data", (data) => {
          buffered += data.toString("utf8");
          for (let end = buffered.indexOf("\n"); end >= 0; end = buffered.indexOf("\n")) {
            const entry = parseEntry(buffered.slice(0, end));
            buffered = buffered.slice(end + 1);
            if (entry && (entry.kind === "l" || entry.n > last)) take(entry, replaying);
          }
        });
        current.once("close", () => {
          if (socket !== current) return;
          socket = undefined;
          // The holder ended without its last line, as when it was killed.
          if (!detached && !ended) void offline();
        });
      });
    };
    attempt();
  };
  const agent: HeldAgent = {
    pid: () => pid,
    write: (line) => send({ type: "write", line }),
    record: (data) => send({ type: "record", data }),
    checkpoint: (data) => send({ type: "checkpoint", data }),
    stop() {
      if (socket) send({ type: "stop" });
      else if (!ended)
        void readHolder(directory, sessionId).then((info) => info && stopHolder(info));
    },
    detach() {
      detached = true;
      socket?.end();
      socket = undefined;
    },
  };
  return { agent, connect, offline, fail };
}

const connectSocket = (path: string) => connect({ path });
