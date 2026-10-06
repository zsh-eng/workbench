import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { codePath } from "../service/self";

const HASH_LIMIT = 8 * 1024 * 1024;

async function fingerprint(path: string) {
  const info = await stat(path);
  // A compiled executable is large; installs replace it, which changes its identity.
  if (info.size > HASH_LIMIT) return `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}`;
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

/** Reports whether the code on disk differs from the code this process started
 * with. A rebuild replaces the CLI entry, whose imports name the new chunks. */
export function createCodeCheck(path = codePath()) {
  const initial = fingerprint(path).catch(() => null);
  return async () => {
    const start = await initial;
    if (!start) return false;
    try {
      return (await fingerprint(path)) !== start;
    } catch {
      // A rebuild can remove the file briefly; report a change only once it exists.
      return false;
    }
  };
}

/** The entry script that an index.html loads, such as /assets/index-abc.js. */
export function webEntry(html: string) {
  return /<script\b[^>]*\bsrc="(\/assets\/[^"]+\.js)"/.exec(html)?.[1] ?? null;
}
