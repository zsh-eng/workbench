import { randomBytes } from "node:crypto";
import { chmod, link, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";

/** "med" on a phone keypad. Vite's preview server takes 4173, Med's old default. */
export const DEFAULT_PORT = 6330;
const connectionSchema = z.object({
  version: z.literal(1),
  origin: z.string(),
  token: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/),
  pid: z.number().int().positive(),
});
export type RunningConnection = z.infer<typeof connectionSchema>;

export function getStateDirectory(override?: string): string {
  return resolve(
    override ?? process.env.MED_STATE_DIR ?? join(homedir(), ".local", "state", "med"),
  );
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
  } catch {
    throw new Error(
      `No valid med connection was found on port ${port}. Start med-diff with your repositories, or select the same --port and --state-dir as the running host.`,
    );
  }
  return connection;
}
