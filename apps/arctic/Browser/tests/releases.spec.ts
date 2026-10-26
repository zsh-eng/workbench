import { expect, test, type Page } from "@playwright/test";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";

// The production project: a copy of its build, served here, and released
// again and again under new file names, as each deploy does.
const port = Number(process.env.E2E_RELEASE_PORT ?? 5188);
const origin = `http://localhost:${port}`;
let root = "";
let server: Server | undefined;

const types: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
};

test.beforeAll(async () => {
  const dist = join(process.env.ARCTIC_E2E_STATE ?? "", "dist");
  root = mkdtempSync(join(tmpdir(), "arctic-releases-"));
  cpSync(dist, root, { recursive: true });
  // Cloudflare's static assets: a file, else the app for a page.
  server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", origin).pathname;
    let file = join(root, path);
    if (!existsSync(file) || !statSync(file).isFile()) {
      if (path.startsWith("/assets/")) {
        response.writeHead(404).end();
        return;
      }
      file = join(root, "index.html");
    }
    response.writeHead(200, {
      "Content-Type": types[extname(file)] ?? "application/octet-stream",
    });
    response.end(readFileSync(file));
  });
  await new Promise<void>((resolve) => server!.listen(port, resolve));
});

test.afterAll(() => {
  server?.close();
  if (root) rmSync(root, { recursive: true, force: true });
});

/** A new release: every hashed file gets a new name, and the old ones go. */
function release(version: number) {
  const assets = join(root, "assets");
  const names = new Map(
    readdirSync(assets).map((name) => [
      name,
      name.replace(/(?:-r\d+)?(\.\w+)$/, `-r${version}$1`),
    ]),
  );
  for (const [from, to] of names)
    renameSync(join(assets, from), join(assets, to));
  const texts = [
    join(root, "index.html"),
    ...[...names.values()]
      .filter((name) => /\.(js|css)$/.test(name))
      .map((name) => join(assets, name)),
  ];
  for (const file of texts) {
    let text = readFileSync(file, "utf8");
    for (const [from, to] of names) text = text.replaceAll(from, to);
    writeFileSync(file, text);
  }
}

/** What Cache Storage holds once this page's files are kept. */
async function cached(page: Page) {
  await page.waitForFunction(async () => {
    const named = [
      ...document.querySelectorAll<HTMLScriptElement | HTMLLinkElement>(
        'script[src^="/assets/"], link[href^="/assets/"]',
      ),
    ].map((node) => new URL("src" in node ? node.src : node.href).pathname);
    const keys = new Set<string>();
    for (const name of await caches.keys())
      for (const request of await (await caches.open(name)).keys())
        keys.add(new URL(request.url).pathname);
    return named.length > 0 && named.every((path) => keys.has(path));
  });
  // The older files leave after the new ones are in.
  const measure = () =>
    page.evaluate(async () => {
      let entries = 0;
      let bytes = 0;
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) {
          entries++;
          bytes += (await (await cache.match(request))!.blob()).size;
        }
      }
      return { entries, bytes };
    });
  let last = await measure();
  for (;;) {
    await page.waitForTimeout(300);
    const next = await measure();
    if (next.entries === last.entries && next.bytes === last.bytes) return next;
    last = next;
  }
}

test("the app's cache keeps two versions across releases", async ({ page }) => {
  await page.goto(origin);
  await page.evaluate(() => navigator.serviceWorker.ready);
  const first = await cached(page);
  const sizes = [first];
  for (let version = 2; version <= 6; version++) {
    release(version);
    await page.goto(origin);
    sizes.push(await cached(page));
  }
  console.log(
    sizes
      .map(
        ({ entries, bytes }, index) =>
          `release ${index + 1}: ${entries} entries, ${Math.round(bytes / 1024)} kB`,
      )
      .join("\n"),
  );
  // The second release adds a version; later ones replace the oldest.
  expect(sizes[1].bytes).toBeGreaterThan(first.bytes);
  for (const size of sizes.slice(2)) {
    expect(size.entries).toBe(sizes[1].entries);
    expect(Math.abs(size.bytes - sizes[1].bytes)).toBeLessThan(1024);
  }

  // Offline, the newest version opens from the cache.
  await page.context().setOffline(true);
  await page.reload();
  await expect(page.locator("#root")).not.toBeEmpty();
  const scripts = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLScriptElement>("script[src]")].map(
      (script) => script.src,
    ),
  );
  expect(scripts.some((src) => src.includes("-r6."))).toBe(true);
});
