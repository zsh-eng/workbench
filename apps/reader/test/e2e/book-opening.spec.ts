import { readFile } from "node:fs/promises";
import {
  expect,
  test,
  SAMPLE_EPUB_PATH,
  SAMPLE_BOOK_TITLE,
  waitForReaderReady,
  nextSpread,
  currentPages,
} from "./helpers/fixtures";

// A single column keeps this regression independent of the known two-column
// checkpoint alignment issue.
test.use({ viewport: { width: 800, height: 900 } });

const quote = "Twinkle, twinkle, little bat!";

for (const remoteOnly of [false, true]) {
  test(`opens Highlights target with ${remoteOnly ? "downloaded" : "local"} EPUB bytes`, async ({
    page,
    localBook,
  }) => {
    const sourceFileId = await page.evaluate(
      async ({ bookId, quote, remoteOnly }) => {
        const path = "/src/lib/sync-v2/db.ts";
        const { syncV2Db: db } = await import(path);
        const book = await db.books.get(bookId);
        const entries = await db.bookFiles
          .where("bookId")
          .equals(bookId)
          .toArray();
        let spineItemId = "";
        let startOffset = 0;
        for (const item of book.spine) {
          const href = book.manifest.find(
            (entry: { id: string }) => entry.id === item.idref,
          ).href;
          const file = entries.find(
            (entry: { path: string }) => entry.path === href,
          );
          if (!file) continue;
          const doc = new DOMParser().parseFromString(
            await file.content.text(),
            "text/html",
          );
          const offset = (doc.body.textContent ?? "").indexOf(quote);
          if (offset >= 0) {
            spineItemId = item.idref;
            startOffset = offset;
            break;
          }
        }
        if (!spineItemId) throw new Error("Fixture target chapter not found");
        await db.highlights.put({
          id: "opening-target",
          bookId,
          spineItemId,
          startOffset,
          endOffset: startOffset + quote.length,
          selectedText: quote,
          textBefore: "",
          textAfter: "",
          color: "yellow",
          createdAt: Date.now(),
          isDeleted: false,
        });
        if (remoteOnly) {
          await db.files.delete(book.sourceFileId);
          await db.bookFiles.where("bookId").equals(bookId).delete();
          await db.bookMaterializations.where("bookId").equals(bookId).delete();
        }
        return book.sourceFileId;
      },
      { bookId: localBook.id, quote, remoteOnly },
    );
    let releaseDownload: () => void = () => {};
    const downloadGate = new Promise<void>((resolve) => {
      releaseDownload = resolve;
    });
    let requested = false;
    if (remoteOnly) {
      const bytes = await readFile(SAMPLE_EPUB_PATH);
      await page.route(`**/api/files/${sourceFileId}`, async (route) => {
        requested = true;
        await downloadGate;
        await route.fulfill({
          body: bytes,
          contentType: "application/epub+zip",
        });
      });
    }
    await page.goto("/highlights");
    await page.getByRole("button", { name: `Open at: ${quote}` }).click();
    await expect(page).toHaveURL(`/reader/${localBook.id}`);
    if (remoteOnly) {
      await expect.poll(() => requested).toBe(true);
      await expect(page.locator("[data-reader-page-content]")).toHaveCount(0);
      releaseDownload();
    }
    await waitForReaderReady(page);
    await expect(
      page
        .locator(
          '[data-reader-spread-layer="current"] [data-highlight-id="opening-target"]',
        )
        .first(),
    ).toBeVisible();
    expect(
      await page.evaluate(() => history.state.usr?.scrollToHighlight),
    ).toBeUndefined();
    const localState = await page.evaluate(
      async ({ bookId, sourceFileId }) => {
        const path = "/src/lib/sync-v2/db.ts";
        const { syncV2Db: db } = await import(path);
        const marker = await db.bookMaterializations
          .where("bookId")
          .equals(bookId)
          .first();
        return {
          hasBytes: !!(await db.files.get(sourceFileId)),
          sourceFileId: marker?.sourceFileId,
        };
      },
      { bookId: localBook.id, sourceFileId },
    );
    expect(localState).toEqual({ hasBytes: true, sourceFileId });
    await nextSpread(page);
    const advanced = await currentPages(page);
    await page.goto("/");
    await page.getByRole("heading", { name: SAMPLE_BOOK_TITLE }).click();
    await waitForReaderReady(page);
    await expect.poll(() => currentPages(page)).toEqual(advanced);
  });
}
