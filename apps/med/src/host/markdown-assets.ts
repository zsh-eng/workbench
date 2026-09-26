import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { dirname, extname, isAbsolute, posix, relative, resolve } from "node:path";
import type { BrowseSource } from "../shared/browse";
import { HostError } from "./runtime/errors";
import { git } from "./runtime/process";
const MAX_BYTES = 8 * 1024 * 1024;
const types: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
};
const invalid = () =>
  new HostError(
    "invalid-image",
    "Use an image within the document folder or registered repository.",
    400,
  );
/** Only image resources; never grants editing access to an asset or its folder. */
export async function markdownAsset(
  source: BrowseSource,
  document: string,
  href: string,
  signal?: AbortSignal,
) {
  if (
    !href ||
    href.length > 4096 ||
    /[\\\0]/.test(href) ||
    /^[a-z]+:/i.test(href) ||
    href.startsWith("/")
  )
    throw invalid();
  let decoded: string;
  try {
    decoded = decodeURIComponent(href.split(/[?#]/)[0]);
  } catch {
    throw invalid();
  }
  if (/[\\\0]/.test(decoded) || decoded.startsWith("/")) throw invalid();
  const path = posix.normalize(posix.join(posix.dirname(document), decoded));
  if (
    path === ".." ||
    path.startsWith("../") ||
    path.split("/").some((p) => p.toLowerCase() === ".git")
  )
    throw invalid();
  const mime = types[extname(path).toLowerCase()];
  if (!mime) throw invalid();
  signal?.throwIfAborted();
  let bytes: Buffer;
  if (source.kind === "commit") {
    const entry = (
      await git(
        source.repo,
        ["--literal-pathspecs", "ls-tree", "-z", "-l", `${source.oid}^{commit}^{tree}`, "--", path],
        { signal, maxBytes: 8192 },
      )
    ).toString("utf8");
    const match = /^(100[0-7]{3}) blob ([0-9a-f]+)\s+(\d+)\t/.exec(entry);
    if (!match || Number(match[3]) > MAX_BYTES) throw invalid();
    bytes = await git(source.repo, ["cat-file", "blob", match[2]], { signal, maxBytes: MAX_BYTES });
  } else {
    const root = await realpath(source.repo);
    const target = resolve(root, path);
    const rel = relative(root, target);
    if (
      isAbsolute(rel) ||
      rel === ".." ||
      rel.startsWith("../") ||
      (await realpath(dirname(target))) !== dirname(target)
    )
      throw invalid();
    const info = await lstat(target);
    if (!info.isFile() || info.size > MAX_BYTES) throw invalid();
    const handle = await open(
      target,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.ino !== info.ino || opened.dev !== info.dev) throw invalid();
      const buffer = Buffer.alloc(info.size + 1);
      let length = 0;
      while (length < buffer.length) {
        signal?.throwIfAborted();
        const read = await handle.read(buffer, length, buffer.length - length, length);
        if (!read.bytesRead) break;
        length += read.bytesRead;
      }
      const after = await handle.stat();
      if (
        length !== info.size ||
        after.size !== info.size ||
        after.mtimeMs !== info.mtimeMs ||
        (await realpath(dirname(target))) !== dirname(target)
      )
        throw invalid();
      bytes = buffer.subarray(0, length);
    } finally {
      await handle.close();
    }
  }
  return { bytes, mime };
}
