import { randomBytes } from "node:crypto";
import { chmod, link, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
import { shellWord } from "./shell-word";

/** "med" on a phone keypad. Vite's preview server takes 4173, Med's old default. */
export const DEFAULT_PORT = 6330;
const connectionSchema = z.object({
  version: z.literal(1),
  origin: z.string(),
  token: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/),
  pid: z.number().int().positive(),
});
export type RunningConnection = z.infer<typeof connectionSchema>;

/** The state folder of the user's own Med, whose server has port 6330. */
export const defaultStateDirectory = () => resolve(join(homedir(), ".local", "state", "med"));

export function getStateDirectory(override?: string): string {
  return resolve(override || process.env.MED_STATE_DIR || defaultStateDirectory());
}

const own = (stateDir: string) => resolve(stateDir) === defaultStateDirectory();

/**
 * A port from --port or MED_PORT, checked; undefined when neither is set.
 * Med gives each agent that it starts MED_PORT with MED_STATE_DIR, and an
 * agent that names another state folder keeps that MED_PORT. So MED_PORT
 * 6330 does not count for another folder than Med's own: 6330 is its port.
 */
export function givenPort(
  flag: string | undefined,
  environment: NodeJS.ProcessEnv = process.env,
  stateDir?: string,
) {
  const value = flag ?? (environment.MED_PORT || undefined);
  if (value === undefined) return undefined;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Choose a port from 1 to 65535.");
  if (flag === undefined && port === DEFAULT_PORT && stateDir && !own(stateDir)) return undefined;
  return port;
}

/** `wanted` if no process listens on it now, or else a port that the system
 * chooses. */
export async function freePort(wanted = 0): Promise<number> {
  const { createServer } = await import("node:net");
  const bind = (port: number) =>
    new Promise<number>((done, fail) => {
      const server = createServer();
      server.once("error", fail);
      server.listen(port, "127.0.0.1", () => {
        const address = server.address();
        server.close(() =>
          typeof address === "object" && address ? done(address.port) : fail(new Error("No port.")),
        );
      });
    });
  return wanted ? bind(wanted).catch(() => bind(0)) : bind(0);
}

/**
 * The port for a server of this state folder: --port or MED_PORT; else the
 * server that runs from the folder; else 6330 for Med's own folder. Another
 * folder gets a free port (`picked`), so that a second Med never takes the
 * user's port.
 */
export async function servicePort(
  stateDir: string,
  flag: string | undefined,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<{ port: number; picked?: boolean }> {
  if (flag !== undefined) return { port: givenPort(flag, environment, stateDir)! };
  const given = givenPort(undefined, environment, stateDir);
  const live = await livePorts(stateDir);
  // MED_PORT may belong to the Med that started this agent: a server that
  // runs from this folder wins, and another folder's server keeps its port.
  if (given !== undefined && (!live.length || live.includes(given))) {
    if (live.length || own(stateDir)) return { port: given };
    const port = await freePort(given);
    return port === given ? { port } : { port, picked: true };
  }
  if (live.includes(DEFAULT_PORT) || own(stateDir))
    return { port: live.length === 1 ? live[0]! : DEFAULT_PORT };
  if (live.length) return { port: live[0]! };
  return { port: await freePort(), picked: true };
}

async function privateDirectory(path: string) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  await chmod(path, 0o700);
}

/** This credential is local state, never part of a saved review link. */
export async function getPersistentToken(stateDir: string): Promise<string> {
  await privateDirectory(stateDir);
  const path = join(stateDir, "credential");
  const temporary = `${path}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    await writeFile(temporary, randomBytes(32).toString("base64url"), { flag: "wx", mode: 0o600 });
    try {
      // Link a complete file without replacing another host's credential.
      await link(temporary, path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  } finally {
    await rm(temporary, { force: true });
  }
  await chmod(path, 0o600);
  const token = (await readFile(path, "utf8")).trim();
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(token))
    throw new Error("The med credential is invalid. Check the configured state directory.");
  return token;
}

function connectionPath(stateDir: string, port: number) {
  return join(stateDir, "connections", `${port}.json`);
}

/** A descriptor is published only after the host has bound its port. */
export async function publishConnection(
  stateDir: string,
  connection: RunningConnection,
): Promise<() => Promise<void>> {
  const parsed = connectionSchema.parse(connection);
  const url = new URL(parsed.origin);
  const port = Number(url.port);
  if (parsed.origin !== `http://127.0.0.1:${port}` || port < 1 || port > 65535)
    throw new Error("The med connection must use a local IPv4 HTTP origin.");
  await privateDirectory(stateDir);
  await privateDirectory(join(stateDir, "connections"));
  const path = connectionPath(stateDir, port);
  const temporary = `${path}.${randomBytes(8).toString("hex")}.tmp`;
  const content = JSON.stringify({ ...parsed, instanceId: randomBytes(16).toString("hex") });
  try {
    await writeFile(temporary, content, { flag: "wx", mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
  return async () => {
    try {
      if ((await readFile(path, "utf8")) === content) await rm(path, { force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  };
}

/** Whether a host published this port and its process still runs. */
async function running(stateDir: string, port: number) {
  try {
    process.kill((await readConnection(stateDir, port)).pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * The port for a command without --port: the default port, or else the one
 * host that runs from this state directory on another port, such as a service
 * that kept Med's old default.
 */
export async function findPort(stateDir: string): Promise<number> {
  const live = await livePorts(stateDir);
  return live.length === 1 && !live.includes(DEFAULT_PORT) ? live[0]! : DEFAULT_PORT;
}

/** The ports of the hosts that run from this state folder. */
export async function livePorts(stateDir: string) {
  const names = await readdir(join(stateDir, "connections")).catch(() => [] as string[]);
  const live: number[] = [];
  for (const name of names) {
    const port = Number(/^(\d+)\.json$/.exec(name)?.[1]);
    if (port && (await running(stateDir, port))) live.push(port);
  }
  return live;
}

/** --port or MED_PORT; else the host that runs from this state folder. For
 * commands that talk to a running host. */
export async function clientPort(
  stateDir: string,
  flag: string | undefined,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const given = givenPort(flag, environment, stateDir);
  if (given === undefined) return findPort(stateDir);
  if (flag !== undefined) return given;
  // MED_PORT may belong to the Med that started this agent, with another folder.
  const live = await livePorts(stateDir);
  return live.length === 1 && !live.includes(given) ? live[0]! : given;
}

export async function readConnection(
  stateDir: string,
  port = DEFAULT_PORT,
): Promise<RunningConnection> {
  let connection: RunningConnection;
  try {
    connection = connectionSchema.parse(
      JSON.parse(await readFile(connectionPath(stateDir, port), "utf8")),
    );
    if (connection.origin !== `http://127.0.0.1:${port}`) throw new Error("Invalid origin");
    // A record that a stopped server left names a port that another process
    // may own now: this folder's token does not go there.
    try {
      process.kill(connection.pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") throw error;
    }
  } catch {
    throw new Error(
      own(stateDir)
        ? `No valid med connection was found on port ${port}. Start med-diff with your repositories, or select the same --port and --state-dir as the running host.`
        : `No valid med connection was found on port ${port} in ${stateDir}. Start that Med with med web --state-dir ${shellWord(stateDir)}, or select the same --port and --state-dir as the running host.`,
    );
  }
  return connection;
}
