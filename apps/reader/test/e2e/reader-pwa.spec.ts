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
