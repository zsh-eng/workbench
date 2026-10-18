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

async function openChapter(page: Page, name: RegExp) {
  await page.mouse.move(600, 20);
  await page
    .getByRole("button", { name: "Open reader tools", exact: true })
    .click();
  await page.getByRole("button", { name }).click();
  await page
    .getByRole("navigation", { name: "Reader tools" })
    .getByRole("button", { name: "Close reader tools", exact: true })
    .click();
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

test("two highlights that split a word meet flush without moving the text", async ({
  page,
  localBook,
}) => {
  await openLocalBook(page, localBook.id);
  await openChapter(page, /CHAPTER I\. Down the Rabbit-Hole/i);

  // Marks the long text node's characters [from, to) as selected.
  const select = (from: number, to: number) =>
    page.evaluate(
      ({ spreadSelector, from, to }) => {
        const spread = document.querySelector(spreadSelector)!;
        const line = spread.querySelector("[data-test-line]")!;
        const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
        const nodes: Text[] = [];
        while (walker.nextNode()) nodes.push(walker.currentNode as Text);
        // Locate offsets across the text nodes the marks split the line into.
        const locate = (offset: number): [Text, number] => {
          let seen = 0;
          for (const node of nodes) {
            if (offset <= seen + node.length) return [node, offset - seen];
            seen += node.length;
          }
          throw new Error("Offset past the line");
        };
        const range = document.createRange();
        range.setStart(...locate(from));
        range.setEnd(...locate(to));
        getSelection()!.removeAllRanges();
        getSelection()!.addRange(range);
        return range.toString();
      },
      { spreadSelector: CURRENT_SPREAD, from, to },
    );
  const releasePointer = () =>
    page.evaluate(() =>
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true })),
    );
  const lineRight = () =>
    page.evaluate(
      (spreadSelector) =>
        document
          .querySelector(`${spreadSelector} [data-test-line]`)!
          .getBoundingClientRect().right,
      CURRENT_SPREAD,
    );

  // The first line of the second paragraph has room for two highlights and
  // more text after them.
  await page.evaluate((spreadSelector) => {
    const lines = document.querySelectorAll(
      `${spreadSelector} p[data-reader-block-id] > span`,
    );
    const line = [...lines].find((candidate) =>
      candidate.textContent?.startsWith("So she was considering"),
    )!;
    line.setAttribute("data-test-line", "");
  }, CURRENT_SPREAD);
  const before = await lineRight();

  // The second highlight starts mid-word, where the first one ends.
  const marks = page.locator(`${CURRENT_SPREAD} [data-test-line] mark`);
  await select(0, 13);
  await releasePointer();
  await page.getByRole("button", { name: "Highlight with yellow" }).click();
  await expect(marks).toHaveCount(1);
  await select(13, 26);
  await releasePointer();
  await page.getByRole("button", { name: "Highlight with blue" }).click();
  await expect(marks).toHaveCount(2);
  const [first, second] = await marks.evaluateAll((elements) =>
    elements.map((mark) => ({
      start: mark.hasAttribute("data-highlight-start"),
      end: mark.hasAttribute("data-highlight-end"),
      left: mark.getBoundingClientRect().left,
      right: mark.getBoundingClientRect().right,
    })),
  );
  expect(first).toMatchObject({ start: true, end: false });
  expect(second).toMatchObject({ start: false, end: true });
  expect(Math.abs(second!.left - first!.right)).toBeLessThan(0.5);
  expect(Math.abs((await lineRight()) - before)).toBeLessThan(0.5);
});
