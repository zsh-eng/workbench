import { constants, realpathSync, openSync, fstatSync, readSync, closeSync } from "node:fs";
import { readdir, realpath, stat } from "node:fs/promises";
import { join, relative } from "node:path";

export interface VaultFile {
  path: string;
  size: number;
  fingerprint: string;
  markdown: boolean;
}
export const MAX_NOTE_BYTES = 4 * 1024 * 1024;
const excluded = new Set(["node_modules", "__pycache__", "venv"]);
export async function catalogue(root: string): Promise<VaultFile[]> {
  const files: VaultFile[] = [];
  let directories = [root];
  while (directories.length) {
    const batch = directories.splice(0, 8);
    const children = await Promise.all(
      batch.map(async (directory) => {
        if ((await realpath(directory)) !== directory)
          throw new Error("Vault directory changed during enumeration.");
        return { directory, entries: await readdir(directory, { withFileTypes: true }) };
      }),
    );
    const pending: string[] = [];
    for (const { directory, entries } of children)
      for (const entry of entries) {
        if (entry.name.startsWith(".") || excluded.has(entry.name)) continue;
        const path = join(directory, entry.name);
        if (entry.isDirectory()) directories.push(path);
        else if (entry.isFile()) pending.push(path);
      }
    for (let offset = 0; offset < pending.length; offset += 16) {
      const rows = await Promise.all(
        pending.slice(offset, offset + 16).map(async (path) => {
          const info = await stat(path);
          return {
            path: relative(root, path).split("\\").join("/"),
            size: info.size,
            fingerprint: `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`,
            markdown: /\.(?:md|markdown)$/i.test(path),
          };
        }),
      );
      files.push(...rows);
      if (files.length > 100_000)
        throw new Error("Vault exceeds the 100,000-file catalogue limit.");
    }
  }
  return files;
}

// Runs in the dedicated index command (and later an index worker), never a host request.
export function readNote(root: string, file: VaultFile): string {
  const path = join(root, file.path);
  if (realpathSync(path) !== path) throw new Error("Vault file changed into a symbolic link.");
  const handle = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(handle);
    if (!before.isFile() || before.size > MAX_NOTE_BYTES)
      throw new Error("Note exceeds the text limit.");
    const bytes = Buffer.alloc(before.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = readSync(handle, bytes, length, bytes.length - length, null);
      if (!read) break;
      length += read;
    }
    const after = fstatSync(handle);
    const fingerprint = `${after.dev}:${after.ino}:${after.size}:${after.mtimeMs}:${after.ctimeMs}`;
    if (length !== before.size || fingerprint !== file.fingerprint)
      throw new Error("Note changed during indexing; run index again.");
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length));
  } finally {
    closeSync(handle);
  }
}
