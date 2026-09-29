import { mediaType, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES } from "../../shared/media";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath, rename, unlink } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import {
  browseSourceSchema,
  type BrowseEntry,
  type BrowseList,
  type BrowseRead,
  type BrowseSource,
} from "../../shared/browse";
import { HostError } from "../runtime/errors";
import { git } from "../runtime/process";

export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_FILE_LINES = 200_000;
export const MAX_FILE_LINE_LENGTH = 250_000;
export const MAX_BROWSE_ENTRIES = 50_000;
const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
const PLAIN_BYTES = 1024 * 1024;
const LONG_LINE = 20_000;
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function validPath(path: string) {
  return (
    path.length > 0 &&
    path.length <= 4096 &&
    !isAbsolute(path) &&
    !path.includes("\\") &&
    !path.includes("\0") &&
    path
      .split("/")
      .every(
        (part) => part !== "" && part !== "." && part !== ".." && part.toLowerCase() !== ".git",
      )
  );
}
function confined(root: string, path: string) {
  const rel = relative(root, path);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith("../"));
}
function missing(error: unknown) {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}
async function sourceRoot(input: BrowseSource, signal?: AbortSignal): Promise<BrowseSource> {
  signal?.throwIfAborted();
  const source = browseSourceSchema.parse(input);
  const repo = await realpath(source.repo);
  if (repo !== resolve(source.repo))
    throw new HostError(
      "repository-changed",
      "This workspace path changed. Reopen the workspace.",
      409,
    );
  signal?.throwIfAborted();
  return { ...source, repo };
}

/** Refuse symlink ancestors, including links whose targets remain inside the checkout. */
async function parentSafe(repo: string, path: string) {
  const parent = dirname(resolve(repo, path));
  const canonical = await realpath(parent);
  if (!confined(repo, canonical) || canonical !== parent) return false;
  // A linked Git repository or submodule is a separate source, not a child folder.
  let directory = parent;
  while (directory !== repo) {
    try {
      await lstat(resolve(directory, ".git"));
      return false;
    } catch (error) {
      if (!missing(error)) throw error;
    }
    directory = dirname(directory);
  }
  return true;
}

function treeEntry(record: string): (BrowseEntry & { oid: string; size: number }) | undefined {
  const match = /^(\d+) (blob|tree|commit) ([0-9a-f]+)\s+(-|\d+)\t([\s\S]+)$/.exec(record);
  if (!match || !validPath(match[5]!)) return;
  return {
    path: match[5]!,
    oid: match[3]!,
    size: Number(match[4]) || 0,
    kind:
      match[1] === "120000"
        ? "symlink"
        : match[2] === "commit"
          ? "submodule"
          : match[2] === "tree"
            ? "directory"
            : "file",
  };
}
function finishList(source: BrowseSource, candidates: BrowseEntry[]): BrowseList {
  const entries = new Map<string, BrowseEntry>();
  let bytes = 0;
  let truncated = false;
  const add = (entry: BrowseEntry) => {
    if (entries.has(entry.path)) return;
    const cost = Buffer.byteLength(entry.path) + 64;
    if (entries.size >= MAX_BROWSE_ENTRIES || bytes + cost > MAX_MANIFEST_BYTES) {
      truncated = true;
      return;
    }
    entries.set(entry.path, entry);
    bytes += cost;
  };
  for (const entry of candidates) {
    const parts = entry.path.split("/");
    for (let i = 1; i < parts.length; i++)
      add({ path: parts.slice(0, i).join("/"), kind: "directory" });
    add(entry);
    if (truncated) break;
  }
  return {
    source,
    entries: [...entries.values()].sort((a, b) => a.path.localeCompare(b.path)),
    truncated,
  };
}

