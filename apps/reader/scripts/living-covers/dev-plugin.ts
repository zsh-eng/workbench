import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

/**
 * Serves local cover scenes at `/__living-covers/`, from the dev server and
 * from `vite preview` (the phone preview).
 *
 * Scenes for the user's own books are drawn from copyrighted covers, so they
 * stay out of the repository: the folder is git-ignored and only these local
 * servers read it. A build never includes it. Each scene is a folder
 * with `scene.json`, its maps and, optionally, `cover.webp`.
 */
export const DEFAULT_LIVING_COVERS_DIR = fileURLToPath(
  new URL("../../living-covers.local", import.meta.url),
);

const TYPES: Record<string, string> = {
  ".json": "application/json",
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
};

export function livingCoversDev(): Plugin {
  return {
    name: "reader-living-covers",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__living-covers", serveScene);
    },
    configurePreviewServer(server) {
      server.middlewares.use("/__living-covers", serveScene);
    },
  };
}

function serveScene(req: IncomingMessage, res: ServerResponse) {
  const dir = process.env.READER_LIVING_COVERS_DIR ?? DEFAULT_LIVING_COVERS_DIR;
  const route = decodeURIComponent(
    new URL(req.url ?? "/", "http://localhost").pathname,
  );
  res.setHeader("Cache-Control", "no-cache");
  if (route === "/manifest.json") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ scenes: listScenes(dir) }));
    return;
  }
  const file = path.resolve(dir, `.${route}`);
  const type = TYPES[path.extname(file)];
  if (
    !file.startsWith(path.resolve(dir) + path.sep) ||
    !type ||
    !existsSync(file) ||
    !statSync(file).isFile()
  ) {
    res.statusCode = 404;
    res.end();
    return;
  }
  res.setHeader("Content-Type", type);
  createReadStream(file).pipe(res);
}

function listScenes(dir: string) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        existsSync(path.join(dir, entry.name, "scene.json")),
    )
    .map((entry) => {
      const cover = ["cover.webp", "cover.jpg", "cover.png"].find((name) =>
        existsSync(path.join(dir, entry.name, name)),
      );
      return {
        id: entry.name,
        url: `/__living-covers/${entry.name}/scene.json`,
        cover: cover ? `/__living-covers/${entry.name}/${cover}` : null,
      };
    });
}
