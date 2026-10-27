import type { Page } from "@playwright/test";
import {
  expect,
  nextSpread,
  openLocalBook,
  selectPassage,
  test,
  waitForReaderReady,
} from "./helpers/fixtures";

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

test("Highlight takes a selection that keys grew after the toolbar opened, by click or by key", async ({
  page,
  localBook,
}) => {
  const saved = () =>
    page.evaluate(async (bookId) => {
      const path = "/src/lib/db.ts";
      const highlights: { color: string; selectedText: string }[] = await (
        await import(path)
      ).getBookHighlights(bookId);
      return highlights
        .map(({ color, selectedText }) => `${color}: ${selectedText}`)
        .sort();
    }, localBook.id);
  // Keys change a selection without the pointer release the Reader reads.
  const growSelection = async (keys: number) => {
    const before = await page.evaluate(() => getSelection()!.toString());
    for (let key = 0; key < keys; key++)
      await page.keyboard.press("Shift+ArrowRight");
    const grown = await page.evaluate(() => getSelection()!.toString());
    expect(grown.length).toBeGreaterThan(before.length);
    return grown.replace(/\s+/g, " ").trim();
  };
  await openLocalBook(page, localBook.id);
  for (let turn = 0; turn < 3; turn++) await nextSpread(page);
  const yellow = page.getByRole("button", { name: "Highlight with yellow" });
  const green = page.getByRole("button", { name: "Highlight with green" });

  await selectPassage(page, { length: 12 });
  await expect(yellow).toBeVisible();
  const clicked = await growSelection(9);
  await yellow.click();
  await expect.poll(saved).toEqual([`yellow: ${clicked}`]);
  await expect(page.locator(".highlight-toolbar")).toHaveCount(0);

  // A key on a colour, with no press, acts on the selection as it is then.
  await selectPassage(page, { index: 1, length: 12 });
  await expect(green).toBeVisible();
  const keyed = await growSelection(6);
  await green.focus();
  await page.keyboard.press("Enter");
  await expect.poll(saved).toEqual([`green: ${keyed}`, `yellow: ${clicked}`]);
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

/**
 * The text a paragraph's slices show on the current spread, without spaces:
 * the lines end in <br>, so the page's text has no space between them.
 */
function paragraphText(page: Page, blockId: string) {
  return page.evaluate(
    ({ spreadSelector, blockId }) =>
      [
        ...document.querySelectorAll(
          `${spreadSelector} p[data-reader-block-id="${blockId}"]`,
        ),
      ]
        .map((slice) => slice.textContent)
        .join("")
        .replace(/\s+/g, ""),
    { spreadSelector: CURRENT_SPREAD, blockId },
  );
}

function highlightedText(page: Page) {
  return page.evaluate(
    (spreadSelector) =>
      [
        ...document.querySelectorAll(
          `${spreadSelector} mark[data-highlight-id]`,
        ),
      ]
        .map((mark) => mark.textContent)
        .join("")
        .replace(/\s+/g, ""),
    CURRENT_SPREAD,
  );
}

test("a triple-click highlights the whole paragraph, across italics", async ({
  page,
  localBook,
}) => {
  await openLocalBook(page, localBook.id);
  await openChapter(page, /CHAPTER I\. Down the Rabbit-Hole/i);

  // The third paragraph sets "very" and "took a watch" in italics.
  const paragraph = page
    .locator(`${CURRENT_SPREAD} p[data-reader-block-id]`)
    .filter({ hasText: "There was nothing so" });
  const blockId = (await paragraph.getAttribute("data-reader-block-id"))!;
  const line = paragraph.locator(":scope > span").nth(1);
  await line.click({ clickCount: 3, position: { x: 30, y: 8 } });

  await page.getByRole("button", { name: "Highlight with yellow" }).click();
  await expect(
    page.locator(`${CURRENT_SPREAD} mark[data-highlight-id]`).first(),
  ).toBeVisible();
  expect(await highlightedText(page)).toBe(await paragraphText(page, blockId));
});

test("a triple-click highlights a paragraph over the page break", async ({
  page,
  localBook,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await openLocalBook(page, localBook.id);
  await openChapter(page, /CHAPTER I\. Down the Rabbit-Hole/i);

  // Find a spread whose left page ends partway through a paragraph.
  const continuing = () =>
    page.evaluate((spreadSelector) => {
      const pages = document.querySelectorAll(
        `${spreadSelector} [data-reader-page-content]`,
      );
      if (pages.length !== 2) return null;
      const left = pages[0]!.querySelector(":scope > p:last-child");
      const right = pages[1]!.querySelector(":scope > p:first-child");
      const id = left?.getAttribute("data-reader-block-id");
      return id && id === right?.getAttribute("data-reader-block-id")
        ? id
        : null;
    }, CURRENT_SPREAD);
  let blockId = await continuing();
  for (let turn = 0; turn < 15 && !blockId; turn++) {
    await nextSpread(page);
    blockId = await continuing();
  }
  expect(blockId).toBeTruthy();

  // The chrome stays while focus is in it, and its footer covers the
  // pages' last lines. Reading on, the pointer and focus leave it.
  await page.mouse.move(640, 300);
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await expect(page.locator("[data-reader-footer]")).toHaveCount(0);
  await page
    .locator(`${CURRENT_SPREAD} [data-reader-page-content]`)
    .first()
    .locator(`p[data-reader-block-id="${blockId}"] > span`)
    .last()
    .click({ clickCount: 3, position: { x: 20, y: 8 } });
  await page.getByRole("button", { name: "Highlight with yellow" }).click();

  const pages = page.locator(`${CURRENT_SPREAD} [data-reader-page-content]`);
  await expect(
    pages.nth(0).locator("mark[data-highlight-id]").first(),
  ).toBeVisible();
  await expect(
    pages.nth(1).locator("mark[data-highlight-id]").first(),
  ).toBeVisible();
  expect(await highlightedText(page)).toBe(await paragraphText(page, blockId!));
});

test.describe("on a phone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test("a paragraph selected with the handles opens the highlight bar", async ({
    page,
    localBook,
  }) => {
    await openLocalBook(page, localBook.id);
    const paragraph = page
      .locator(`${CURRENT_SPREAD} p[data-reader-block-id]`)
      .filter({ hasText: "There was nothing so" });
    for (let turn = 0; turn < 12 && !(await paragraph.count()); turn++)
      await nextSpread(page);
    await waitForReaderReady(page);

    // Playwright cannot drag the native handles, so set the selection they
    // would leave: the whole paragraph, italics included.
    await expect(paragraph).toBeVisible();
    const blockId = (await paragraph.getAttribute("data-reader-block-id"))!;
    await paragraph.evaluate((element) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const nodes: Text[] = [];
      while (walker.nextNode()) nodes.push(walker.currentNode as Text);
      const range = document.createRange();
      range.setStart(nodes[0]!, 0);
      range.setEnd(nodes.at(-1)!, nodes.at(-1)!.length);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(range);
    });
    await page.evaluate(() =>
      document.dispatchEvent(new TouchEvent("touchend", { bubbles: true })),
    );
    await page.getByRole("button", { name: "Highlight with yellow" }).tap();
    await expect(
      page.locator(`${CURRENT_SPREAD} mark[data-highlight-id]`).first(),
    ).toBeVisible();
    expect(await highlightedText(page)).toBe(
      await paragraphText(page, blockId),
    );
  });
});