/** Git enumerates paths without following symlinks or entering submodules. */
export async function listBrowse(
  input: BrowseSource,
  ignored = false,
  signal?: AbortSignal,
): Promise<BrowseList> {
  const source = await sourceRoot(input, signal);
  if (source.kind === "commit") {
    const output = await git(
      source.repo,
      ["ls-tree", "-r", "-z", "-l", `${source.oid}^{commit}^{tree}`],
      {
        signal,
        maxBytes: MAX_MANIFEST_BYTES,
      },
    );
    const entries = output
      .toString("utf8")
      .split("\0")
      .flatMap((record) => {
        const entry = treeEntry(record);
        return entry ? [{ path: entry.path, kind: entry.kind }] : [];
      });
    return finishList(source, entries);
  }
  const [tracked, others] = await Promise.all([
    git(source.repo, ["ls-files", "--stage", "-z"], { signal, maxBytes: MAX_MANIFEST_BYTES }),
    git(source.repo, ["ls-files", "--others", ...(ignored ? [] : ["--exclude-standard"]), "-z"], {
      signal,
      maxBytes: MAX_MANIFEST_BYTES,
    }),
  ]);
  const paths = new Map<string, BrowseEntry>();
  for (const record of tracked.toString("utf8").split("\0")) {
    const match = /^(\d+) [0-9a-f]+ \d\t([\s\S]+)$/.exec(record);
    if (match && validPath(match[2]!))
      paths.set(match[2]!, { path: match[2]!, kind: match[1] === "160000" ? "submodule" : "file" });
  }
  for (const item of others.toString("utf8").split("\0")) {
    const path = item.replace(/\/$/, "");
    if (validPath(path) && !paths.has(path))
      paths.set(path, { path, kind: item.endsWith("/") ? "submodule" : "file", status: "?" });
  }
  const candidates = [...paths.values()].slice(0, MAX_BROWSE_ENTRIES + 1);
  const present: BrowseEntry[] = [];
  // Validate each directory once per request. Reads validate again and never follow links.
  const parents = new Map<string, Promise<boolean>>();
  for (let offset = 0; offset < candidates.length; offset += 64) {
    signal?.throwIfAborted();
    const batch = await Promise.all(
      candidates.slice(offset, offset + 64).map(async (entry) => {
        try {
          const dir = dirname(entry.path);
          let safe = parents.get(dir);
          if (!safe) {
            safe = parentSafe(source.repo, entry.path);
            parents.set(dir, safe);
          }
          if (!(await safe)) return;
          const info = await lstat(resolve(source.repo, entry.path));
          if (info.isSymbolicLink()) return { ...entry, kind: "symlink" as const };
          if (info.isFile() || (entry.kind === "submodule" && info.isDirectory())) return entry;
        } catch (error) {
          if (!missing(error)) throw error;
        }
      }),
    );
    for (const entry of batch) if (entry) present.push(entry);
  }
  signal?.throwIfAborted();
  const result = finishList(source, present);
  result.truncated ||= paths.size > MAX_BROWSE_ENTRIES;
  return result;
}

function classify(source: BrowseSource, path: string, bytes: Buffer, identity: string): BrowseRead {
  const base = { source, path, size: bytes.byteLength, identity };
  // Reject common binary formats even when a small header happens to be valid UTF-8.
  if (
    bytes.includes(0) ||
    // Binary signatures intentionally contain control bytes.
    // oxlint-disable-next-line no-control-regex
    /^(?:%PDF-|GIF8[79]a|PK\x03\x04|RIFF|ID3|OggS|fLaC)/.test(
      bytes.subarray(0, 16).toString("latin1"),
    )
  )
    return { ...base, kind: "binary", reason: "Binary files have no content preview." };
  let text: string;
  try {
    text = decoder.decode(bytes);
  } catch {
    return { ...base, kind: "unsupported", reason: "This file is not valid UTF-8 text." };
  }
  // Control bytes outside text whitespace indicate binary content.
  // oxlint-disable-next-line no-control-regex
  if (/[\x01-\x08\x0e-\x1f\x7f]/.test(text))
    return { ...base, kind: "binary", reason: "Binary files have no content preview." };
  let start = 0;
  let lines = 1;
  let longLine = false;
  for (let i = 0; i <= text.length; i++) {
    if (i - start > MAX_FILE_LINE_LENGTH)
      return {
        ...base,
        kind: "too-large",
        reason: "A line exceeds the 250,000-character preview limit.",
      };
    if (i === text.length || text.charCodeAt(i) === 10) {
      longLine ||= i - start > LONG_LINE;
      if (i < text.length && ++lines > MAX_FILE_LINES)
        return {
          ...base,
          kind: "too-large",
          reason: "This file exceeds the 200,000-line preview limit.",
        };
      start = i + 1;
    }
  }
  return { ...base, kind: "text", text, plain: bytes.byteLength > PLAIN_BYTES || longLine };
}

