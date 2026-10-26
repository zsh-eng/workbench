import { constants } from "node:fs";
import { lstat, open, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  generatedByHeader,
  generatedByPath,
  HEADER_LINES,
  type GeneratedMark,
} from "../../shared/generated";
import { git } from "../runtime/process";

// Marks the files of a review that a tool writes (docs/GENERATED.md): Git
// attributes first, then the path, then the header. No step runs Git unless
// the checkout has an attributes file.

/** At most this many working files are read for their header in one review. */
const MAX_HEADS = 1000;
const HEAD_BYTES = 1024;
const PARALLEL_READS = 16;

export interface GeneratedInput {
  path: string;
  status: string;
  binary: boolean;
  tooLarge?: boolean;
  newMode?: string;
  /** The first lines of the new side, when the patch shows line 1. */
  head?: string[];
  generated?: GeneratedMark | false;
}

/** The new side's first lines in one file's patch, when its first hunk starts there. */
export function patchHead(section: string): string[] | undefined {
  const start = section.indexOf("\n@@ ");
  if (start < 0) return undefined;
  const header = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(section.slice(start + 1));
  if (!header || Number(header[1]) > 1) return undefined;
  const lines: string[] = [];
  let index = section.indexOf("\n", start + 1) + 1;
  while (index > 0 && index < section.length && lines.length < HEADER_LINES) {
    const end = section.indexOf("\n", index);
    const line = section.slice(index, end < 0 ? undefined : end);
    if (line.startsWith("@@")) break;
    if (line.startsWith("+") || line.startsWith(" ")) lines.push(line.slice(1));
    if (end < 0) break;
    index = end + 1;
  }
  return lines;
}

/** The Git directory that attributes in `info/` come from, read from the
 * checkout's `.git` entry: a folder, or a file that names a linked worktree's
 * folder, whose `commondir` names the shared one. */
async function commonDirectory(repo: string): Promise<string | undefined> {
  const entry = join(repo, ".git");
  const info = await lstat(entry).catch(() => undefined);
  if (info?.isDirectory()) return entry;
  if (!info?.isFile()) return undefined;
  const pointer = /^gitdir: (.+)$/m.exec(await readFile(entry, "utf8").catch(() => ""))?.[1];
  if (!pointer) return undefined;
  const own = resolve(repo, pointer.trim());
  const common = (await readFile(join(own, "commondir"), "utf8").catch(() => "")).trim();
  return common ? resolve(own, common) : own;
}

/** Whether Git attributes can apply: a `.gitattributes` at the checkout's
 * root, or the repository's `info/attributes`. A nested `.gitattributes`
 * alone is not read. */
async function hasAttributes(repo: string) {
  const exists = (path: string) =>
    lstat(path).then(
      (info) => info.isFile(),
      () => false,
    );
  if (await exists(join(repo, ".gitattributes"))) return true;
  const common = await commonDirectory(repo);
  return common ? exists(join(common, "info", "attributes")) : false;
}

/** `linguist-generated` and `diff` of each path: true marks a file, false
 * unmarks it, and a path without either is left out. */
async function readAttributes(
  repo: string,
  paths: readonly string[],
  source: { kind: "worktree" } | { kind: "index" } | { kind: "tree"; oid: string },
  signal?: AbortSignal,
) {
  const args = ["check-attr", "-z", "--stdin"];
  if (source.kind === "index") args.push("--cached");
  if (source.kind === "tree") args.push(`--source=${source.oid}`);
  args.push("linguist-generated", "diff");
  const output = (
    await git(repo, args, {
      signal,
      input: paths.join("\0") + "\0",
      maxBytes: 8 * 1024 * 1024,
    })
  )
    .toString("utf8")
    .split("\0");
  const marks = new Map<string, boolean>();
  for (let index = 0; index + 2 < output.length; index += 3) {
    const [path, attribute, value] = [output[index]!, output[index + 1], output[index + 2]];
    if (attribute === "linguist-generated") {
      if (value === "set" || value === "true") marks.set(path, true);
      else if (value === "unset" || value === "false") marks.set(path, false);
    } else if (attribute === "diff" && value === "unset" && !marks.has(path)) marks.set(path, true);
  }
  return marks;
}

/** The first lines of a working file, without following a link out of the checkout. */
async function workingHead(
  repo: string,
  realRepo: string,
  path: string,
  folders: Map<string, boolean>,
): Promise<string[] | undefined> {
  const absolute = resolve(repo, path);
  const rel = relative(repo, absolute);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return undefined;
  const folder = dirname(absolute);
  let inside = folders.get(folder);
  if (inside === undefined) {
    const real = await realpath(folder).catch(() => "");
    const within = real ? relative(realRepo, real) : "..";
    inside = within !== ".." && !within.startsWith(`..${sep}`) && !isAbsolute(within);
    folders.set(folder, inside);
  }
  if (!inside) return undefined;
  const handle = await open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)).catch(
    () => undefined,
  );
  if (!handle) return undefined;
  try {
    if (!(await handle.stat()).isFile()) return undefined;
    const buffer = Buffer.alloc(HEAD_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, HEAD_BYTES, 0);
    const bytes = buffer.subarray(0, bytesRead);
    if (bytes.includes(0)) return undefined;
    return bytes.toString("utf8").split("\n").slice(0, HEADER_LINES);
  } finally {
    await handle.close();
  }
}

/**
 * Sets `generated` on each file that a tool writes. `worktree` reads the
 * head of working files that the patch does not show from their start;
 * `attributes` names where Git attributes come from.
 */
export async function markGenerated(
  repo: string,
  files: GeneratedInput[],
  options: {
    attributes?: { kind: "worktree" } | { kind: "index" } | { kind: "tree"; oid: string };
    worktree?: boolean;
    signal?: AbortSignal;
  } = {},
) {
  if (!files.length) return;
  const attributes =
    options.attributes && (await hasAttributes(repo))
      ? await readAttributes(
          repo,
          files.map((file) => file.path),
          options.attributes,
          options.signal,
        )
      : undefined;
  const unread: GeneratedInput[] = [];
  for (const file of files) {
    const attribute = attributes?.get(file.path);
    if (attribute === false) {
      // Unmarked: only a mark that the path rule would give needs saying.
      if (generatedByPath(file.path)) file.generated = false;
      continue;
    }
    const mark =
      generatedByPath(file.path) ??
      (attribute ? ({ kind: "attributes" } as const) : null) ??
      (file.head ? generatedByHeader(file.head) : null);
    if (mark) file.generated = mark;
    else if (
      options.worktree &&
      !file.head &&
      file.status !== "D" &&
      !file.binary &&
      !file.tooLarge &&
      (!file.newMode || /^100[0-7]{3}$/.test(file.newMode))
    )
      unread.push(file);
  }
  if (!unread.length) return;
  const realRepo = await realpath(repo).catch(() => repo);
  const folders = new Map<string, boolean>();
  const queue = unread.slice(0, MAX_HEADS);
  const worker = async () => {
    for (let file = queue.shift(); file; file = queue.shift()) {
      options.signal?.throwIfAborted();
      const head = await workingHead(repo, realRepo, file.path, folders);
      const mark = head && generatedByHeader(head);
      if (mark) file.generated = mark;
    }
  };
  await Promise.all(Array.from({ length: PARALLEL_READS }, worker));
}
