/**
 * Local images in a `spaced-changes-v1` file. A create or edit may write
 * `![alt](figs/raft.png)`, a path relative to the change set. The file is
 * read and hashed here, so a dry run already shows the final text: the link
 * becomes the Spaced file URL, `ORIGIN/api/apps/spaced/files/xxh64:<hash>`,
 * as the app writes it when it uploads an image. `--apply` uploads each file
 * (content-addressed: a second run stores nothing new) before any card.
 */
import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, resolve, sep } from "node:path";
import type { Change, ChangeSet } from "./spaced-apply";

/** The server's limit for a Spaced file (apps/sync-server/src/files.ts). */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const KINDS = "PNG, JPEG, WebP, GIF or AVIF";

export type LocalImage = {
  /** The path as the change set wrote it. */
  path: string;
  id: string;
  type: string;
  bytes: Uint8Array<ArrayBuffer>;
  /** The changes that use it, by index. */
  changes: number[];
};

/** The image's media type from its first bytes, for the types Spaced shows. */
export function imageType(bytes: Uint8Array): string | undefined {
  const ascii = (from: number, to: number) =>
    String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.length >= 8 && ascii(0, 8) === "\x89PNG\r\n\x1a\n") return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (/^GIF8[79]a$/.test(ascii(0, 6))) return "image/gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(4, 8) === "ftyp" && /^avi[fs]$/.test(ascii(8, 12))) return "image/avif";
  return undefined;
}

/**
 * The text with code blanked out, at the same offsets: fenced blocks and
 * inline code, where `![…](…)` is an example, not an image.
 */
function outsideCode(text: string) {
  let fence: string | undefined;
  const lines = text.split("\n").map((line) => {
    // CommonMark: a backtick fence's info has no backtick; a closing fence has
    // no info. Otherwise ```a``` opens nothing: it is a code span.
    const marker = /^ {0,3}(`{3,}(?=[^`]*$)|~{3,})/.exec(line)?.[1];
    if (fence) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length && !line.trim().slice(marker.length))
        fence = undefined;
      return " ".repeat(line.length);
    }
    if (marker) {
      fence = marker;
      return " ".repeat(line.length);
    }
    return line.replace(/(`+)[^`]*?\1/g, (code) => " ".repeat(code.length));
  });
  return lines.join("\n");
}

// ![alt](destination "title"): the destination may be <in angle brackets>.
const IMAGE =
  /!\[(?:[^\]\\]|\\.)*\]\(\s*(<[^<>\n]*>|[^\s()<>]+)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/dg;
const REMOTE = /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i;
/**
 * Any other link destination: a reference definition, `<img src>`, or a link
 * whose text or path IMAGE does not read (brackets, parentheses). A local one
 * left after the rewrite would show as a broken image, so it is a problem.
 */
const OTHER =
  /\]\(\s*<?([^\s)>]+)|^ {0,3}\[[^\]]+\]:\s*<?([^\s>]+)|<img\b[^>]*?\ssrc\s*=\s*["']?([^"'\s>]+)/gim;

/**
 * Rewrites every local image in the creates and edits to its Spaced URL.
 * Returns the rewritten set, the files to upload, and a problem for each
 * link that cannot be uploaded (missing, too large, or not an image).
 */
export function resolveImages(set: ChangeSet, directory: string, origin: string) {
  const images = new Map<string, LocalImage>();
  const problems: string[] = [];
  const read = new Map<string, LocalImage | string>();
  const load = (path: string): LocalImage | string => {
    if (isAbsolute(path)) return "use a path relative to the change set";
    let file = resolve(directory, path);
    const inside = (file: string) => {
      const root = realpathSync(directory);
      return realpathSync(file).startsWith(root + sep);
    };
    let size: number;
    try {
      size = statSync(file).size;
    } catch {
      // A Markdown link may encode a space as %20.
      try {
        file = resolve(directory, decodeURI(path));
        size = statSync(file).size;
      } catch {
        return "not found";
      }
    }
    if (!statSync(file).isFile()) return "not a file";
    if (!inside(file)) return "outside the change set's folder";
    if (size > MAX_IMAGE_BYTES)
      return `${(size / 1024 / 1024).toFixed(1)} MiB, over Spaced's 2 MiB limit`;
    const bytes = new Uint8Array(readFileSync(file));
    const type = imageType(bytes);
    if (!type) return `not a ${KINDS} image`;
    const id = `xxh64:${Bun.hash.xxHash64(bytes).toString(16).padStart(16, "0")}`;
    return { path, id, type, bytes, changes: [] };
  };
  const rewrite = (text: string, where: string, index: number) => {
    const visible = outsideCode(text);
    const reported = new Set<string>();
    let out = "";
    let at = 0;
    for (const match of visible.matchAll(IMAGE)) {
      const written = match[1]!;
      const path = written.startsWith("<") ? written.slice(1, -1) : written;
      if (!path || REMOTE.test(path)) continue;
      let image = read.get(path);
      if (image === undefined) read.set(path, (image = load(path)));
      if (typeof image === "string") {
        problems.push(`${where}: ${path}: ${image}`);
        reported.add(path);
        continue;
      }
      const kept = images.get(image.id) ?? image;
      images.set(kept.id, kept);
      if (!kept.changes.includes(index)) kept.changes.push(index);
      // The destination's offset in the original text, which `visible` keeps.
      const [start, end] = match.indices![1]!;
      out += text.slice(at, start) + `${origin}/api/apps/spaced/files/${kept.id}`;
      at = end;
    }
    out += text.slice(at);
    for (const match of outsideCode(out).matchAll(OTHER)) {
      const path = match[1] ?? match[2] ?? match[3]!;
      if (!REMOTE.test(path) && !reported.has(path))
        problems.push(`${where}: ${path}: a local link wb does not upload; write an image as ![alt](path)`);
    }
    return out;
  };
  const changes = set.changes.map((change, index): Change => {
    if (change.action !== "create" && change.action !== "edit") return change;
    const where = `changes[${index}]`;
    // `expect` is compared with the card, which holds the Spaced URLs.
    const expect = change.action === "edit" && change.expect;
    return {
      ...change,
      front: rewrite(change.front, `${where}.front`, index),
      back: rewrite(change.back, `${where}.back`, index),
      ...(expect && {
        expect: {
          ...expect,
          ...(typeof expect.front === "string" && { front: rewrite(expect.front, `${where}.expect.front`, index) }),
          ...(typeof expect.back === "string" && { back: rewrite(expect.back, `${where}.expect.back`, index) }),
        },
      }),
    };
  });
  return { set: { ...set, changes }, images: [...images.values()], problems };
}
