import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import { mkdir, open, readFile, writeFile, unlink, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import {
  clientPort,
  defaultStateDirectory,
  getStateDirectory,
  livePorts,
  readConnection,
  servicePort,
  type RunningConnection,
} from "../host/runtime/connection";
import { instanceOptions, medCommand } from "../host/runtime/med-command";
import { startHost } from "../host/server";
import { ownCommand } from "../host/thread-agents";
import { HostError } from "../host/runtime/errors";
import { ServiceManager } from "../host/service/manager";
import { selfCommand } from "../host/service/self";
import { NotFoundError, UsageError } from "./exit-status";
import { serviceLabel } from "./login-service";

const exec = promisify(execFile);

const OPTIONS = "Options: --port <port> (or MED_PORT), --state-dir <path> (or MED_STATE_DIR)";

/** The help of each server command: med <command> --help. */
export const serviceHelp: Readonly<Record<string, string>> = {
  web: `Usage: med web [--no-open]

Starts Med's server in the background, if it does not run, and opens Med in
the browser. The server keeps running when you close the terminal or the
browser. --no-open opens no browser and prints the address with its sign-in
token.

Med's own state folder, ~/.local/state/med, uses port 6330. A server of
another state folder takes a free port and prints it; --port chooses one.
${OPTIONS}`,
  add: `Usage: med add <path> [--type repo|vault] [--wait]

Registers a repository or a vault, and starts the server if it does not run.
A folder with an .obsidian folder is a vault, and any other is a repository;
--type chooses. Med then watches the folder. --wait waits until the first
index of a vault is ready.
${OPTIONS}`,
  list: `Usage: med list [--json]

Prints the registered sources: each one's ID, name, and folder, and a vault's
index. --json prints them as JSON.
${OPTIONS}`,
  remove: `Usage: med remove <source-id|path|name>

Stops watching a source and removes its registration. The folder and its
cache stay.
${OPTIONS}`,
  index: `Usage: med index [<source>] [--wait]

Indexes a vault again now; without <source>, every vault. Med watches its
vaults, so you need this only after changes that it did not see. --wait waits
until the index is ready.
${OPTIONS}`,
  status: `Usage: med status [--json]

Prints whether the server runs, where, and its sources. It also says when the
installed agent skill is out of date. --json prints the server's state as
JSON, or {"running":false}.
${OPTIONS}`,
  stop: `Usage: med stop

Stops the server. Registrations, saved reviews, and indexes stay, and the next
med web watches the same sources. The agents that Med started keep working:
med agents stop --all stops them.
${OPTIONS}`,
  serve: `Usage: med serve

Runs Med's server in the foreground, for a service manager of your own.
med web starts the same server in the background.
${OPTIONS}

Older foreground modes open Med without the background server:
  med [<folder>...]         Review the changes of these repositories
  med --registered          Review the changes of every registered repository
  med --patch <file|->      Review a patch; - reads it from standard input
  med --files <old> <new>   Compare two files
  med --editor              Browse and edit files, without a repository
  med --setup-search        Build the pinned Zoekt search tools once (needs Go)
They take --port, --state-dir, and --no-open. Another state folder than
~/.local/state/med takes a free port.
med sources and med vault change registrations without a server:
med sources --help.`,
};

/** A source as the server's status lists it. */
interface ListedSource {
  id: string;
  kind: "repo" | "vault";
  name: string;
  path: string;
  index?: { state: string; error?: string; result?: { files?: number } };
  watching?: boolean;
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** A vault's index, in words: "ready, 6,707 files", "indexing", or the error. */
function indexText(index: ListedSource["index"]) {
  if (!index) return "not indexed yet";
  if (index.state === "error") return `index failed: ${index.error ?? "no reason given"}`;
  const files = index.result?.files;
  return index.state === "ready" && files !== undefined
    ? `ready, ${files.toLocaleString("en")} ${files === 1 ? "file" : "files"}`
    : index.state;
}

/** med status: where the server runs, and its sources. */
function statusText(
  connection: RunningConnection,
  status: { pid?: number; sources?: ListedSource[] },
  stateDir: string,
) {
  const sources = status.sources ?? [];
  const repos = sources.filter((source) => source.kind === "repo").length;
  const vaults = sources.filter((source) => source.kind === "vault");
  return [
    `Med is running at ${connection.origin}${status.pid ? ` (process ${status.pid})` : ""}.`,
    ...(resolve(stateDir) === defaultStateDirectory() ? [] : [`State folder: ${stateDir}`]),
    `Sources: ${count(repos, "repository", "repositories")} and ${count(vaults.length, "vault", "vaults")}.`,
    ...vaults.map(
      (vault) =>
        `  ${vault.name}: ${indexText(vault.index)}${vault.watching === false ? "; not watched, so Med checks it every 60 s" : ""}`,
    ),
  ].join("\n");
}

/** med list: one line per source, with the ID that remove and index take. */
function sourcesText(sources: ListedSource[], instance: { port: number; stateDir: string }) {
  if (!sources.length)
    return `No sources are registered. Register one: ${medCommand(instance, "add", "<path>")}`;
  const width = (pick: (source: ListedSource) => string) =>
    Math.max(...sources.map((source) => pick(source).length));
  const id = width((source) => source.id);
  const name = width((source) => source.name);
  return sources
    .map((source) =>
      [
        source.id.padEnd(id),
        source.name.padEnd(name),
        source.path,
        ...(source.kind === "vault" ? [`(${indexText(source.index)})`] : []),
      ].join("  "),
    )
    .join("\n");
}

async function rpc(connection: RunningConnection, action: string, body: object = {}) {
  const response = await fetch(`${connection.origin}/api/service/${action}`, {
    method: "POST",
    headers: { authorization: `Bearer ${connection.token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await response.json()) as any;
  if (!response.ok) {
    const message =
      data.error?.message ?? data.message ?? `Server request failed (${response.status}).`;
    throw response.status === 404 ? new NotFoundError(message) : new Error(message);
  }
  return data;
}
async function connected(stateDir: string, port: number) {
  let connection: RunningConnection;
  try {
    connection = await readConnection(stateDir, port);
  } catch {
    return undefined;
  }
  let response: Response;
  try {
    response = await fetch(`${connection.origin}/api/service/status`, {
      method: "POST",
      headers: { authorization: `Bearer ${connection.token}`, "content-type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(1500),
    });
  } catch {
    return undefined;
  }
  if (!response.ok)
    throw new Error(
      `The host on port ${port} is not a managed Med server. Keep it running and choose another --port and --state-dir, or stop it before migrating.`,
    );
  const status = (await response.json()) as { service?: string };
  if (status.service !== "med") throw new Error("The selected port belongs to another service.");
  return connection;
}
async function acquire(stateDir: string) {
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const path = join(stateDir, "service.lock");
  const identity = JSON.stringify({ pid: process.pid, nonce: randomBytes(12).toString("hex") });
  for (let attempt = 0; attempt < 2; attempt++)
    try {
      const handle = await open(path, "wx", 0o600);
      try {
        await handle.writeFile(identity);
      } finally {
        await handle.close();
      }
      return async () => {
        try {
          if ((await readFile(path, "utf8")) === identity) await unlink(path);
        } catch {}
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const text = await readFile(path, "utf8");
      let owner: { pid: number };
      try {
        owner = JSON.parse(text);
      } catch {
        throw new Error("Med is starting. Retry shortly.");
      }
      try {
        process.kill(owner.pid, 0);
        throw new Error("A Med server already owns this state directory.");
      } catch (check) {
        if ((check as NodeJS.ErrnoException).code !== "ESRCH") throw check;
      }
      if ((await readFile(path, "utf8")) === text) await unlink(path);
    }
  throw new Error("Could not acquire the Med service lock.");
}
export async function serve(stateDir: string, port: number) {
  const release = await acquire(stateDir);
  let manager: ServiceManager | undefined;
  try {
    manager = await ServiceManager.open(stateDir);
    const host = await startHost({
      repo: stateDir,
      fileMode: true,
      port,
      stateDir,
      service: manager,
      cli: ownCommand(),
      // Another Med lists only its own threads, until the reader shows the rest.
      foundSessions: resolve(stateDir) === defaultStateDirectory(),
    });
    manager.port = host.port;
    let closing = false;
    const close = (next?: () => Promise<unknown>) => {
      if (closing) return;
      closing = true;
      void host.close().finally(async () => {
        await release();
        await next?.();
        // A watcher that chokidar did not close can keep a stopped service alive.
        process.exit();
      });
    };
    manager.onStop = () => close();
    // launchd restarts its own agent; otherwise a detached replacement starts
    // after this server frees the port and the lock.
    const label =
      process.platform === "darwin" && process.env.XPC_SERVICE_NAME === serviceLabel(stateDir)
        ? process.env.XPC_SERVICE_NAME
        : undefined;
    manager.onRestart = async () => {
      await checkStartable();
      if (label)
        spawn("launchctl", ["kickstart", "-k", `gui/${process.getuid!()}/${label}`], {
          detached: true,
          stdio: "ignore",
        }).unref();
      else setTimeout(() => close(() => startDetached(stateDir, port)), 25);
    };
    process.once("SIGTERM", () => close());
    process.once("SIGINT", () => close());
    console.log(`Med server: http://127.0.0.1:${host.port}/sources`);
  } catch (error) {
    await manager?.close();
    await release();
    throw error;
  }
}
/** Loads the code on disk in a separate process, so a broken build never
 * replaces a working server. */
async function checkStartable() {
  const command = selfCommand(["--version"]);
  try {
    await exec(command.executable, command.args, { timeout: 15_000 });
  } catch (error) {
    // Node prints the stack, then its version; the error line names the cause.
    const stderr = String((error as { stderr?: string }).stderr ?? "");
    const detail = (/^(?:\w*Error|error):.*$/m.exec(stderr)?.[0] ?? stderr.trim().split("\n")[0])
      ?.trim()
      .slice(0, 300);
    throw new HostError(
      "restart-failed",
      `The new build does not start${detail ? ` (${detail})` : ""}. Med keeps running the current one.`,
      409,
    );
  }
}
/** Starts the background server from the code on disk. */
async function startDetached(stateDir: string, port: number) {
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const log = join(stateDir, "service.log");
  try {
    if ((await stat(log)).size > 4 * 1024 * 1024) await writeFile(log, "");
  } catch {}
  const output = await open(log, "a", 0o600);
  const command = selfCommand(["serve", "--state-dir", stateDir, "--port", String(port)]);
  const child = spawn(command.executable, command.args, {
    detached: true,
    stdio: ["ignore", output.fd, output.fd],
  });
  let launchError: Error | undefined;
  child.once("error", (error) => {
    launchError = error;
  });
  child.unref();
  await output.close();
  return { child, log, failed: () => launchError };
}
/** The server of this state folder, on `port` or, when another command
 * started it first, on the port that it chose. */
async function anyConnected(stateDir: string, port: number) {
  const first = await connected(stateDir, port);
  if (first) return first;
  for (const live of await livePorts(stateDir)) {
    const connection = live === port ? undefined : await connected(stateDir, live);
    if (connection) return connection;
  }
  return undefined;
}
/** Connects to the background server, starting it first if needed. */
export async function ensureService(stateDir: string, port: number) {
  const existing = await anyConnected(stateDir, port);
  if (existing) return existing;
  const { log, failed } = await startDetached(stateDir, port);
  for (let attempt = 0; attempt < 100; attempt++) {
    const connection = await anyConnected(stateDir, port);
    if (connection) return connection;
    // A command that started at the same time may own the server instead.
    const launchError = failed();
    if (launchError) throw launchError;
    await delay(100);
  }
  throw new Error(`Med did not start. See ${log}. The port may already be occupied.`);
}
export async function runServiceCommand(command: string, args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    allowNegative: true,
    options: {
      port: { type: "string" },
      "state-dir": { type: "string" },
      type: { type: "string" },
      wait: { type: "boolean" },
      open: { type: "boolean", default: true },
      json: { type: "boolean" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(serviceHelp[command]);
    return;
  }
  if (
    (["web", "list", "status", "stop", "serve"].includes(command) && positionals.length) ||
    (["add", "remove"].includes(command) && positionals.length !== 1) ||
    (command === "index" && positionals.length > 1)
  )
    throw new UsageError(serviceHelp[command]!);
  if (values.type && !["repo", "vault"].includes(values.type))
    throw new Error("Use --type repo or --type vault.");
  // status and stop only read; the others start the server when it is down.
  const stateDir = getStateDirectory(values["state-dir"]);
  const reads = command === "status" || command === "stop";
  const chosen = reads
    ? { port: await clientPort(stateDir, values.port), picked: false }
    : await servicePort(stateDir, values.port);
  const { picked } = chosen;
  let { port } = chosen;
  const instance = { port, stateDir };
  // Port 6330 is the user's own Med: another state folder gets a free port.
  const pickedNote = () =>
    console.error(
      `Port 6330 is for Med's own state folder, so the server of ${stateDir} uses port ${port}. Commands with ${instanceOptions(instance)} reach it. For the same address after a restart, choose a port with --port or MED_PORT.`,
    );
  if (command === "serve") {
    await serve(stateDir, port);
    if (picked) pickedNote();
    return;
  }
  // status and web say when the installed agent skill is older than Med.
  const skillNotice = async () => {
    const { skillNotice } = await import("./skills");
    const notice = await skillNotice().catch(() => undefined);
    if (notice) console.error(notice);
  };
  if (command === "status" || command === "stop") {
    const connection = await connected(stateDir, port);
    // status prints a summary; --json, and stop, print JSON as before.
    const readable = command === "status" && !values.json;
    if (!connection) {
      console.log(
        readable
          ? `Med is not running. Start it: ${medCommand(instance, "web")}`
          : JSON.stringify({ running: false }),
      );
      if (command === "status") await skillNotice();
      return;
    }
    const result = await rpc(connection, command);
    console.log(
      readable ? statusText(connection, result, stateDir) : JSON.stringify(result, null, 2),
    );
    if (command === "status") await skillNotice();
    if (command === "stop") {
      for (let i = 0; i < 100; i++) {
        if (!(await connected(stateDir, port))) break;
        await delay(100);
      }
      const { listHolders } = await import("../host/held-agent");
      const agents = (await listHolders(join(stateDir, "agents"))).length;
      if (agents)
        console.error(
          `${agents} ${agents === 1 ? "agent keeps" : "agents keep"} working. Stop them with ${medCommand({ stateDir }, "agents stop --all")}.`,
        );
    }
    return;
  }
  const connection = await ensureService(stateDir, port);
  // Another command may have started the server first, on its own port.
  port = instance.port = Number(new URL(connection.origin).port);
  if (picked) pickedNote();
  if (command === "web") {
    const url = `${connection.origin}/sources#token=${connection.token}`;
    if (values.open) {
      const opener =
        process.platform === "darwin"
          ? "open"
          : process.platform === "win32"
            ? "explorer.exe"
            : "xdg-open";
      const child = spawn(opener, [url], { stdio: "ignore", detached: true });
      child.once("error", () => console.error("Could not open a browser."));
      child.unref();
    }
    // --no-open is an explicit request for a launch URL; never put this token in agent links.
    console.log(values.open ? `${connection.origin}/sources` : url);
    await skillNotice();
    return;
  }
  if (command === "list") {
    const { sources } = await rpc(connection, "status");
    console.log(values.json ? JSON.stringify(sources, null, 2) : sourcesText(sources, instance));
    return;
  }
  const result = await rpc(
    connection,
    command,
    command === "add"
      ? { path: resolve(positionals[0]!), kind: values.type }
      : { source: positionals[0] },
  );
  if (values.wait && (command === "add" || command === "index")) {
    const ids: string[] =
      result.sources ?? (result.source.kind === "vault" ? [result.source.id] : []);
    for (let i = 0; i < 1200; i++) {
      const status = await rpc(connection, "status");
      const jobs = status.sources.filter((s: any) => ids.includes(s.id));
      if (jobs.some((s: any) => s.index?.state === "error"))
        throw new Error(jobs.find((s: any) => s.index?.state === "error").index.error);
      if (jobs.length !== ids.length) throw new Error("Source removed while waiting for indexing.");
      if (jobs.every((s: any) => s.index?.state === "ready")) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      await delay(100);
    }
    throw new Error(
      `Indexing did not finish before the wait limit. Check ${medCommand(instance, "status")}.`,
    );
  }
  console.log(JSON.stringify(result, null, 2));
}
