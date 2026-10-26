import { readFile } from "node:fs/promises";
import {
  expect,
  test,
  SAMPLE_EPUB_PATH,
  waitForSheet,
} from "./helpers/fixtures";

// Debug -> Offline downloads: a book that is only on the server downloads
// from the Library, on its cover, with the glyph and its sheet.
test.use({ viewport: { width: 390, height: 844 } });

test("a book downloads for offline on its cover", async ({
  page,
  context,
  localBook,
}) => {
  await context.addInitScript(() => {
    localStorage.setItem("reader-debug-enabled-v1", "true");
    localStorage.setItem("reader-offline-downloads-v1", "true");
  });
  const sourceFileId = await page.evaluate(async (bookId) => {
    const { syncV2Db: db } = await import("/src/lib/sync-v2/db.ts");
    const book = await db.books.get(bookId);
    await db.files.delete(book.sourceFileId);
    await db.bookFiles.where("bookId").equals(bookId).delete();
    await db.bookMaterializations.where("bookId").equals(bookId).delete();
    return book.sourceFileId as string;
  }, localBook.id);

  const bytes = await readFile(SAMPLE_EPUB_PATH);
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requests = 0;
  await page.route(`**/api/files/${sourceFileId}`, async (route) => {
    requests += 1;
    await gate;
    await route.fulfill({ body: bytes, contentType: "application/epub+zip" });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Sort and layout" }).click();
  await page
    .getByRole("menuitem", { name: "Download all for offline" })
    .click();

  const cover = page.locator(`[data-cover-activity]`).first();
  await expect(cover).toHaveAttribute("data-cover-activity", "running");
  await expect.poll(() => requests).toBe(1);
  const glyph = page.locator("[data-activity-glyph]");
  await expect(glyph).toHaveAttribute("data-activity-glyph", "progress");
  await glyph.click();
  const sheet = await waitForSheet(page, "Activity");
  await expect(sheet.getByText("Now")).toBeVisible();
  // The row carries the book's cover: the shelf is behind the sheet.
  await expect(
    sheet.locator(`[data-sheet-cover="${localBook.id}"]`),
  ).toBeVisible();
  await expect(sheet.getByRole("button", { name: /^Cancel / })).toBeVisible();
  // Signed out, sync says so under This app, in words that are all there.
  const syncLine = sheet
    .locator('[data-sheet-row="sync"]')
    .getByText(/only on this device\. Sign in to keep them\.$/);
  await expect(syncLine).toBeVisible();
  expect(
    await syncLine.evaluate(
      (element) =>
        element.scrollHeight <= element.clientHeight &&
        element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");

  // "On this device" keeps what it showed while you look at it.
  const filters = page.getByRole("group", { name: "Show" });
  await filters.getByRole("button", { name: "On this device" }).click();
  const nothingHere = page.getByText(/^No books on this device yet/);
  await expect(nothingHere).toBeVisible();
  release();
  await expect(glyph).toHaveAttribute("data-activity-glyph", "done");
  await expect(nothingHere).toBeVisible();
  // Chosen again, it takes the book in.
  await filters.getByRole("button", { name: "All" }).click();
  await filters.getByRole("button", { name: "On this device" }).click();
  await expect(nothingHere).toBeHidden();
  await filters.getByRole("button", { name: "All" }).click();

  // The check confirms once, then the cover goes back to rest.
  await expect(page.locator("[data-cover-activity]")).toHaveCount(0, {
    timeout: 5_000,
  });
  const stored = await page.evaluate(async (id) => {
    const { syncV2Db: db } = await import("/src/lib/sync-v2/db.ts");
    return !!(await db.files.get(id));
  }, sourceFileId);
  expect(stored).toBe(true);

  // Everything is here now: the menu says so instead of downloading again.
  await page.getByRole("button", { name: "Sort and layout" }).click();
  await page
    .getByRole("menuitem", { name: "Download all for offline" })
    .click();
  await expect(page.getByText("Your book is on this device.")).toBeVisible();
  expect(requests).toBe(1);
});
