// Local preview. `bun run dev` renders src/ on each request; reload the page
// after an edit. `bun run preview` serves the built dist/ instead.
import { existsSync, statSync } from "node:fs";
import { join, normalize } from "node:path";
import { parseArgs } from "node:util";
import { publicDir, render } from "./render.ts";

const { values } = parseArgs({
  options: { dist: { type: "boolean" }, port: { type: "string" } },
});
const root = values.dist ? join(import.meta.dir, "../dist") : publicDir;
const port = Number(values.port ?? 4320);

function file(pathname: string): Response {
  const path = join(root, normalize(decodeURIComponent(pathname)));
  if (
    !path.startsWith(root) ||
    !existsSync(path) ||
    statSync(path).isDirectory()
  ) {
    return new Response("Not found", { status: 404 });
  }
  return new Response(Bun.file(path));
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname !== "/") return file(pathname);
    if (values.dist) return file("/index.html");
    return new Response(render({ hash: false }).html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  },
});

console.log(`Med site: ${server.url}`);
