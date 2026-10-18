import { expect, openLocalBook, test } from "./helpers/fixtures";

const CURRENT_SPREAD = '[data-reader-spread-layer="current"]';

test("lets glyphs that overhang the text column reach the page margin", async ({
  page,
  localBook,
}) => {
  await openLocalBook(page, localBook.id);

  // A line-initial "j" or a line-final italic "f" draws a little outside the
  // column. Only the spread edge may clip it, not the page or the column.
  const clipsHorizontally = await page.evaluate((spreadSelector) => {
    const column = document.querySelector(
      `${spreadSelector} [data-reader-page-content]`,
    )!;
    const slot = column.closest("[data-reader-page-slot]")!;
    return [column, slot, slot.parentElement!]
      .map((element) => getComputedStyle(element).overflowX)
      .filter((overflowX) => overflowX !== "visible");
  }, CURRENT_SPREAD);
  expect(clipsHorizontally).toEqual([]);
});
