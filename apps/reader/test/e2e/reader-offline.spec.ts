import {
  test,
  expect,
  SAMPLE_BOOK_TITLE,
  waitForReaderReady,
  nextSpread,
} from "./helpers/fixtures";

// The dev harness has no service worker. Serve dev assets explicitly while
// browser connectivity is offline; production cache coverage lives separately.
test.beforeEach(async ({ context }) => {
  await context.route(
    (url) => !url.pathname.startsWith("/api/"),
    async (route) => {
      await route.fulfill({ response: await route.fetch() });
    },
  );
});

test.afterEach(async ({ page }, info) => {
  const trace = await page.evaluate(async () => {
    const path = "/src/lib/reader-performance-trace.ts";
    return (await import(path)).getReaderTraceSnapshot();
  });
  await info.attach("reader-phases", {
    body: JSON.stringify(trace, null, 2),
    contentType: "application/json",
  });
});

for (const materialized of [true, false]) {
  test(`opens downloaded book offline (materialized: ${materialized}) and reconnects`, async ({
    page,
    context,
    localBook,
  }) => {
    await page.evaluate(async () => {
      const path = "/src/lib/reader-performance-trace.ts";
      (await import(path)).setReaderTraceRecordingEnabled(true);
    });
    if (!materialized) {
      await page.evaluate(async () => {
        const path = "/src/lib/sync-v2/db.ts";
        const { syncV2Db: db } = await import(path);
        await db.bookMaterializations.clear();
        await db.bookFiles.clear();
      });
    }
    void localBook;
    await context.setOffline(true);
    await page.getByRole("heading", { name: SAMPLE_BOOK_TITLE }).click();
    await waitForReaderReady(page);
    await nextSpread(page);
    await context.setOffline(false);
    await nextSpread(page);
    expect(
      await page.locator("[data-reader-page-content]").count(),
    ).toBeGreaterThan(0);
  });
}

test("missing bytes shows a recoverable state and downloads after reconnect", async ({
  page,
  context,
  localBook,
}) => {
  const bytes = await page.evaluate(async () => {
    const modulePath = "/src/lib/sync-v2/db.ts";
    const { syncV2Db: db } = await import(modulePath);
    const source = (await db.files.toArray()).find(
      (file: { mediaType: string }) =>
        file.mediaType === "application/epub+zip",
    );
    const bytes = Array.from(new Uint8Array(await source.blob.arrayBuffer()));
    await db.bookMaterializations.clear();
    await db.bookFiles.clear();
    await db.files.clear();
    return bytes;
  });
  let downloads = 0;
  await context.route("**/api/files/**", async (route) => {
    downloads++;
    await route.fulfill({
      body: Buffer.from(bytes),
      contentType: "application/epub+zip",
    });
  });
  await context.setOffline(true);
  await page.getByRole("heading", { name: SAMPLE_BOOK_TITLE }).click();
  await expect(page.getByText("Book file unavailable")).toBeVisible();
  expect(downloads).toBe(0);
  await context.setOffline(false);
  await waitForReaderReady(page);
  await nextSpread(page);
  expect(downloads).toBe(1);
  expect(
    await page.evaluate(async (id) => {
      const modulePath = "/src/lib/sync-v2/db.ts";
      const { syncV2Db: db } = await import(modulePath);
      return !!(await db.bookMaterializations.get(id));
    }, localBook.id),
  ).toBe(true);
});

test("loads stored reading history offline with the default query policy", async ({
  page,
  context,
  localBook,
}) => {
  await page.evaluate(async (bookId) => {
    const path = "/src/data/reading-sessions.ts";
    const { createCurrentDeviceReadingSession } = await import(path);
    const now = Date.now();
    await createCurrentDeviceReadingSession({
      id: "offline-history",
      bookId,
      readerInstanceId: "offline-history-reader",
      startedAt: now - 600_000,
      endedAt: now,
      lastActiveAt: now,
      activeMs: 600_000,
      startSpineIndex: 0,
      startScrollProgress: 0,
      endSpineIndex: 1,
      endScrollProgress: 0,
    });
  }, localBook.id);
  await context.setOffline(true);
  await page.getByRole("link", { name: "Sessions", exact: true }).click();
  await expect(page).toHaveURL(/\/reading-sessions$/);
  await expect(
    page.getByRole("link", { name: /Alice.*Wonderland 10 min Lewis Carroll/i }),
  ).toBeVisible();
});
