import { test, expect } from "@playwright/test";
import { importSampleBook } from "../../reader/test/e2e/helpers/fixtures";
const api = "http://localhost:8792";
test("Reader and Spaced share login and restore their own local data in a fresh browser", async ({
  browser,
  context,
  page,
}) => {
  const email = `${crypto.randomUUID()}@example.test`,
    password = "shared-local-password";
  for (const url of ["http://localhost:5175", "http://localhost:5180"]) {
    await expect
      .poll(async () => {
        try {
          return (await context.request.get(url)).status();
        } catch {
          return 0;
        }
      })
      .toBe(200);
  }
  // Local email registration is a fixture; app Google buttons bypass this page.
  await page.goto(`${api}/login?returnTo=http://localhost:5175`);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create local account" }).click();
  await expect(page).toHaveURL("http://localhost:5175/");
  await importSampleBook(page);
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const module = "/src/lib/db.ts";
        return (await import(module))
          .getAllBooks()
          .then((books: unknown[]) => books.length);
      }),
    )
    .toBe(1);
  const bookId = await page.evaluate(async () => {
    const module = "/src/lib/db.ts",
      syncModule = "/src/lib/sync-service.ts";
    const books = await (await import(module)).getAllBooks();
    await (await import(syncModule)).syncService.syncAll();
    return books[0].id;
  });
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const filesPath = "/src/lib/files/index.ts";
        return (await (await import(filesPath)).files.listRemote()).length;
      }),
    )
    .toBeGreaterThan(0);
  const spaced = await context.newPage();
  await spaced.goto("http://localhost:5180");
  const identity = await spaced.evaluate(
    async (api) =>
      (await fetch(`${api}/api/me`, { credentials: "include" })).json(),
    api,
  );
  expect(identity.user.email).toBe(email);
  // Persist through the app's actual local-write adapter; sync uses its production engine.
  const imageUrl = await spaced.evaluate(async () => {
    const persistence = "/src/lib/db/persistence.ts",
      engine = "/src/lib/sync/engine.ts",
      records = "/src/lib/sync/records.ts";
    const { db, persistenceReady } = await import(persistence);
    await persistenceReady;
    await db.operations.put(
      (await import(records)).toStoredOperation({
        type: "cardContent",
        payload: {
          cardId: "shared-card",
          front: "Shared backend?",
          back: "Separate app records.",
        },
        timestamp: 1000,
      }),
    );
    await (await import(engine)).default.syncToServer();
    const uploadPath = "/src/lib/files/upload.ts",
      apiPath = "/src/lib/api.ts";
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 2;
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((blob) => resolve(blob!), "image/png"),
    );
    const upload = await (
      await import(uploadPath)
    ).uploadImage(new File([blob], "fixture.png", { type: "image/png" }));
    if (!upload.success) throw new Error(upload.error);
    return `${(await import(apiPath)).API_BASE}/files/${upload.fileKey}`;
  });
  // Offline edits still commit locally; reconnect only drains the outbox.
  await context.setOffline(true);
  await spaced.evaluate(async () => {
    const persistence = "/src/lib/db/persistence.ts";
    const { db } = await import(persistence);
    const key = JSON.stringify(["cardContent", "shared-card"]);
    const row = await db.operations.get(key);
    await db.operations.put({
      ...row,
      timestamp: 2000,
      payload: { ...row.payload, front: "Edited offline" },
    });
    if ((await db._sync_outbox.count()) === 0)
      throw new Error("Offline edit was not queued");
  });
  await context.setOffline(false);
  await spaced.evaluate(async () => {
    const engine = "/src/lib/sync/engine.ts";
    await (await import(engine)).default.syncToServer();
  });
  const restored = await browser.newContext({ serviceWorkers: "block" });
  try {
    const login = await restored.request.post(`${api}/api/auth/sign-in/email`, {
      data: { email, password },
      headers: { Origin: "http://localhost:5180" },
    });
    expect(login.ok()).toBe(true);
    const reader = await restored.newPage();
    await reader.goto("http://localhost:5175");
    await expect
      .poll(() =>
        reader.evaluate(async () => {
          const module = "/src/lib/db.ts",
            syncModule = "/src/lib/sync-service.ts";
          await (await import(syncModule)).syncService.syncAll();
          return (await (await import(module)).getAllBooks()).map(
            (book: { id: string }) => book.id,
          );
        }),
      )
      .toEqual([bookId]);
    await expect(
      reader.getByRole("heading", { name: /Alice.*Wonderland/ }),
    ).toBeVisible();
    await reader.evaluate(async (id) => {
      const dataPath = "/src/lib/db.ts",
        filesPath = "/src/lib/files/index.ts";
      const book = await (await import(dataPath)).getBook(id);
      const blob = await (await import(filesPath)).files.get(book.sourceFileId);
      if (blob.size <= 0) throw new Error("Restored EPUB is empty");
    }, bookId);
    const cards = await restored.newPage();
    await cards.goto("http://localhost:5180");
    await expect
      .poll(() =>
        cards.evaluate(async () => {
          const engine = "/src/lib/sync/engine.ts",
            persistence = "/src/lib/db/persistence.ts";
          await (await import(engine)).default.syncFromServer();
          return (
            await (
              await import(persistence)
            ).db.operations.get(JSON.stringify(["cardContent", "shared-card"]))
          )?.payload.front;
        }),
      )
      .toBe("Edited offline");
    await cards.evaluate(async (url) => {
      const imagesPath = "/src/lib/images/db.ts";
      const images = await import(imagesPath);
      await images.downloadImageLocally(url, "Restored fixture");
      if ((await images.listUsableCachedImages()).length !== 1)
        throw new Error("Spaced image did not restore");
    }, imageUrl);
    await reader.evaluate(async (id) => {
      const dataPath = "/src/lib/db.ts",
        filesPath = "/src/lib/files/index.ts";
      const book = await (await import(dataPath)).getBook(id);
      const { files } = await import(filesPath);
      await files.deleteRemote(book.sourceFileId);
      await files.deleteRemote(book.sourceFileId); // A missing file is already deleted.
    }, bookId);
    await expect
      .poll(() =>
        reader.evaluate(async () => {
          const module = "/src/lib/db.ts";
          return (await import(module))
            .getAllBooks()
            .then((books: unknown[]) => books.length);
        }),
      )
      .toBe(1);
  } finally {
    await restored.close();
  }
});
