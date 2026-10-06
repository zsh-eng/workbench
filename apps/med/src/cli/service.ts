import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, open, readFile, writeFile, unlink, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import {
  getStateDirectory,
  readConnection,
  DEFAULT_PORT,
  type RunningConnection,
} from "../host/runtime/connection";
import { startHost } from "../host/server";
import { ServiceManager } from "../host/service/manager";
import { selfCommand } from "../host/service/self";

export const serviceHelp = `Usage: med web                         Start the background server and open the browser
       med add <path> [--type repo|vault] [--wait]
       med list | status | stop
       med remove <source-id|path|name>
       med index [source] [--wait]
       med serve                       Run the server in the foreground
       med pr checkout <number|url|branch>  Check out a pull request with gh and review it
       med docs [agents|vaults|usage]
Options: --port <port>, --state-dir <directory>, --no-open
Existing review, open, and sources commands remain available.`;

async function rpc(connection: RunningConnection, action: string, body: object = {}) {
  const response = await fetch(`${connection.origin}/api/service/${action}`, {
    method: "POST",
    headers: { authorization: `Bearer ${connection.token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await response.json()) as any;
  if (!response.ok)
    throw new Error(
      data.error?.message ?? data.message ?? `Server request failed (${response.status}).`,
    );
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
    });
    let closing = false;
    const close = () => {
      if (closing) return;
      closing = true;
      void host.close().finally(release);
    };
    manager.onStop = close;
    process.once("SIGTERM", close);
    process.once("SIGINT", close);
    console.log(`Med server: http://127.0.0.1:${host.port}/sources`);
  } catch (error) {
    await manager?.close();
    await release();
    throw error;
  }
}
/** Connects to the background server, starting it first if needed. */
export async function ensureService(stateDir: string, port: number) {
  const existing = await connected(stateDir, port);
  if (existing) return existing;
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
  for (let attempt = 0; attempt < 100; attempt++) {
    if (launchError) throw launchError;
    const connection = await connected(stateDir, port);
    if (connection) return connection;
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
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(serviceHelp);
    return;
  }
  const stateDir = getStateDirectory(values["state-dir"]),
    port = values.port === undefined ? DEFAULT_PORT : Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Choose a port from 1 to 65535.");
  if (
    (["web", "list", "status", "stop", "serve"].includes(command) && positionals.length) ||
    (["add", "remove"].includes(command) && positionals.length !== 1) ||
    (command === "index" && positionals.length > 1)
  )
    throw new Error(serviceHelp);
  if (values.type && !["repo", "vault"].includes(values.type))
    throw new Error("Use --type repo or --type vault.");
  if (command === "serve") {
    await serve(stateDir, port);
    return;
  }
  if (command === "status" || command === "stop") {
    const connection = await connected(stateDir, port);
    if (!connection) {
      console.log(JSON.stringify({ running: false }));
      return;
    }
    console.log(JSON.stringify(await rpc(connection, command), null, 2));
    if (command === "stop")
      for (let i = 0; i < 100; i++) {
        if (!(await connected(stateDir, port))) return;
        await delay(100);
      }
    return;
  }
  const connection = await ensureService(stateDir, port);
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
    return;
  }
  if (command === "list") {
    console.log(JSON.stringify((await rpc(connection, "status")).sources, null, 2));
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
    throw new Error("Indexing did not finish before the wait limit. Check med status.");
  }
  console.log(JSON.stringify(result, null, 2));
}
