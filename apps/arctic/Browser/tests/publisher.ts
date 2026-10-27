import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A publisher on this machine, for link previews: an article page with an
 * og:image, a description and an icon, and those images. The shared API
 * fetches it as it fetches a real site; local development previews only
 * `*.localhost` pages, which resolve to this machine, so its links are
 * `http://news.localhost:<port>/…`. `delayMs` holds the page back, as a slow
 * site does, so a test sees the link saved before its preview arrives.
 */
export async function publisher(options: { delayMs?: number } = {}) {
  const svg = (width: number, height: number, fill: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="${fill}"/><circle cx="${width * 0.7}" cy="${height * 0.45}" r="${height * 0.28}" fill="#f4f7fa" opacity="0.85"/></svg>`;
  const hits: string[] = [];
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    hits.push(path);
    if (path === "/cover.svg") {
      // ?tone=1–4 gives other links their own picture.
      const tone = new URL(request.url ?? "/", "http://localhost").searchParams.get("tone");
      response.writeHead(200, { "Content-Type": "image/svg+xml" });
      response.end(
        svg(1200, 630, ["#5d7f99", "#8a9a6b", "#a5786a", "#6f6a94", "#7c8c94"][Number(tone) || 0]!),
      );
      return;
    }
    if (path === "/icon.svg") {
      response.writeHead(200, { "Content-Type": "image/svg+xml" });
      response.end(svg(64, 64, "#1f3b52"));
      return;
    }
    if (path === "/stories/how-sea-ice-keeps-time") {
      setTimeout(() => {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(`<!doctype html><html><head>
          <title>The quiet clock of sea ice | Polar Desk</title>
          <meta property="og:title" content="The quiet clock of sea ice">
          <meta property="og:description" content="Each winter&rsquo;s ice keeps a record of the season that made it.">
          <meta property="og:image" content="/cover.svg">
          <link rel="icon" href="/icon.svg">
        </head><body><article><p>Sea ice.</p></article></body></html>`);
      }, options.delayMs ?? 0);
      return;
    }
    if (path === "/stories/only-an-icon") {
      // A site whose og:image is its icon: too small for a cover.
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(`<!doctype html><html><head>
        <meta property="og:title" content="Only an icon">
        <meta property="og:description" content="This page shares its icon.">
        <meta property="og:image" content="/icon.svg">
      </head><body></body></html>`);
      return;
    }
    response.writeHead(404, { "Content-Type": "text/html" });
    response.end("<title>Not found</title>");
  });
  // Both IPv4 and IPv6: news.localhost resolves to ::1 and 127.0.0.1.
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  const origin = `http://news.localhost:${port}`;
  return {
    origin,
    /** The article, with a slug that gives the address's own title first. */
    story: `${origin}/stories/how-sea-ice-keeps-time`,
    hits,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
