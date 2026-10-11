import { randomUUID } from "node:crypto";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PromptImage } from "../shared/agent-inbox";

/** Images that the user sent are kept this long, for an agent that reads them later. */
const KEEP_MS = 30 * 24 * 60 * 60 * 1000;
const EXTENSIONS: Record<PromptImage["mimeType"], string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

/**
 * Images for an agent that reads only text: Med saves them in its state
 * directory, and the message gives their paths. Claude Code opens an image
 * file with its Read tool; Codex with its view_image tool.
 */
export async function saveImages(directory: string, images: PromptImage[]) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  return Promise.all(
    images.map(async (image) => {
      const path = join(directory, `${randomUUID()}.${EXTENSIONS[image.mimeType]}`);
      await writeFile(path, Buffer.from(image.data, "base64"), { mode: 0o600 });
      return path;
    }),
  );
}

/** The part of a message that names saved images. */
export const imagesText = (paths: string[]) =>
  [
    "## Images",
    "",
    `The user attached ${paths.length === 1 ? "an image" : `${paths.length} images`}. Open ${paths.length === 1 ? "it" : "each file"} to see ${paths.length === 1 ? "it" : "them"}:`,
    "",
    ...paths.map((path) => `- ${path}`),
  ].join("\n");

/** Removes saved images older than Med keeps them. */
export async function pruneImages(directory: string, now = Date.now()) {
  const names = await readdir(directory).catch(() => []);
  await Promise.all(
    names.map(async (name) => {
      const path = join(directory, name);
      const info = await stat(path).catch(() => undefined);
      if (info?.isFile() && now - info.mtimeMs > KEEP_MS) await rm(path, { force: true });
    }),
  );
}
