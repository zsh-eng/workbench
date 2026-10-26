import { expect, test, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Run after bun run build, with playwright.pwa.config.ts. The test serves a
// copy of dist/client on its own port and publishes new versions into it, so
// the service worker finds a real update.
const port = Number(process.env.E2E_PORT ?? 5195) + 1;
const origin = `http://127.0.0.1:${port}`;
let root = "";
let server: ChildProcess | null = null;
let version = 1;

/** A new version: index.html changes, so its precache revision does too. */
function publishVersion(): string {
  version += 1;
  const label = `version ${version}`;
  const indexPath = path.join(root, "index.html");
  const before = readFileSync(indexPath, "utf8");
  const oldRevision = createHash("md5").update(before).digest("hex");
  const after = before.replace("</body>", `<!-- ${label} --></body>`);
  const newRevision = createHash("md5").update(after).digest("hex");
  writeFileSync(indexPath, after);
  for (const file of ["sw.js", "sw-precache.json"]) {
    const target = path.join(root, file);
    const text = readFileSync(target, "utf8");
    expect(text).toContain(oldRevision);
    writeFileSync(target, text.replaceAll(oldRevision, newRevision));
  }
  return label;
}

async function waitForServer() {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      if ((await fetch(origin)).ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`No server on ${origin}`);
}

test.describe.configure({ mode: "serial" });
test.use({ baseURL: origin });

test.beforeAll(async () => {
  root = mkdtempSync(path.join(tmpdir(), "reader-pwa-update-"));
  cpSync(path.resolve("dist/client"), root, { recursive: true });
  server = spawn(
    "python3",
    [
      "-c",
      `import functools, http.server as h; h.ThreadingHTTPServer.request_queue_size = 256; h.test(HandlerClass=functools.partial(h.SimpleHTTPRequestHandler, directory=${JSON.stringify(root)}), ServerClass=h.ThreadingHTTPServer, port=${port}, bind='127.0.0.1')`,
    ],
    { stdio: "ignore" },
  );
  await waitForServer();
});

test.afterAll(() => {
  server?.kill();
  if (root) rmSync(root, { recursive: true, force: true });
});

async function openControlled(page: Page) {
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 503, body: "" }),
  );
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
}

async function checkForUpdate(page: Page) {
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await registration?.update();
  });
}

const pageHas = (page: Page, label: string) =>
  page.evaluate(
    (text) => document.documentElement.outerHTML.includes(text),
    label,
  );

test("an update waits for Restart and then says Updated", async ({ page }) => {
  await openControlled(page);
  // A page that has just started switches at once; this one is in use.
  await page.waitForTimeout(5_500);
  await page.evaluate(() => {
    (window as unknown as { __before: boolean }).__before = true;
  });
  const label = publishVersion();
  await checkForUpdate(page);
  const restart = page.getByRole("button", { name: "Restart to update" });
  await expect(restart).toBeVisible({ timeout: 20_000 });
  // It waited: the same page, on the old version.
  expect(
    await page.evaluate(
      () => (window as unknown as { __before?: boolean }).__before,
    ),
  ).toBe(true);
  expect(await pageHas(page, label)).toBe(false);
  // The progress counts sw-precache.json, so each of its files is now in the
  // precache and the count reaches its total.
  expect(
    await page.evaluate(async () => {
      const scope = (await navigator.serviceWorker.getRegistration())!.scope;
      const entries = (await (
        await fetch("/sw-precache.json", { cache: "no-store" })
      ).json()) as { url: string; revision: string | null }[];
      const cache = await caches.open(`workbox-precache-v2-${scope}`);
      const stored = new Set((await cache.keys()).map((key) => key.url));
      return entries
        .filter((entry) => {
          const url = new URL(entry.url, scope);
          if (entry.revision)
            url.searchParams.set("__WB_REVISION__", entry.revision);
          return !stored.has(url.href);
        })
        .map((entry) => entry.url);
    }),
  ).toEqual([]);

  const reloaded = page.waitForEvent("load");
  await restart.click();
  await reloaded;
  await expect.poll(() => pageHas(page, label)).toBe(true);
  await expect(page.getByRole("button", { name: "Updated" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Updated" })).toBeHidden({
    timeout: 5_000,
  });
});
