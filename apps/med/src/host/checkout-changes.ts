import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { git } from "./runtime/process";

// The change counts that a thread row shows for a checkout's live Changes:
// on a branch other than its base, the branch's changes since it left the
// base (its commits and its uncommitted changes); otherwise the uncommitted
// changes. The thread list never waits for Git: it takes the last counts,
// and reads run in the background, one at a time.

/** A checkout's counts are read again this often, and at most this often
 * (`RECOUNT_MS`) while one of its sessions changes. */
const CHANGES_MS = 30_000;
const RECOUNT_MS = 4000;

export interface ChangeCounts {
  files: number;
  additions: number;
  deletions: number;
}

/** A checkout's changes: tracked files from Git's numstat, against `base`'s
 * merge base or HEAD, and untracked files with their lines when they are small. */
export async function countChanges(
  path: string,
  base: string | undefined,
  signal: AbortSignal,
): Promise<ChangeCounts> {
  const options = { signal, maxBytes: 4 * 1024 * 1024, timeoutMs: 10_000 };
  const from = base
    ? (await git(path, ["merge-base", `refs/heads/${base}`, "HEAD"], options))
        .toString("utf8")
        .trim()
    : "HEAD";
  const [numstat, untracked] = await Promise.all([
    git(path, ["diff", from, "--numstat", "--no-renames", "-z"], options),
    git(path, ["ls-files", "--others", "--exclude-standard", "-z"], options),
  ]);
  const changes = { files: 0, additions: 0, deletions: 0 };
  for (const entry of numstat.toString("utf8").split("\0")) {
    const match = /^(\d+|-)\t(\d+|-)\t/.exec(entry);
    if (!match) continue;
    changes.files++;
    changes.additions += Number(match[1]) || 0;
    changes.deletions += Number(match[2]) || 0;
  }
  const paths = untracked.toString("utf8").split("\0").filter(Boolean);
  changes.files += paths.length;
  for (const file of paths.slice(0, 20)) {
    const info = await stat(join(path, file)).catch(() => undefined);
    if (!info?.isFile() || info.size > 256 * 1024) continue;
    const bytes = await readFile(join(path, file)).catch(() => undefined);
    if (!bytes || bytes.includes(0)) continue;
    const lines = bytes.toString("utf8").split("\n").length;
    changes.additions += bytes.at(-1) === 10 ? lines - 1 : lines;
  }
  return changes;
}

export function createCheckoutChanges(options: { now?: () => number } = {}) {
  const now = options.now ?? Date.now;
  const abort = new AbortController();
  const known = new Map<string, { at: number; value?: ChangeCounts }>();
  const due = new Map<string, { path: string; base?: string }>();
  let counting: Promise<void> | undefined;
  let reading: string | undefined;

  const run = () => {
    if (counting || !due.size) return;
    counting = (async () => {
      while (due.size && !abort.signal.aborted) {
        const [key, entry] = due.entries().next().value!;
        due.delete(key);
        reading = key;
        const at = now();
        const value = await countChanges(entry.path, entry.base, abort.signal).catch(
          () => undefined,
        );
        known.set(key, { at, ...(value ? { value } : {}) });
        reading = undefined;
      }
      if (known.size > 256) known.clear();
    })().finally(() => {
      counting = undefined;
      run();
    });
  };

  return {
    /**
     * The last counts of a checkout, against `base` when it is on another
     * branch. A read starts when they are old, or soon after `changedAt`, the
     * time a session in the checkout last wrote.
     */
    get(path: string, base: string | undefined, changedAt = 0) {
      const key = `${path}\0${base ?? ""}`;
      const last = known.get(key);
      const age = last ? now() - last.at : Infinity;
      if (key !== reading && (age > CHANGES_MS || (changedAt > last!.at && age > RECOUNT_MS)))
        due.set(key, { path, ...(base ? { base } : {}) });
      run();
      return last?.value;
    },
    /** Waits for the reads that run, for tests and measurements. */
    settle: async () => {
      while (counting) await counting;
    },
    close() {
      abort.abort();
    },
  };
}
