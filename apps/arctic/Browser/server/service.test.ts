import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DownloadService, createHandler } from "./service";
const prose =
  "A well designed reading tool leaves enough space for ideas. Readers can keep the useful parts of an article and return to them later. This fixture has real paragraphs so the production extractor can find the main text without any mocked extraction results.";
const markup = `<article><h1>A quiet reading tool</h1><p>${prose}</p><p>${prose}</p><p>${prose}</p></article>`;
let hits = 0;
let images = 0;
let deniedHits = 0;
let directory: string;
let service: DownloadService;
let host: ReturnType<typeof Bun.serve>;
let publisher: ReturnType<typeof Bun.serve>;
let internal: ReturnType<typeof Bun.serve>;
const extract = (url: string, origin?: string) =>
  fetch(new URL("/api/extract", host.url), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-arctic-request": "1",
      ...(origin ? { origin } : {}),
    },
    body: JSON.stringify({ url }),
  });
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "arctic-download-test-"));
  internal = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      deniedHits++;
      return new Response("private");
    },
  });
  publisher = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === "/private") return Response.redirect(internal.url, 302);
      if (path === "/image") {
        images++;
        return new Response("image");
      }
      if (path === "/app.js")
        return new Response(
          `setTimeout(()=>{document.getElementById('app').innerHTML=${JSON.stringify(markup)};},150);fetch(${JSON.stringify(internal.url.href)}).catch(()=>{});`,
          { headers: { "content-type": "application/javascript" } },
        );
      if (path === "/dynamic")
        return new Response(
          '<!doctype html><html><head><title>A quiet reading tool</title></head><body><main id="app">Loading</main><img src="/image"><script src="/app.js"></script></body></html>',
          { headers: { "content-type": "text/html" } },
        );
      hits++;
      return new Response(
        `<!doctype html><html><head><title>A quiet reading tool</title><meta name="author" content="Ada Reader"></head><body>${markup}</body></html>`,
        { headers: { "content-type": "text/html" } },
      );
    },
  });
  service = new DownloadService(directory, publisher.url.origin);
  let handler: (request: Request) => Promise<Response>;
  host = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) => handler(request),
  });
  handler = createHandler(service, [host.url.origin]);
});
afterAll(async () => {
  host.stop(true);
  publisher.stop(true);
  internal.stop(true);
  await service.close();
  await rm(directory, { recursive: true, force: true });
});
test("HTTP extraction shares concurrent work and reuses the disk cache", async () => {
  const url = new URL("/static", publisher.url).href;
  const responses = await Promise.all([extract(url), extract(url)]);
  const [first, second] = await Promise.all(
    responses.map((response) => response.json()),
  );
  expect(first.method).toBe("http");
  expect(first.html).toContain(prose);
  expect(first.author).toBe("Ada Reader");
  expect(second.html).toBe(first.html);
  expect(hits).toBe(1);
  const reopened = new DownloadService(directory, publisher.url.origin);
  try {
    const cached = await reopened.download(url);
    expect(cached.cacheHit).toBe(true);
    expect(hits).toBe(1);
  } finally {
    await reopened.close();
  }
});
test("headless fallback extracts script-rendered content without images or private-network requests", async () => {
  const response = await extract(new URL("/dynamic", publisher.url).href);
  const result = await response.json();
  expect(response.status).toBe(200);
  expect(result.method).toBe("browser");
  expect(result.html).toContain(prose);
  expect(images).toBe(0);
  expect(deniedHits).toBe(0);
}, 25000);
test("local endpoint rejects foreign origins, private destinations and private redirects", async () => {
  expect(
    (
      await extract(
        new URL("/static", publisher.url).href,
        "https://unrelated.example",
      )
    ).status,
  ).toBe(403);
  expect((await extract(internal.url.href)).status).toBe(400);
  expect((await extract(new URL("/private", publisher.url).href)).status).toBe(
    400,
  );
  expect(deniedHits).toBe(0);
  expect(
    (
      await fetch(new URL("/api/extract", host.url), {
        method: "POST",
        body: "{}",
      })
    ).status,
  ).toBe(400);
});
