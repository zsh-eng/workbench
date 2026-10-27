import { epubVariant } from "./helpers/epub-variants";
import { expect, test } from "./helpers/fixtures";
import { importAndOpenEpub, showPhoneChrome } from "./helpers/reader-books";

const CURRENT_SPREAD = '[data-reader-spread-layer="current"]';

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
