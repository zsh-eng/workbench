import { expect, nextSpread, openLocalBook, test } from "./helpers/fixtures";

const CURRENT_SPREAD = '[data-reader-spread-layer="current"]';

test("keeps blockquote lines inside the text column", async ({
  page,
  localBook,
}) => {
  await openLocalBook(page, localBook.id);
  await page.mouse.move(600, 20);
  await page
    .getByRole("button", { name: "Open reader tools", exact: true })
    .click();
  await page
    .getByRole("button", { name: /THE FULL PROJECT GUTENBERG LICENSE/i })
    .click();
  await page
    .getByRole("navigation", { name: "Reader tools" })
    .getByRole("button", { name: "Close reader tools", exact: true })
    .click();

  // The licence quotes its required notice in a blockquote a few pages in.
  const quote = page.locator(`${CURRENT_SPREAD} p.reader-blockquote`);
  for (let turn = 0; turn < 12 && (await quote.count()) === 0; turn++) {
    await nextSpread(page);
  }
  await expect(quote.first()).toBeVisible();

  const overflow = await page.evaluate((spreadSelector) => {
    const quotes = document.querySelectorAll<HTMLElement>(
      `${spreadSelector} p.reader-blockquote`,
    );
    const results: { text: string; overflowPx: number }[] = [];
    for (const quote of quotes) {
      const column = quote
        .closest("[data-reader-page-content]")!
        .getBoundingClientRect();
      for (const line of quote.querySelectorAll(":scope > span")) {
        const range = document.createRange();
        range.selectNodeContents(line);
        const text = range.toString();
        const lastGlyph = text.trimEnd().length;
        if (lastGlyph === 0) continue;
        // Measure to the last visible character, not a trailing space.
        const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
        let seen = 0;
        while (walker.nextNode()) {
          const node = walker.currentNode as Text;
          if (seen + node.length >= lastGlyph) {
            range.setStart(node, lastGlyph - seen - 1);
            range.setEnd(node, lastGlyph - seen);
            break;
          }
          seen += node.length;
        }
        results.push({
          text,
          overflowPx: range.getBoundingClientRect().right - column.right,
        });
      }
    }
    return results;
  }, CURRENT_SPREAD);
  expect(overflow.length).toBeGreaterThan(1);
  for (const line of overflow) {
    expect(line.overflowPx, line.text).toBeLessThanOrEqual(0.5);
  }
});
