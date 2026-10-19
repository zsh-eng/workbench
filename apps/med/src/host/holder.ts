// `med __hold <spec>`: keeps one agent process for Med. Med's host starts a
// holder for each agent session. The holder runs in its own process group,
// so the agent keeps working while the host restarts or updates, as a job of
// iTerm2's server process does. It reads no protocol beyond line ends: it
// writes each line to the session log (holder-log.ts) and serves the log on
// a socket that only the user can open. A host attaches, reads the lines
// after the last one it has, and then follows new ones.
//
// The holder stops its agent when Med asks, on SIGTERM, or when its folder
// is gone. It ends when the agent ends, and leaves the log for the host.

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { createServer, type Socket } from "node:net";
import { dirname } from "node:path";
import { createInterface } from "node:readline";
import {
  formatEntry,
  holderFiles,
  HOLDER_VERSION,
  parseEntry,
  type AgentExit,
  type HolderInfo,
  type HolderSpec,
  type LogKind,
} from "./holder-log.ts";

/** After Med closes the agent's input, the wait for it to end before each signal. */
const TERM_MS = 2000;
const KILL_MS = 5000;
/** How often the holder checks that its folder is still there. */
const CHECK_MS = 2000;
/** A log longer than this starts again at Med's last checkpoint. Tests set
 * a small size with MED_HOLDER_COMPACT_BYTES. */
const COMPACT_BYTES = Number(process.env.MED_HOLDER_COMPACT_BYTES) || 8 * 1024 * 1024;

const specPath = process.argv.at(-1)!;
const spec = JSON.parse(readFileSync(specPath, "utf8")) as HolderSpec;
rmSync(specPath, { force: true });
const files = holderFiles(spec.directory, spec.sessionId);
mkdirSync(spec.directory, { recursive: true, mode: 0o700 });
mkdirSync(dirname(files.socket), { recursive: true, mode: 0o700 });
const generation = randomUUID();
const startedAt = Date.now();

let log = openSync(files.log, "w", 0o600);
let next = 0;
let size = 0;
const clients = new Set<Socket>();
function append(kind: LogKind, text: string) {
  const line = formatEntry({ n: ++next, kind, at: Date.now(), text });
  try {
    size += writeSync(log, line);
  } catch {
    // The folder is gone; the check below stops the agent.
  }
  for (const client of clients) client.write(line);
}
/**
 * Med's checkpoint holds its state at a quiet moment, such as a turn's end.
 * A long log keeps its first line and starts again at the checkpoint, so a
 * host that attaches later reads from there. Entries keep their numbers.
 */
function checkpoint(data: unknown) {
  const text = JSON.stringify({ checkpoint: data });
  if (size <= COMPACT_BYTES) return append("m", text);
  const line = formatEntry({ n: ++next, kind: "m", at: Date.now(), text });
  try {
    // The new log replaces the old one whole, so a reader sees one or the other.
    const old = readFileSync(files.log);
    const header = old.subarray(0, old.indexOf(10) + 1);
    const temporary = `${files.log}.${generation}.tmp`;
    writeFileSync(temporary, Buffer.concat([header, Buffer.from(line)]), { mode: 0o600 });
    renameSync(temporary, files.log);
    closeSync(log);
    log = openSync(files.log, "a", 0o600);
    size = header.length + Buffer.byteLength(line);
  } catch {
    // The log stays long.
    try {
      size += writeSync(log, line);
    } catch {
      // The folder is gone; the check below stops the agent.
    }
  }
  for (const client of clients) client.write(line);
}
append("h", JSON.stringify({ version: HOLDER_VERSION, sessionId: spec.sessionId, generation }));

const agent = spawn(spec.command, spec.args, {
  cwd: spec.cwd,
  env: spec.env,
  stdio: ["pipe", "pipe", "pipe"],
});
agent.stdin.on("error", () => {});
let errors = "";
let failure: string | undefined;
createInterface({ input: agent.stdout, crlfDelay: Infinity }).on("line", (line) =>
  append("o", line),
);
createInterface({ input: agent.stderr, crlfDelay: Infinity }).on("line", (line) => {
  errors = `${errors}${line}\n`.slice(-4000);
  append("e", line);
});

