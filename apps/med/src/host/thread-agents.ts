import { mkdir, writeFile } from "node:fs/promises";
import { basename, delimiter, join } from "node:path";

/** The command that runs this Med again: its executable, or a runtime and its script. */
export function ownCommand(): string[] {
  const runtime = /^(node|nodejs|bun)(\.exe)?$/.test(basename(process.execPath));
  return runtime && process.argv[1] ? [process.execPath, process.argv[1]] : [process.execPath];
}

/**
 * Writes a `med` command in `directory` that runs `command`, so the agents that
 * Med starts use this host's version even when `med` is not on PATH.
 */
export async function writeMedCommand(directory: string, command: readonly string[]) {
  const quote = (word: string) => `'${word.replaceAll("'", `'\\''`)}'`;
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "med"),
    `#!/bin/sh\nexec ${command.map(quote).join(" ")} "$@"\n`,
    { mode: 0o755 },
  );
}

/** Variables for an agent that Med starts: how to reach this host, and its thread. */
export function ownedEnvironment(options: {
  port: number;
  stateDir?: string;
  bin?: string;
  thread?: { key: string; repo: string };
}): Record<string, string> {
  return {
    MED_SESSION: "owned",
    MED_PORT: String(options.port),
    ...(options.stateDir ? { MED_STATE_DIR: options.stateDir } : {}),
    ...(options.thread
      ? { MED_THREAD_KEY: options.thread.key, MED_THREAD_REPO: options.thread.repo }
      : {}),
    ...(options.bin ? { PATH: [options.bin, process.env.PATH ?? ""].join(delimiter) } : {}),
  };
}
