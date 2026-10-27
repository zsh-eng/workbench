import { epubVariant } from "./helpers/epub-variants";
import { expect, openLocalBook, test, waitForSheet } from "./helpers/fixtures";
import { importAndOpenEpub, showPhoneChrome } from "./helpers/reader-books";

const CURRENT_SPREAD = '[data-reader-spread-layer="current"]';

test.describe("on a phone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test("a Contents tap before the Reader is ready opens Contents once it is", async ({
    page,
    localBook,
  }) => {
    // The footer's chapter title shows before the first page has painted.
    // Tap it the moment it appears, before the Reader takes taps.
    await page.addInitScript(() => {
      const observer = new MutationObserver(() => {
        const button = document.querySelector<HTMLButtonElement>(
          '[data-reader-footer] button[aria-label="Open table of contents"]',
        );
        if (!button) return;
        observer.disconnect();
        button.click();
      });
      observer.observe(document, { childList: true, subtree: true });
    });
    await openLocalBook(page, localBook.id);
    const contents = await waitForSheet(page, "Contents");
    await expect(
      contents.getByRole("button", { name: /CHAPTER I\./ }).first(),
    ).toBeVisible();
  });
});

test.describe("on an iPad", () => {
  test.use({
    viewport: { width: 820, height: 1180 },
    isMobile: true,
    hasTouch: true,
  });

  test("a chapter tapped in Contents as a long book opens is where the book goes", async ({
    page,
  }) => {
    test.slow();
    // Twelve long chapters: the last is laid out well after the first page.
    const title = "Long Chapters";
    const longChapter = (xhtml: string) =>
      xhtml.replace(
        /(<\/h2>)([\s\S]*)(<\/div><\/body>)/,
        (_, heading: string, text: string, end: string) =>
          heading + text.repeat(12) + end,
      );
    const book = epubVariant({
      name: "long-chapters",
      title,
      author: "Test Author",
      documents: Object.fromEntries(
        Array.from({ length: 12 }, (_, index) => [
          `OEBPS/4269428405154643194_11-h-${index + 1}.htm.xhtml`,
          longChapter,
        ]),
      ),
    });
    await importAndOpenEpub(page, book, title);

    await showPhoneChrome(page);
    await page
      .getByRole("button", { name: "Open table of contents", exact: true })
      .tap();
    // An iPad's Contents is the Reader tools panel. Tap the last chapter at
    // once, as someone who knows where they are going.
    await page
      .getByRole("complementary", { name: "Reader tools", exact: true })
      .getByRole("button", { name: /CHAPTER XII\./ })
      .tap();
    await expect(
      page.locator(`${CURRENT_SPREAD} [data-reader-block-id]`).first(),
    ).toHaveText(/^\s*CHAPTER XII\./);
  });
});
