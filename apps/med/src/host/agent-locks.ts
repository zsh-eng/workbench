import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { runProcess } from "./runtime/process";
import { userHome } from "./service/discover";

// Which process holds a Codex thread or an Antigravity conversation open.
// Both agents keep a lock file per conversation while a process runs it:
//
//   ~/.codex/thread-writer-locks/<thread>.lock      (removed when it closes)
//   ~/.gemini/antigravity-cli/presence/<id>.lock    (stays, unlocked)
//
// A lock file counts only while a process has it open, as `lsof` reports, so
// a file that a crash or a closed agy left behind does not. Checked with
// Codex 0.160 and agy 1.4.10; neither documents these files.

const LSOF_MS = 5000;

/** The lock folders of the agents, under `home`. */
export const lockFolders = (home = userHome()) => ({
  codex: join(home, ".codex", "thread-writer-locks"),
  agy: join(home, ".gemini", "antigravity-cli", "presence"),
});

/**
 * The IDs whose lock files a process has open in `folder`, with the
 * processes. One `lsof` reads the whole folder.
 */
export async function heldLocks(folder: string): Promise<Map<string, number[]>> {
  const held = new Map<string, number[]>();
  const names = await readdir(folder).catch(() => [] as string[]);
  if (!names.some((name) => name.endsWith(".lock") && !name.startsWith("."))) return held;
  let output: string;
  try {
    // lsof exits with 1 when no file is open.
    output = (
      await runProcess("lsof", ["-F", "pn", "+d", folder], {
        cwd: "/",
        timeoutMs: LSOF_MS,
        acceptedExitCodes: [0, 1],
        env: { LC_ALL: "C" },
      })
    ).stdout.toString();
  } catch {
    return held;
  }
  let pid = 0;
  for (const line of output.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    else if (line.startsWith("n") && line.endsWith(".lock")) {
      const id = basename(line.slice(1), ".lock");
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(id) || !pid) continue;
      held.set(id, [...new Set([...(held.get(id) ?? []), pid])]);
    }
  }
  return held;
}