let stopping = false;
const timers: ReturnType<typeof setTimeout>[] = [];
/** Closes the agent's input, then signals it if it does not end. */
function stop() {
  if (stopping) return;
  stopping = true;
  agent.stdin.end();
  timers.push(
    setTimeout(() => agent.kill("SIGTERM"), TERM_MS),
    setTimeout(() => agent.kill("SIGKILL"), KILL_MS),
  );
}

const server = createServer((socket) => {
  socket.on("error", () => clients.delete(socket));
  socket.on("close", () => clients.delete(socket));
  let buffered = "";
  socket.on("data", (data) => {
    buffered += data.toString("utf8");
    for (let end = buffered.indexOf("\n"); end >= 0; end = buffered.indexOf("\n")) {
      const line = buffered.slice(0, end);
      buffered = buffered.slice(end + 1);
      let message: { type?: string; after?: number; line?: string; data?: unknown };
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (message.type === "attach") {
        // The log so far, then live lines: one thread, so none falls between.
        const after = message.after ?? 0;
        let text = "";
        try {
          text = readFileSync(files.log, "utf8");
        } catch {
          /* The folder is gone. */
        }
        for (const entry of text.split("\n")) {
          const parsed = parseEntry(entry);
          if (parsed && parsed.n > after) socket.write(`${entry}\n`);
        }
        socket.write(formatEntry({ n: next, kind: "l", at: Date.now(), text: "{}" }));
        clients.add(socket);
      } else if (message.type === "write" && typeof message.line === "string") {
        if (stopping || exited) continue;
        append("i", message.line);
        agent.stdin.write(`${message.line}\n`);
      } else if (message.type === "checkpoint" && message.data !== undefined) {
        checkpoint(message.data);
      } else if (message.type === "record" && message.data !== undefined) {
        append("m", JSON.stringify(message.data));
      } else if (message.type === "stop") {
        requested = true;
        stop();
      }
    }
  });
});
let requested = false;
let exited = false;

function writeInfo() {
  const info: HolderInfo = {
    version: HOLDER_VERSION,
    sessionId: spec.sessionId,
    kind: spec.kind,
    name: spec.name,
    cwd: spec.cwd,
    pid: process.pid,
    ...(agent.pid ? { agentPid: agent.pid } : {}),
    socket: files.socket,
    generation,
    startedAt,
  };
  const temporary = `${files.info}.${generation}.tmp`;
  writeFileSync(temporary, JSON.stringify(info), { mode: 0o600 });
  renameSync(temporary, files.info);
}

function finish(exit: AgentExit) {
  if (exited) return;
  exited = true;
  for (const timer of timers) clearTimeout(timer);
  clearInterval(check);
  append("x", JSON.stringify(exit));
  for (const client of clients) client.end();
  server.close();
  // A later holder of the session has its own socket and info: keep them.
  if (owns())
    for (const path of [files.socket, files.info]) {
      try {
        unlinkSync(path);
      } catch {
        /* Gone already. */
      }
    }
  closeSync(log);
  // The clients have the last line; then the holder ends.
  setTimeout(() => process.exit(0), 50).unref();
}

agent.on("error", (error) => {
  failure = error.message;
  finish({ code: null, signal: null, errors, requested, error: failure });
});
agent.on("exit", (code, signal) => {
  // The agent's output can end after its exit; the last lines come first.
  setTimeout(() => finish({ code, signal, errors, requested }), 20);
});

process.on("SIGTERM", () => {
  requested = true;
  stop();
});
process.on("SIGINT", () => {
  requested = true;
  stop();
});
process.on("SIGHUP", () => {});

/** Whether the session's info file is still this holder's. */
function owns() {
  try {
    return (JSON.parse(readFileSync(files.info, "utf8")) as HolderInfo).generation === generation;
  } catch {
    return false;
  }
}
// A holder that Med cannot find again, because its folder is gone or another
// holder took its session, stops its agent.
const check = setInterval(() => {
  if (listening && !owns()) {
    requested = true;
    stop();
  }
}, CHECK_MS);
let listening = false;

try {
  unlinkSync(files.socket);
} catch {
  /* No socket from an earlier holder. */
}
server.listen(files.socket, () => {
  // Only the user opens the socket, whatever the folder allows.
  chmodSync(files.socket, 0o600);
  writeInfo();
  listening = true;
});
