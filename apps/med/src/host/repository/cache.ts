import { createHash } from "node:crypto";
import type { BigIntStats } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";

/** Above this many files, the signature costs about as much as Git. */
const MAX_FILES = 5000;
// Files of the common directory that HEAD, the index, packed refs, remotes,
// and a shallow clone come from.
const COMMON_FILES = ["HEAD", "index", "packed-refs", "config", "config.worktree", "shallow"];
// Files of a linked worktree's directory that `git worktree list` reads.
const WORKTREE_FILES = ["HEAD", "index", "gitdir", "locked", "config.worktree"];

const stampOf = (info: BigIntStats) =>
  info.isDirectory()
    ? `${info.dev}:${info.ino}`
    : `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
const stamp = (path: string) => lstat(path, { bigint: true }).then(stampOf, () => "-");

/**
 * A fingerprint of a repository family's Git state, from file metadata only:
 * no Git process. It changes when a ref, a HEAD, an index, the config, or a
 * worktree changes, and when a checkout's folder or `.git` entry is replaced
 * or removed. Git writes these files to a lock file and renames it, so each
 * change gives a new inode. It does not cover edits to working files; see
 * `CheckoutRevisions`. A family with more than 5,000 loose refs or worktree
 * files has no signature.
 */
export async function gitSignature(commonDir: string, checkouts: Iterable<string>) {
  const files: string[] = [];
  // Loose refs; a directory's own times change with each file, so only files count.
  const walk = async (folder: string): Promise<boolean> => {
    const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) {
        if (!(await walk(path))) return false;
      } else files.push(path);
      if (files.length > MAX_FILES) return false;
    }
    return true;
  };
  if (!(await walk(join(commonDir, "refs"))) || !(await walk(join(commonDir, "reftable"))))
    return undefined;
  files.push(...COMMON_FILES.map((name) => join(commonDir, name)));
  const worktrees = await readdir(join(commonDir, "worktrees")).catch(() => [] as string[]);
  for (const name of worktrees)
    files.push(...WORKTREE_FILES.map((file) => join(commonDir, "worktrees", name, file)));
  for (const path of new Set(checkouts)) files.push(path, join(path, ".git"));
  if (files.length > MAX_FILES) return undefined;
  files.sort();
  const stamps = await Promise.all(files.map(stamp));
  const digest = createHash("sha256");
  for (let index = 0; index < files.length; index++)
    digest.update(`${files[index]}=${stamps[index]}\n`);
  return digest.digest("base64url");
}

/**
 * Answers that stay correct while their token is the same. A request with no
 * token reads again. Requests with the same token share one read, so a read
 * must not stop when the request that started it leaves.
 */
export class Memo<T> {
  private entries = new Map<string, { token: string; value: Promise<T> }>();
  constructor(private limit = 256) {}

  get(key: string, token: string | undefined, read: () => Promise<T>): Promise<T> {
    if (token === undefined) return read();
    const hit = this.entries.get(key);
    if (hit?.token === token) {
      this.entries.delete(key);
      this.entries.set(key, hit);
      return hit.value;
    }
    const entry = { token, value: read() };
    this.entries.set(key, entry);
    // A failed read is not an answer.
    entry.value.catch(() => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
    });
    while (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value!);
    return entry.value;
  }

  clear() {
    this.entries.clear();
  }
}
