import {
  currentPages,
  expect,
  nextSpread,
  openAccountMenu,
  openLocalBook,
  test,
} from "./helpers/fixtures";

// Seeded books already have local bytes; these checks only exercise record sync.
test.use({ signedIn: true });

test("should display committed remote book changes", async ({
  page,
  localBook,
  remote,
}) => {
  const book = await page.evaluate(async (id) => {
    const modulePath = "/src/lib/sync-v2/db.ts";
    return (await import(modulePath)).syncV2Db.books.get(id);
  }, localBook.id);
  remote.enqueue({
    key: JSON.stringify(["books", localBook.id]),
    value: JSON.stringify({ ...book, title: "Updated on another device" }),
    isDeleted: false,
    schemaVersion: 1,
    hlc: { wallTimeMs: Date.now() + 1000, counter: 0 },
  });
  const menu = await openAccountMenu(page);
  await menu.getByRole("menuitem", { name: /^Sync now:/ }).click();
  await expect(
    page.getByRole("heading", {
      name: "Updated on another device",
      exact: true,
    }),
  ).toBeVisible();
  const title = await page.evaluate(async (id) => {
    const modulePath = "/src/lib/sync-v2/db.ts";
    return (await (await import(modulePath)).syncV2Db.books.get(id)).title;
  }, localBook.id);
  expect(title).toBe("Updated on another device");
});

test("should preserve a warm Reader when sync acknowledges local writes", async ({
  page,
  localBook,
  remote,
}) => {
  await openLocalBook(page, localBook.id);
  await nextSpread(page);
  const pagesBefore = await currentPages(page);
  const reads = await page.evaluateHandle(async () => {
    const modulePath = "/src/lib/sync-v2/db.ts";
    const { syncV2Db: db } = await import(modulePath);
    const counts = { books: 0, bookChapterSourceCache: 0 };
    for (const name of ["books", "bookChapterSourceCache"] as const) {
      db.table(name).hook("reading", (row: unknown) => {
        counts[name]++;
        return row;
      });
    }
    return counts;
  });
  const pushedBefore = remote.pushed.length;
  // The Reader has no sync control; sync runs as it would in the background.
  await page.evaluate(async () => {
    const modulePath = "/src/lib/sync-service.ts";
    await (await import(modulePath)).syncService.syncAll();
  });
  await expect.poll(() => remote.pushed.length).toBeGreaterThan(pushedBefore);
  const remaining = await page.evaluate(async () => {
    const modulePath = "/src/lib/sync-v2/db.ts";
    return (await import(modulePath)).syncV2Db._sync_outbox.count();
  });
  expect(remaining).toBe(0);
  expect(await currentPages(page)).toEqual(pagesBefore);
  expect(await reads.jsonValue()).toEqual({
    books: 0,
    bookChapterSourceCache: 0,
  });
  await reads.dispose();
});
