import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** When a process started, as Claude Code records it: `ps -o lstart=` in
 * the C locale and UTC, such as "Thu Oct 15 09:12:03 2026". */
export const processStart = (pid: number) =>
  execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], {
    env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
  })
    .toString()
    .trim();

/** A process that runs until the test ends it. Its arguments name no session
 * unless `args` does. */
export async function longProcess(args: string[] = []) {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", ...args], {
    stdio: "ignore",
  });
  const exited = once(child, "exit");
  await once(child, "spawn");
  return {
    pid: child.pid!,
    async end() {
      child.kill();
      await exited;
    },
  };
}

/** Writes the record that Claude Code keeps for a process in `<home>/.claude/sessions/<pid>.json`. */
export async function writeProcessRecord(home: string, pid: number, record: object | string) {
  const folder = join(home, ".claude", "sessions");
  await mkdir(folder, { recursive: true });
  await writeFile(
    join(folder, `${pid}.json`),
    typeof record === "string" ? record : JSON.stringify(record),
  );
}

/**
 * Claude Code with a session open: a process that runs, and its record, with
 * the fields that Claude Code 2.1 writes. `entrypoint` is `cli` in a
 * terminal and `claude-desktop` in the Claude app; `null` leaves it out.
 */
export async function openSession(
  home: string,
  sessionId: string,
  entrypoint: string | null = "cli",
) {
  const process = await longProcess();
  await writeProcessRecord(home, process.pid, {
    pid: process.pid,
    sessionId,
    cwd: "/work/repo",
    startedAt: Date.now(),
    procStart: processStart(process.pid),
    version: "2.1.295",
    kind: "interactive",
    ...(entrypoint === null ? {} : { entrypoint }),
    status: "idle",
  });
  return process;
}