export async function readBrowse(
  input: BrowseSource,
  path: string,
  signal?: AbortSignal,
): Promise<BrowseRead> {
  if (!validPath(path))
    throw new HostError("invalid-path", "Use a file path within this workspace.", 400);
  const source = await sourceRoot(input, signal);
  const base = {
    source,
    path,
    size: 0,
    identity: `${source.kind}:${source.repo}:${source.kind === "commit" ? source.oid : "current"}:${path}`,
  };
  if (source.kind === "commit") {
    const output = await git(
      source.repo,
      ["--literal-pathspecs", "ls-tree", "-z", "-l", `${source.oid}^{commit}^{tree}`, "--", path],
      { signal, maxBytes: 8192 },
    );
    const entry = output
      .toString("utf8")
      .split("\0")
      .map(treeEntry)
      .find((entry) => entry?.path === path);
    if (!entry)
      return { ...base, kind: "missing", reason: "This file does not exist at this commit." };
    const metadata = { ...base, size: entry.size, identity: `${base.identity}:${entry.oid}` };
    if (entry.kind !== "file")
      return {
        ...metadata,
        kind: "unsupported",
        reason: "Links, directories, and submodules have no content preview.",
      };
    const media = mediaType(path);
    if (media && entry.size <= (media.kind === "image" ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES))
      return { ...metadata, kind: media.kind, media };
    if (media)
      return {
        ...metadata,
        kind: "too-large",
        reason: `This ${media.kind} exceeds the ${media.kind === "image" ? "32 MiB" : "4 GiB"} media limit.`,
      };
    if (entry.size > MAX_FILE_BYTES)
      return {
        ...metadata,
        kind: "too-large",
        reason: "This file exceeds the 8 MiB preview limit.",
      };
    const bytes = await git(source.repo, ["cat-file", "blob", entry.oid], {
      signal,
      maxBytes: MAX_FILE_BYTES,
    });
    signal?.throwIfAborted();
    return classify(source, path, bytes, metadata.identity);
  }
  try {
    if (!(await parentSafe(source.repo, path)))
      return {
        ...base,
        kind: "unsupported",
        reason: "Paths through symbolic links or nested repositories have no content preview.",
      };
    const target = resolve(source.repo, path);
    const info = await lstat(target);
    const metadata = {
      ...base,
      size: info.size,
      identity: `${base.identity}:${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`,
    };
    if (!info.isFile())
      return {
        ...metadata,
        kind: "unsupported",
        reason: "Links, directories, and special files have no content preview.",
      };
    const media = mediaType(path);
    if (media && info.size <= (media.kind === "image" ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES))
      return { ...metadata, kind: media.kind, media };
    if (media)
      return {
        ...metadata,
        kind: "too-large",
        reason: `This ${media.kind} exceeds the ${media.kind === "image" ? "32 MiB" : "4 GiB"} media limit.`,
      };
    if (info.size > MAX_FILE_BYTES)
      return {
        ...metadata,
        kind: "too-large",
        reason: "This file exceeds the 8 MiB preview limit.",
      };
    signal?.throwIfAborted();
    const handle = await open(
      target,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const opened = await handle.stat();
      if (
        !opened.isFile() ||
        opened.dev !== info.dev ||
        opened.ino !== info.ino ||
        !(await parentSafe(source.repo, path))
      )
        throw new HostError("file-changed", "This file changed while opening. Retry.", 409);
      // Allocate only the measured size plus one byte. Detect growth without an unbounded read.
      const bytes = Buffer.alloc(Math.min(info.size + 1, MAX_FILE_BYTES + 1));
      let length = 0;
      while (length < bytes.length) {
        signal?.throwIfAborted();
        const read = await handle.read(
          bytes,
          length,
          Math.min(64 * 1024, bytes.length - length),
          length,
        );
        if (read.bytesRead === 0) break;
        length += read.bytesRead;
      }
      const after = await handle.stat();
      const current = await lstat(target);
      signal?.throwIfAborted();
      if (
        length !== info.size ||
        after.size !== info.size ||
        after.mtimeMs !== info.mtimeMs ||
        after.ctimeMs !== info.ctimeMs ||
        current.ino !== info.ino ||
        current.dev !== info.dev ||
        !(await parentSafe(source.repo, path))
      )
        throw new HostError("file-changed", "This file changed while reading. Retry.", 409);
      const content = bytes.subarray(0, length);
      const identity = `${base.identity}:${createHash("sha256").update(content).digest("hex")}`;
      return classify(source, path, content, identity);
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (missing(error))
      return { ...base, kind: "missing", reason: "This file does not exist in this worktree." };
    throw error;
  }
}

// Serialize med saves per path. External edits are checked again just before replace.
const pendingWrites = new Map<string, Promise<unknown>>();
export async function writeBrowse(
  source: BrowseSource,
  path: string,
  expectedIdentity: string,
  text: string,
  assertAccess: () => void = () => {},
): Promise<BrowseRead> {
  if (source.kind !== "worktree")
    throw new HostError("read-only", "Commit files are read-only.", 400);
  if (!validPath(path))
    throw new HostError("invalid-path", "Use a file path within this workspace.", 400);
  const content = Buffer.from(text, "utf8");
  if (content.length > 1024 * 1024)
    throw new HostError("file-too-large", "Editing is limited to 1 MiB files.", 413);
  const proposed = classify(source, path, content, "draft");
  if (content.toString("utf8") !== text || proposed.kind !== "text" || proposed.truncated)
    throw new HostError(
      "unsupported-content",
      "The draft must be complete UTF-8 text within the preview limits.",
      400,
    );
  const key = JSON.stringify([source.repo, path]);
  const previous = pendingWrites.get(key);
  const task = (async () => {
    await previous?.catch(() => {});
    assertAccess();
    const current = await readBrowse(source, path);
    if (current.kind !== "text" || current.truncated || current.size > 1024 * 1024)
      throw new HostError(
        "read-only",
        "Only complete UTF-8 text files up to 1 MiB can be edited.",
        400,
      );
    const conflict = () =>
      new HostError(
        "file-changed",
        "This file changed on disk. Your draft is kept. Reload the file before saving again.",
        409,
      );
    if (current.identity !== expectedIdentity) throw conflict();
    const target = resolve(current.source.repo, path);
    const info = await lstat(target);
    if (!info.isFile() || info.nlink !== 1)
      throw new HostError("read-only", "Linked files cannot be replaced by this editor.", 400);
    const temporary = resolve(dirname(target), `.med-save-${randomUUID()}`);
    const handle = await open(
      temporary,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      0o600,
    );
    try {
      await handle.writeFile(content);
      await handle.chmod(info.mode & 0o777);
      await handle.sync();
      await handle.close();
      const latest = await readBrowse(current.source, path);
      const latestInfo = await lstat(target);
      if (
        latest.identity !== expectedIdentity ||
        latestInfo.ino !== info.ino ||
        latestInfo.dev !== info.dev ||
        latestInfo.mtimeMs !== info.mtimeMs ||
        latestInfo.ctimeMs !== info.ctimeMs
      )
        throw conflict();
      if (!(await parentSafe(current.source.repo, path))) throw conflict();
      assertAccess();
      await rename(temporary, target);
      return classify(
        current.source,
        path,
        content,
        `worktree:${current.source.repo}:current:${path}:${createHash("sha256").update(content).digest("hex")}`,
      );
    } finally {
      await handle.close().catch(() => {});
      await unlink(temporary).catch(() => {});
    }
  })();
  pendingWrites.set(key, task);
  try {
    return await task;
  } finally {
    if (pendingWrites.get(key) === task) pendingWrites.delete(key);
  }
}
