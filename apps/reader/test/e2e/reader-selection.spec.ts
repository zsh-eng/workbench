import type { Page } from "@playwright/test";
import { expect, nextSpread, openLocalBook, test } from "./helpers/fixtures";

const CURRENT_SPREAD = '[data-reader-spread-layer="current"]';

/**
 * Turns pages until one shows two paragraphs in a row that each wrap, then
 * selects from the first one's second line to the second one's second line.
 */
async function selectAcrossTwoParagraphs(page: Page) {
  for (let turn = 0; turn < 12; turn++) {
    const selected = await page.evaluate((spreadSelector) => {
      const paragraphs = [
        ...document.querySelectorAll<HTMLElement>(
          `${spreadSelector} p[data-reader-block-id]`,
        ),
      ];
      const wraps = (p: Element | undefined) =>
        !!p && p.querySelectorAll(":scope > span").length >= 2;
      const pair = paragraphs.findIndex(
        (p, i) => wraps(p) && wraps(paragraphs[i + 1]),
      );
      if (pair < 0) return null;
      const lineText = (line: Element) => {
        const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
        while (walker.nextNode())
          if ((walker.currentNode.textContent ?? "").trim().length > 3)
            return walker.currentNode as Text;
        return null;
      };
      const start = lineText(
        paragraphs[pair].querySelectorAll(":scope > span")[1],
      );
      const end = lineText(
        paragraphs[pair + 1].querySelectorAll(":scope > span")[1],
      );
      if (!start || !end) return null;
      const range = document.createRange();
      range.setStart(start, 0);
      range.setEnd(end, end.length);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(range);
      return getSelection()!.toString();
    }, CURRENT_SPREAD);
    if (selected) return selected;
    await nextSpread(page);
  }
  throw new Error("No page with two adjacent wrapped paragraphs");
}

function expectReadableCopy(text: string) {
  const paragraphs = text.split("\n\n");
  expect(paragraphs).toHaveLength(2);
  for (const paragraph of paragraphs) {
    expect(paragraph).not.toMatch(/\s{2,}|\n|\t/);
    expect(paragraph).toBe(paragraph.trim());
  }
}

test("copies a selection as paragraphs, not as page lines", async ({
  page,
  localBook,
}) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await openLocalBook(page, localBook.id);
  await nextSpread(page);

  const selected = await selectAcrossTwoParagraphs(page);
  // The page puts a line break after every wrapped line.
  expect(selected.split("\n").length).toBeGreaterThan(3);

  await page.keyboard.press("ControlOrMeta+c");
  expectReadableCopy(await page.evaluate(() => navigator.clipboard.readText()));

  // The highlight toolbar's Copy writes the same text.
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await page.evaluate(() =>
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true })),
  );
  await page.getByRole("button", { name: /^Copy/ }).first().click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .not.toBe("");
  expectReadableCopy(await page.evaluate(() => navigator.clipboard.readText()));
});
