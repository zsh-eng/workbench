import { test, expect, type APIRequestContext } from "@playwright/test";
import {
  importSampleBook,
  SAMPLE_BOOK_TITLE,
  waitForReaderReady,
} from "./helpers/fixtures";

// The lab's control is beside it (scripts/network-lab.ts).
const control = `http://127.0.0.1:${Number(process.env.E2E_PORT ?? 5196) + 1}`;
async function setFault(
  request: APIRequestContext,
  target: string,
  mode = "hold",
) {
  const response = await request.post(control, { data: { target, mode } });
  expect(response.ok()).toBe(true);
}

test.afterEach(async ({ request }, info) => {
  const state = await (await request.get(control)).json();
  await info.attach("network-requests", {
    body: JSON.stringify(state, null, 2),
    contentType: "application/json",
  });
  await setFault(request, "all", "pass");
});

for (const target of ["auth", "fonts", "files", "all", "offline"]) {
  test(`warm PWA opens Library and Reader with ${target} unavailable`, async ({
    page,
    context,
    request,
  }, info) => {
    await setFault(request, "all", "pass");
    await page.goto("/");
    await importSampleBook(page);
    await page.evaluate(() =>
      navigator.serviceWorker.ready.then(() => undefined),
    );
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await page.getByRole("heading", { name: SAMPLE_BOOK_TITLE }).click();
    await waitForReaderReady(page);

    if (target === "files") {
      // A synced book can have local EPUB bytes but no downloaded cover yet.
      await page.evaluate(async () => {
        // Production names the database after its shared sync service.
        const name = (await indexedDB.databases())
          .map((database) => database.name)
          .find((name) => name?.startsWith("epub-reader-db-v2"));
        if (!name) throw new Error("No Reader database");
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const open = indexedDB.open(name);
          open.onsuccess = () => resolve(open.result);
          open.onerror = () => reject(open.error);
        });
        try {
          await new Promise<void>((resolve, reject) => {
            const tx = db.transaction("books", "readwrite");
            const store = tx.objectStore("books");
            const rows = store.getAll();
            rows.onsuccess = () => {
              const book = rows.result[0];
              book.cover = { fileId: "xxh64:0000000000000000", blurHash: null };
              store.put(book);
            };
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
          });
        } finally {
          db.close();
        }
      });
    }
    await page.close();
    if (target === "offline") await context.setOffline(true);
    else await setFault(request, target);
    const fresh = await context.newPage();
    const started = Date.now();
    await fresh.goto("/", { waitUntil: "domcontentloaded" });
    expect(await fresh.evaluate(() => navigator.onLine)).toBe(
      target !== "offline",
    );
    expect(
      await fresh.evaluate(() => !!navigator.serviceWorker.controller),
    ).toBe(true);
    await expect(
      fresh.getByRole("heading", { name: SAMPLE_BOOK_TITLE }),
    ).toBeVisible({ timeout: 3000 });
    const libraryMs = Date.now() - started;
    // A signed-out device asks only for its session; it fetches no files, so
    // the files case checks only that a missing cover doesn't block opening.
    if (target === "auth" || target === "all") {
      await expect
        .poll(async () => (await (await request.get(control)).json()).held)
        .toBeGreaterThan(0);
    }
    const readerStarted = Date.now();
    await fresh.getByRole("heading", { name: SAMPLE_BOOK_TITLE }).click();
    await waitForReaderReady(fresh);
    const readerMs = Date.now() - readerStarted;
    if (target === "fonts" || target === "all") {
      const state = await (await request.get(control)).json();
      expect(
        state.requests.filter((entry: { path: string }) =>
          /\.woff2?$/.test(entry.path),
        ),
      ).toEqual([]);
    }
    await info.attach("startup-times", {
      body: JSON.stringify({ target, libraryMs, readerMs }),
      contentType: "application/json",
    });
    console.log(JSON.stringify({ target, libraryMs, readerMs }));
    await fresh.screenshot({ path: info.outputPath("reader-ready.png") });
  });
}
