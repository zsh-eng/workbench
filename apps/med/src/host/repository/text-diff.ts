import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, posix } from "node:path";
import { HostError } from "../runtime/errors";
import { git, runProcess } from "../runtime/process";
import { MAX_PATCH_BYTES } from "./review";

// Diffs of texts that a saved review captured, with Git's own diff, so they
// read as the diffs that Git makes in a checkout. Nothing here needs the
// repository: a force push or a removed worktree does not matter.

const FLAGS = ["--no-index", "--no-color", "--no-ext-diff", "--no-textconv", "--no-renames"];

/** A changed run of lines: old lines [oldStart, oldEnd) became new lines [newStart, newEnd). */
export interface LineChange {
  oldStart: number;
  oldEnd: number;
  newStart: number;
  newEnd: number;
}

async function inTemp<T>(work: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "med-diff-"));
  try {
    return await work(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function put(dir: string, name: string, text: string) {
  const file = join(dir, name);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, text);
  return name;
}

/** A path as a relative file name, or an error for one that leaves its folder. */
function relativeName(path: string) {
  const name = posix.normalize(path);
  if (!name || name.startsWith("/") || name === ".." || name.startsWith("../") || name === ".")
    throw new HostError("invalid-path", "A saved file path must be relative.", 422);
  return name;
}

/**
 * The patch of one file from `before` to `after`, with `path` on both sides,
 * as `git diff` prints a change in a checkout. Empty when the texts are equal.
 */
export async function textPatch(path: string, before: string, after: string, signal?: AbortSignal) {
  if (before === after) return "";
  const name = relativeName(path);
  return inTemp(async (dir) => {
    // The files are named a/<path> and b/<path>, so with no prefix the header
    // names the path as Git would, quoted where Git quotes it.
    const a = await put(dir, `a/${name}`, before);
    const b = await put(dir, `b/${name}`, after);
    const patch = await git(dir, ["diff", ...FLAGS, "--no-prefix", "--full-index", "--", a, b], {
      signal,
      acceptedExitCodes: [0, 1],
      maxBytes: MAX_PATCH_BYTES,
    });
    return patch.toString("utf8");
  });
}

/** The runs of lines that differ between two texts, from `git diff -U0`. */
export async function lineChanges(
  before: string,
  after: string,
  signal?: AbortSignal,
): Promise<LineChange[]> {
  if (before === after) return [];
  return inTemp(async (dir) => {
    const a = await put(dir, "a", before);
    const b = await put(dir, "b", after);
    const patch = (
      await git(dir, ["diff", ...FLAGS, "--unified=0", "--", a, b], {
        signal,
        acceptedExitCodes: [0, 1],
        maxBytes: MAX_PATCH_BYTES,
      })
    ).toString("utf8");
    const changes: LineChange[] = [];
    for (const match of patch.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)) {
      const [a, b, c, d] = [match[1], match[2] ?? "1", match[3], match[4] ?? "1"].map(Number) as [
        number,
        number,
        number,
        number,
      ];
      // An empty side names the line before the change.
      const oldStart = b ? a : a + 1;
      const newStart = d ? c : c + 1;
      changes.push({ oldStart, oldEnd: oldStart + b, newStart, newEnd: newStart + d });
    }
    return changes;
  });
}

/**
 * Where a line of one text is in the other: `null` for a line that changed.
 * `reverse` maps a line of the new text to the old one.
 */
export function mapLine(changes: readonly LineChange[], line: number, reverse = false) {
  let shift = 0;
  for (const change of changes) {
    const [start, end, otherEnd] = reverse
      ? [change.newStart, change.newEnd, change.oldEnd]
      : [change.oldStart, change.oldEnd, change.newEnd];
    if (line < start) break;
    if (line < end) return null;
    shift = otherEnd - end;
  }
  return line + shift;
}

/**
 * A change replayed on another base: `git merge-file` applies the change from
 * `base` to `changed` onto `onto`. Undefined when the two conflict.
 */
export async function replay(changed: string, base: string, onto: string, signal?: AbortSignal) {
  if (base === onto) return changed;
  return inTemp(async (dir) => {
    const files = await Promise.all([
      put(dir, "changed", changed),
      put(dir, "base", base),
      put(dir, "onto", onto),
    ]);
    // The exit status counts the conflicts; a merge with one is left out.
    const merged = await runProcess("git", ["merge-file", "-p", "--quiet", ...files], {
      cwd: dir,
      signal,
      env: { LC_ALL: "C" },
      acceptedExitCodes: Array.from({ length: 128 }, (_, index) => index),
      maxBytes: MAX_PATCH_BYTES,
    });
    return merged.exitCode === 0 ? merged.stdout.toString("utf8") : undefined;
  });
}
