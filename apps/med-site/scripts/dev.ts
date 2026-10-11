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
// Med's live demo, from `bun run demo`.
const demo = join(import.meta.dir, "../.demo");
const port = Number(values.port ?? 4320);

// Like Cloudflare, /demo/demo also finds demo/demo.html.
function find(pathname: string, base: string): string | undefined {
  const path = join(base, normalize(decodeURIComponent(pathname)));
  if (!path.startsWith(base)) return undefined;
  return [path, `${path}.html`].find(
    (candidate) => existsSync(candidate) && !statSync(candidate).isDirectory(),
  );
}

function file(pathname: string, base = root): Response {
  const path = find(pathname, base);
  if (!path) return new Response("Not found", { status: 404 });
  return new Response(Bun.file(path));
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  fetch(request) {
    const { pathname } = new URL(request.url);
    if (
      !values.dist &&
      pathname.startsWith("/demo/") &&
      find(pathname, demo)
    )
      return file(pathname, demo);
    if (pathname !== "/") return file(pathname);
    if (values.dist) return file("/index.html");
    return new Response(render({ hash: false }).html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  },
});

console.log(`Med site: ${server.url}`);
