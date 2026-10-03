import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
const fixtureFile = process.env.SHARED_REHEARSAL_FIXTURE;
test.skip(
  !fixtureFile,
  "Requires a private, verified local production-data import",
);
test.use({ trace: "off", screenshot: "off", video: "off" });
test("restores the production snapshot through both real web apps", async ({
  context,
  page,
}) => {
  test.setTimeout(240_000);
  const fixture = JSON.parse(readFileSync(fixtureFile!, "utf8"));
  const api = "http://localhost:8792";
  // The snapshot keeps its final production image URLs; alias only that host to the local target.
  await context.route("https://api.zsheng.app/**", async (route) => {
    const url = new URL(route.request().url());
    const response = await context.request.get(api + url.pathname, {
      headers: { Origin: "http://localhost:5180" },
    });
    await route.fulfill({ response });
  });
  const login = await context.request.post(`${api}/api/auth/sign-in/email`, {
    data: { email: fixture.email, password: fixture.password },
    headers: { Origin: "http://localhost:5175" },
  });
  expect(login.status()).toBe(200);
  for (const url of ["http://localhost:5175", "http://localhost:5180"])
    await expect
      .poll(
        async () => {
          try {
            return (await context.request.get(url)).status();
          } catch {
            return 0;
          }
        },
        { timeout: 60_000 },
      )
      .toBe(200);
  await page.goto("http://localhost:5175");
  const readerCounts = await page.evaluate(async () => {
    const syncPath = "/src/lib/sync-service.ts",
      dbPath = "/src/lib/sync-v2/db.ts";
    await (await import(syncPath)).syncService.syncAll();
    const { syncV2SyncDb: db } = await import(dbPath);
    const result: Record<string, number> = {};
    for (const table of [
      "books",
      "highlights",
      "notes",
      "readingCheckpoints",
      "readingSessions",
      "readingState",
    ])
      result[table] = await db.table(table).count();
    return result;
  });
  expect(readerCounts).toEqual(fixture.counts.reader);
  await page.evaluate(async (bookId) => {
    const dbPath = "/src/lib/db.ts",
      filesPath = "/src/lib/files/index.ts";
    const book = await (await import(dbPath)).getBook(bookId);
    const file = await (await import(filesPath)).files.get(book.sourceFileId);
    if (file.size <= 0) throw new Error("Restored EPUB is empty");
  }, fixture.bookId);
  const cards = await context.newPage();
  await cards.goto("http://localhost:5180");
  const spacedCounts = await cards.evaluate(async () => {
    const syncPath = "/src/lib/sync/engine.ts",
      dbPath = "/src/lib/db/persistence.ts";
    await (await import(syncPath)).default.syncFromServer();
    const { db } = await import(dbPath);
    return {
      operations: await db.operations.count(),
      reviewLogOperations: await db.reviewLogOperations.count(),
    };
  });
  expect(spacedCounts).toEqual(fixture.counts.spaced);
  await cards.evaluate(async (image) => {
    const imagesPath = "/src/lib/images/db.ts";
    await (
      await import(imagesPath)
    ).downloadImageLocally(
      `https://api.zsheng.app/api/apps/spaced/files/${image.fileId}`,
      "Local restore verification",
    );
  }, fixture.image);
  await context.setOffline(true);
  const pending = await cards.evaluate(async () => {
    const dbPath = "/src/lib/db/persistence.ts",
      recordsPath = "/src/lib/sync/records.ts";
    const { db } = await import(dbPath);
    await db.operations.put(
      (await import(recordsPath)).toStoredOperation({
        type: "cardContent",
        payload: {
          cardId: "local-restore-fixture",
          front: "Offline fixture",
          back: "Local only",
        },
        timestamp: Date.now(),
      }),
    );
    return db._sync_outbox.count();
  });
  expect(pending).toBeGreaterThan(0);
  await context.setOffline(false);
  await cards.evaluate(async () => {
    const path = "/src/lib/sync/engine.ts";
    await (await import(path)).default.syncToServer();
  });
  expect(
    await cards.evaluate(async () => {
      const path = "/src/lib/db/persistence.ts";
      return (await import(path)).db._sync_outbox.count();
    }),
  ).toBe(0);
});
