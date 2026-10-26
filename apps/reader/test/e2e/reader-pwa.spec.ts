import { test, expect } from "@playwright/test";
import {
  importSampleBook,
  openAccountMenu,
  SAMPLE_BOOK_TITLE,
  waitForReaderReady,
  nextSpread,
} from "./helpers/fixtures";

test("cached production PWA opens in a fresh page offline and reconnects", async ({
  page,
  context,
}) => {
  await context.addInitScript(() => {
    localStorage.setItem("reader-debug-enabled-v1", "true");
    localStorage.setItem("reader-performance-tracing-enabled-v1", "true");
  });
  await page.goto("/");
  await importSampleBook(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.getByRole("heading", { name: SAMPLE_BOOK_TITLE }).click();
  await waitForReaderReady(page);
  await page.locator('[data-reader-chrome-rail="bottom"]').hover();
  await expect(page.locator("canvas.cursor-ew-resize")).toBeAttached();
  await nextSpread(page);
  const url = page.url();
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await expect
    .poll(() =>
      page.evaluate(async () => {
        // Production names the database after its shared sync service.
        const name = (await indexedDB.databases())
          .map((database) => database.name)
          .find((name) => name?.startsWith("epub-reader-db-v2"));
        if (!name) return false;
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open(name);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        try {
          return await new Promise<boolean>((resolve, reject) => {
            const request = db
              .transaction("readingCheckpoints")
              .objectStore("readingCheckpoints")
              .getAll();
            request.onsuccess = () =>
              resolve(
                request.result.some(
                  (row) => row.currentSpineIndex > 0 || row.scrollProgress > 0,
                ),
              );
            request.onerror = () => reject(request.error);
          });
        } finally {
          db.close();
        }
      }),
    )
    .toBe(true);
  await page.close();
  await context.setOffline(true);
  const fresh = await context.newPage();
  await fresh.goto(url);
  await waitForReaderReady(fresh);
  expect(await fresh.evaluate(() => navigator.onLine)).toBe(false);
  expect(await fresh.evaluate(() => !!navigator.serviceWorker.controller)).toBe(
    true,
  );
  await fresh.locator('[data-reader-chrome-rail="bottom"]').hover();
  await expect(fresh.locator("canvas.cursor-ew-resize")).toBeVisible();
  await nextSpread(fresh);
  await context.setOffline(false);
  await nextSpread(fresh);
});

test("production debug mode defaults off and keeps an explicit override", async ({
  page,
}) => {
  await page.route("**/api/auth/get-session", (route) =>
    route.fulfill({ json: null }),
  );
  await page.goto("/");
  let menu = await openAccountMenu(page);
  await expect(
    menu.getByRole("menuitem", { name: "Debug tools", exact: true }),
  ).toHaveCount(0);
  await menu.getByRole("menuitem", { name: "Settings", exact: true }).click();
  const toggle = page.getByRole("switch", { name: "Debug mode" });
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  // The static PWA test server serves the root document; enter Settings through navigation.
  await page.goto("/");
  menu = await openAccountMenu(page);
  await expect(
    menu.getByRole("menuitem", { name: "Debug tools", exact: true }),
  ).toBeVisible();
  await menu.getByRole("menuitem", { name: "Settings", exact: true }).click();
  await expect(toggle).toBeChecked();
});

test("a fresh install opens the Library and a book offline, and keeps Debug pages after their first visit", async ({
  page,
  context,
}) => {
  await context.addInitScript(() => {
    localStorage.setItem("reader-debug-enabled-v1", "true");
  });
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await importSampleBook(page);
  // A Debug page downloads on its first visit, online.
  await page.goto("/debug/sheet-lab");
  await expect(page.getByRole("heading", { name: "Sheet Lab" })).toBeVisible();
  await page.close();

  // The book was never opened online: the precache alone opens it.
  // setOffline does not reach the service worker's own requests, so the
  // network fails them too.
  await context.setOffline(true);
  await context.route("**/*", (route) => route.abort("internetdisconnected"));
  const fresh = await context.newPage();
  await fresh.goto("/");
  await fresh.getByRole("heading", { name: SAMPLE_BOOK_TITLE }).click();
  await waitForReaderReady(fresh);
  await nextSpread(fresh);
  // The default reading font, Lora, comes from the precache too.
  expect(
    await fresh.evaluate(() =>
      [...document.fonts].some(
        (face) =>
          face.family.replaceAll('"', "") === "Lora" &&
          face.status === "loaded",
      ),
    ),
  ).toBe(true);

  await fresh.goto("/debug/sheet-lab");
  await expect(fresh.getByRole("heading", { name: "Sheet Lab" })).toBeVisible();
  // A Debug page never visited cannot download offline, and says so.
  await fresh.goto("/debug/notes-lab");
  await expect(
    fresh.getByRole("heading", { name: "This page couldn’t open" }),
  ).toBeVisible();
  await context.unroute("**/*");
  await context.setOffline(false);
  await fresh.getByRole("button", { name: "Reload" }).click();
  await expect(fresh.getByRole("heading", { name: "Notes Lab" })).toBeVisible();
});

test("an install keeps its web manifest and icons offline, and lists them for the update progress", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  // The update progress counts sw-precache.json, so it lists every file the
  // worker precaches.
  expect(
    await page.evaluate(async () => {
      const scope = (await navigator.serviceWorker.getRegistration())!.scope;
      const entries = (await (
        await fetch("/sw-precache.json", { cache: "no-store" })
      ).json()) as { url: string }[];
      const listed = new Set(
        entries.map(({ url }) => new URL(url, scope).href),
      );
      const cache = await caches.open(`workbox-precache-v2-${scope}`);
      return (await cache.keys())
        .map((request) => {
          const url = new URL(request.url);
          url.searchParams.delete("__WB_REVISION__");
          return url.href;
        })
        .filter((url) => !listed.has(url));
    }),
  ).toEqual([]);

  // setOffline does not reach the service worker's own requests, so the
  // network fails them too.
  await context.setOffline(true);
  await context.route("**/*", (route) => route.abort("internetdisconnected"));
  expect(
    await page.evaluate(async () => {
      const link = (rel: string) =>
        document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`)!.href;
      const manifestUrl = link("manifest");
      const manifest = (await (await fetch(manifestUrl)).json()) as {
        icons: { src: string }[];
      };
      const urls = [
        ...manifest.icons.map((icon) => new URL(icon.src, manifestUrl).href),
        link("apple-touch-icon"),
        link("icon"),
      ];
      const missing: string[] = [];
      for (const url of urls) {
        const response = await fetch(url).catch(() => null);
        if (!response?.ok) missing.push(url);
      }
      return missing;
    }),
  ).toEqual([]);
  await context.unroute("**/*");
  await context.setOffline(false);
});
