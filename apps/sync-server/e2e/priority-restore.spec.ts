import { test, expect, type BrowserContext, type Page } from "@playwright/test";

// SHARED_APPS=reader SHARED_API_PORT=… SHARED_APP_PORT=… move the stack.
const api = `http://localhost:${process.env.SHARED_API_PORT ?? "8792"}`;
const app = `http://localhost:${process.env.SHARED_APP_PORT ?? "5175"}`;
const reader = `${api}/api/apps/reader`;
const HIGHLIGHTS = 600;
const BOOKS = ["Alder", "Birch", "Cedar"];

/**
 * A migrated account, straight to the server: highlights, then books, so a
 * plain restore commits the books last (pages of 500).
 */
async function seed(context: BrowserContext) {
  const signUp = await context.request.post(`${api}/api/auth/sign-up/email`, {
    headers: { Origin: app },
    data: {
      email: `${crypto.randomUUID()}@example.test`,
      password: "priority-restore-password",
      name: "Priority restore",
    },
  });
  expect(signUp.status()).toBe(200);
  const scope = JSON.stringify(
    await (
      await context.request.get(`${reader}/sync/v3/state`, {
        headers: { Origin: app },
      })
    ).json(),
  );
  let clock = Date.now() - 86_400_000;
  const record = (table: string, row: { id: string }, isDeleted = false) => ({
    key: JSON.stringify([table, row.id]),
    value: JSON.stringify({ ...row, isDeleted }),
    isDeleted,
    schemaVersion: 1,
    hlc: { wallTimeMs: (clock += 1_000), counter: 0 },
  });
  const book = (title: string, index: number) => ({
    id: `priority-book-${index}`,
    sourceFileId: `xxh64:${(0xb00c0000 + index).toString(16).padStart(16, "0")}`,
    title,
    author: "Priority Lab",
    fileSize: 400_000,
    dateAdded: clock,
    metadata: { language: "en" },
    manifest: [],
    spine: [],
    toc: [],
    cover: null,
  });
  const push = async (changes: object[]) => {
    const response = await context.request.post(`${reader}/sync/v3/push`, {
      headers: { Origin: app, "X-Sync-Scope": scope, "X-Device-ID": "phone" },
      data: { changes },
    });
    expect(response.status()).toBe(200);
  };
  const highlights = Array.from({ length: HIGHLIGHTS }, (_, index) =>
    record("highlights", {
      id: `priority-highlight-${index}`,
      bookId: "priority-book-0",
      spineItemId: "chapter-1",
      startOffset: index * 10,
      endOffset: index * 10 + 5,
      selectedText: "text",
      textBefore: "",
      textAfter: "",
      color: "yellow",
      createdAt: clock,
    } as { id: string }),
  );
  await push(highlights.slice(0, 500));
  await push(highlights.slice(500));
  await push(BOOKS.map((title, index) => record("books", book(title, index))));
  return {
    deleteBook: (index: number) =>
      push([record("books", book(BOOKS[index]!, index), true)]),
  };
}

const syncState = (page: Page) =>
  page.evaluate(() => {
    const key = Object.keys(localStorage).find((name) =>
      name.startsWith("epub-reader-sync-v2-state"),
    );
    return key ? JSON.parse(localStorage.getItem(key)!) : null;
  });
const bookLink = (page: Page, title: string) =>
  page.getByRole("link", { name: new RegExp(`^Open ${title}`) });

test("a new device shows the books from the priority pull, and a delete in the full pull wins", async ({
  browser,
}) => {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const account = await seed(context);
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  const pulls: string[] = [];
  await context.route(`${reader}/sync/v3/pull-stream?**`, async (route) => {
    const priority = route.request().url().includes("prefix=");
    pulls.push(priority ? "priority" : "full");
    if (!priority) await held;
    await route.continue();
  });

  const page = await context.newPage();
  await page.goto(app);
  for (const title of BOOKS) await expect(bookLink(page, title)).toBeVisible();
  // The books are on screen while the full pull has not started to commit.
  expect(await syncState(page)).toMatchObject({
    pullCursor: 0,
    bootstrapped: false,
  });

  // Another device deletes a book before the full pull reaches the server.
  await account.deleteBook(2);
  release();
  await expect
    .poll(async () => (await syncState(page))?.bootstrapped, { timeout: 30_000 })
    .toBe(true);
  await expect(bookLink(page, "Cedar")).toHaveCount(0);
  await expect(bookLink(page, "Alder")).toBeVisible();
  const counts = await page.evaluate(async () => {
    const path = "/src/lib/sync-v2/db.ts";
    const { syncV2SyncDb: db } = await import(path);
    return {
      highlights: await db.table("highlights").count(),
      liveBooks: (await db.table("books").toArray()).filter(
        (row: { isDeleted: boolean }) => !row.isDeleted,
      ).length,
    };
  });
  expect(counts).toEqual({ highlights: HIGHLIGHTS, liveBooks: 2 });
  // One priority pull, before any full pull (a later sync pulls only changes).
  expect(pulls[0]).toBe("priority");
  expect(pulls.filter((pull) => pull === "priority")).toHaveLength(1);
  await context.close();
});

test("a server without the prefix filter restores with a plain pull", async ({
  browser,
}) => {
  const context = await browser.newContext({ serviceWorkers: "block" });
  await seed(context);
  let refused = 0;
  // A server older than the filter refuses the unknown query parameter.
  await context.route(`${reader}/sync/v3/pull-stream?**`, async (route) => {
    if (!route.request().url().includes("prefix=")) return route.continue();
    refused += 1;
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": app, "Access-Control-Allow-Credentials": "true" },
      body: '{"success":false}',
    });
  });
  const page = await context.newPage();
  await page.goto(app);
  for (const title of BOOKS) await expect(bookLink(page, title)).toBeVisible();
  await expect
    .poll(async () => (await syncState(page))?.bootstrapped, { timeout: 30_000 })
    .toBe(true);
  expect(refused).toBe(1);
  await context.close();
});
