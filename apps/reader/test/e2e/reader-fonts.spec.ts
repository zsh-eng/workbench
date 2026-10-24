import type { Page } from "@playwright/test";
import {
  expect,
  nextSpread,
  openLocalBook,
  openReaderTools,
  test,
  waitForReaderReady,
  waitForSheet,
} from "./helpers/fixtures";

test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});

const CURRENT_SPREAD = '[data-reader-spread-layer="current"]';

/** The font-family the current spread's first line of text is drawn in. */
function pageFont(page: Page): Promise<string> {
  return page.evaluate((selector) => {
    const walker = document.createTreeWalker(
      document.querySelector(`${selector} p[data-reader-page-slice]`)!,
      NodeFilter.SHOW_TEXT,
    );
    while (walker.nextNode()) {
      const parent = walker.currentNode.parentElement;
      if (parent && walker.currentNode.textContent!.trim())
        return getComputedStyle(parent).fontFamily;
    }
    return "";
  }, CURRENT_SPREAD);
}

/**
 * How far the current spread's text runs past its page: the furthest last
 * character of a line past its block's right edge, and the furthest block
 * past the bottom of its page, in px. Negative values fit.
 */
function textOverflow(page: Page) {
  return page.evaluate((selector) => {
    let lines = 0;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const column of document.querySelectorAll(
      `${selector} [data-reader-page-content]`,
    )) {
      const page = column.getBoundingClientRect();
      for (const block of column.querySelectorAll<HTMLElement>(
        "p[data-reader-page-slice]",
      )) {
        const box = block.getBoundingClientRect();
        bottom = Math.max(bottom, box.bottom - page.bottom);
        for (const line of block.querySelectorAll(":scope > span")) {
          const range = document.createRange();
          range.selectNodeContents(line);
          const lastGlyph = range.toString().trimEnd().length;
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
          lines += 1;
          right = Math.max(
            right,
            range.getBoundingClientRect().right - box.right,
          );
        }
      }
    }
    return { lines, right, bottom };
  }, CURRENT_SPREAD);
}

/** Turns past the cover and front matter to a page of prose. */
async function turnToText(page: Page) {
  const blocks = page.locator(`${CURRENT_SPREAD} p[data-reader-page-slice]`);
  for (let turn = 0; turn < 8 && (await blocks.count()) < 4; turn++) {
    await nextSpread(page);
  }
  await expect(blocks.nth(3)).toBeVisible();
}

/** Checks that the current spread's text fits; returns its line count. */
async function expectTextToFit(page: Page): Promise<number> {
  const overflow = await textOverflow(page);
  expect(overflow.right).toBeLessThanOrEqual(0.5);
  expect(overflow.bottom).toBeLessThanOrEqual(0.5);
  return overflow.lines;
}

test("a sans font chosen in Appearance lays out the book and stays chosen", async ({
  page,
  localBook,
}) => {
  await openLocalBook(page, localBook.id);
  await turnToText(page);
  await page.touchscreen.tap(195, 422);
  const tools = await openReaderTools(page);
  await tools.getByRole("button", { name: "Appearance", exact: true }).click();
  const sheet = await waitForSheet(page, "Appearance");
  await sheet.getByRole("button", { name: "Atkinson", exact: true }).click();
  await expect(
    sheet.getByRole("button", { name: "Atkinson", pressed: true }),
  ).toBeVisible();
  await expect
    .poll(() => pageFont(page))
    .toContain("Atkinson Hyperlegible Next");

  await page.reload();
  await waitForReaderReady(page);
  expect(await pageFont(page)).toContain("Atkinson Hyperlegible Next");
  let lines = 0;
  for (let turn = 0; turn < 3; turn++) {
    lines += await expectTextToFit(page);
    await nextSpread(page);
  }
  expect(lines).toBeGreaterThan(20);
});

test("every sans font keeps justified pages inside their margins", async ({
  page,
  localBook,
}) => {
  // Justified lines run to the edge, so text measured narrower than it is
  // drawn would cross it.
  await page.addInitScript(() => {
    localStorage.setItem(
      "epub-reader-settings",
      JSON.stringify({ textAlign: "justify-knuth-plass" }),
    );
  });
  for (const font of ["system", "seravek", "source-sans", "atkinson"]) {
    await page.goto(`/reader/${localBook.id}?font=${font}`);
    await waitForReaderReady(page);
    await turnToText(page);
    expect(await expectTextToFit(page)).toBeGreaterThan(5);
  }
});
