import type { Page } from "@playwright/test";
import {
  currentPages,
  expect,
  nextSpread,
  openLocalBook,
  test,
  waitForReaderReady,
} from "./helpers/fixtures";

// The OPPO Pad Mini, where Justify is on by default.
test.use({
  isMobile: true,
  hasTouch: true,
  viewport: { width: 1008, height: 640 },
  contextOptions: { screen: { width: 1008, height: 672 } },
  deviceScaleFactor: 2.5,
});

const CURRENT_SPREAD = '[data-reader-spread-layer="current"]';
const LINES = `${CURRENT_SPREAD} p[data-reader-page-slice] > span`;

/** How the current spread sets its lines, as the reader sees them. */
function readLines(page: Page) {
  return page.locator(LINES).evaluateAll((lines) =>
    lines.map((line) => {
      const box = line.parentElement!.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(line);
      return {
        text: (line.textContent ?? "").trimEnd(),
        justified: (line as HTMLElement).style.wordSpacing !== "",
        right: range.getBoundingClientRect().right - box.right,
      };
    }),
  );
}

const spreadText = (page: Page) =>
  page
    .locator(CURRENT_SPREAD)
    .evaluate((element) =>
      (element.textContent ?? "").replace(/\s+/g, " ").trim(),
    );

/** Turns to the first spread with a line that ends in a hyphen it added. */
async function turnToHyphenatedWord(page: Page) {
  for (let turn = 0; turn < 40; turn++) {
    await nextSpread(page);
    const lines = await readLines(page);
    const index = lines.findIndex(
      ({ text }, line) =>
        /\p{Ll}{2}-$/u.test(text) &&
        /^\p{Ll}{3}/u.test(lines[line + 1]?.text ?? ""),
    );
    if (index >= 0) {
      const before = lines[index]!.text.split(" ").at(-1)!.slice(0, -1);
      const after = lines[index + 1]!.text.split(" ")[0]!;
      return {
        index,
        word: `${before}${after}`.replace(/[^\p{L}]/gu, ""),
        head: before,
        tail: after,
      };
    }
  }
  throw new Error("No hyphenated word in the first 40 spreads");
}

/** Selects a word across a line break, as a finger dragging over it would. */
async function selectAcrossLines(
  page: Page,
  lineIndex: number,
  headLength: number,
  tailLength: number,
) {
  await page.evaluate(
    ({ selector, lineIndex, headLength, tailLength }) => {
      const lines = document.querySelectorAll(selector);
      const lastText = (line: Element) => {
        const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
        let last: Node | null = null;
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          last = node;
        }
        return last as Text;
      };
      const firstText = (line: Element) =>
        document
          .createTreeWalker(line, NodeFilter.SHOW_TEXT)
          .nextNode() as Text;
      const start = lastText(lines[lineIndex]!);
      const end = firstText(lines[lineIndex + 1]!);
      const range = document.createRange();
      // The drawn hyphen is the last character before the break.
      range.setStart(start, start.length - headLength - 1);
      range.setEnd(end, tailLength);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(range);
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    },
    { selector: LINES, lineIndex, headLength, tailLength },
  );
}

test("a tablet justifies and hyphenates, and every line ends on the margin", async ({
  page,
  localBook,
}) => {
  await openLocalBook(page, localBook.id);
  let hyphens = 0;
  let checked = 0;
  for (let turn = 0; turn < 16; turn++) {
    await nextSpread(page);
    const lines = await readLines(page);
    for (const line of lines) {
      expect(line.right, line.text).toBeLessThanOrEqual(0.5);
      if (!line.justified) continue;
      checked += 1;
      expect(line.right, line.text).toBeGreaterThan(-0.5);
      if (/\p{L}-$/u.test(line.text)) hyphens += 1;
    }
  }
  expect(checked).toBeGreaterThan(100);
  expect(hyphens).toBeGreaterThan(0);
});

test("a hyphenated word stays one word to copy, search and reopen", async ({
  page,
  localBook,
}) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await openLocalBook(page, localBook.id);
  const { index, word, head, tail } = await turnToHyphenatedWord(page);

  await selectAcrossLines(page, index, head.length, tail.length);
  await expect
    .poll(() =>
      page.evaluate(async () => {
        document.execCommand("copy");
        return navigator.clipboard.readText();
      }),
    )
    .toBe(word);

  await page.evaluate(() => getSelection()!.removeAllRanges());
  await page.keyboard.press("Control+f");
  await page.getByRole("searchbox", { name: "Search this book" }).fill(word);
  await expect
    .poll(() =>
      page.evaluate((selector) => {
        const spread = document.querySelector(selector)!;
        return [...(CSS.highlights.get("reader-search") ?? [])]
          .filter((range) =>
            spread.contains((range as Range).commonAncestorContainer),
          )
          .map((range) => range.toString().replace(/[\s-]/g, ""));
      }, CURRENT_SPREAD),
    )
    .toContain(word);
  await page.keyboard.press("Escape");

  const pages = await currentPages(page);
  await page.reload();
  await waitForReaderReady(page);
  expect(await currentPages(page)).toEqual(pages);
  const lines = await readLines(page);
  expect(lines[index]!.text.endsWith(`${head}-`)).toBe(true);
});

test("Justify in Appearance sets the text left and back, at the same place", async ({
  page,
  localBook,
}) => {
  await openLocalBook(page, localBook.id);
  for (let turn = 0; turn < 8; turn++) await nextSpread(page);
  await expect
    .poll(async () => (await readLines(page)).some((l) => l.justified))
    .toBe(true);
  const before = await spreadText(page);

  const sidebar = page.locator('aside[aria-label="Reader tools"]');
  const tools = page.getByRole("button", {
    name: "Open reader tools",
    exact: true,
  });
  const { width, height } = page.viewportSize()!;
  await page.touchscreen.tap(width / 2, height / 2);
  await expect(tools).toBeInViewport();
  await tools.tap();
  await expect(sidebar).toHaveAttribute("aria-hidden", "false");
  await sidebar
    .getByRole("button", { name: "Reading appearance", exact: true })
    .tap();
  const justify = sidebar.getByRole("switch", { name: "Justify", exact: true });
  await expect(justify).toBeChecked();

  await justify.tap();
  await expect(justify).not.toBeChecked();
  await expect
    .poll(async () => (await readLines(page)).some((l) => l.justified))
    .toBe(false);
  await waitForReaderReady(page);
  const left = await spreadText(page);
  expect(
    left.includes(before.slice(0, 30)) || before.includes(left.slice(0, 30)),
  ).toBe(true);

  await page.reload();
  await waitForReaderReady(page);
  expect((await readLines(page)).some((l) => l.justified)).toBe(false);
});

test.describe("on a phone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    contextOptions: { screen: { width: 390, height: 844 } },
  });

  test("Justify starts off", async ({ page, localBook }) => {
    await openLocalBook(page, localBook.id);
    for (let turn = 0; turn < 10; turn++) await nextSpread(page);
    expect((await readLines(page)).length).toBeGreaterThan(5);
    expect((await readLines(page)).some((l) => l.justified)).toBe(false);
  });
});
