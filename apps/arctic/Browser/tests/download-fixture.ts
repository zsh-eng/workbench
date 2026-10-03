// A publisher and the real Bun download endpoint, isolated from the user's cache.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DownloadService, createHandler } from "../server/service";
const directory = await mkdtemp(join(tmpdir(), "arctic-browser-e2e-"));
const prose =
  "A downloaded article remains available after the publisher goes away. The reading library keeps the full text locally and leaves the original URL intact. A quiet tool makes room for reading, thinking, and returning to an idea.";
const publisher = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: () =>
    new Response(
      `<!doctype html><html><head><title>Reading without a connection</title><meta name="author" content="Ada Reader"></head><body><article><h1>Reading without a connection</h1><p>${prose}</p><p>${prose}</p><p>${prose}</p></article></body></html>`,
      { headers: { "content-type": "text/html" } },
    ),
});
const service = new DownloadService(directory, publisher.url.origin);
let handler: (request: Request) => Promise<Response>;
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: (request) => handler(request),
});
handler = createHandler(service, [server.url.origin, "http://127.0.0.1:5186"]);
console.log(
  JSON.stringify({
    publisher: publisher.url.origin,
    service: server.url.origin,
  }),
);
process.on("SIGTERM", async () => {
  server.stop(true);
  publisher.stop(true);
  await service.close();
  await rm(directory, { recursive: true, force: true });
  process.exit(0);
});
