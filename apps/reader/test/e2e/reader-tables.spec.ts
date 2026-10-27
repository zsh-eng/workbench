import type { Page } from "@playwright/test";
import { epubVariant } from "./helpers/epub-variants";
import {
  currentPages,
  expect,
  nextSpread,
  openReaderTool,
  test,
  waitForReaderReady,
  waitForSheetToRest,
} from "./helpers/fixtures";
import {
  importAndOpenEpub,
  openContentsEntry,
  showPhoneChrome,
} from "./helpers/reader-books";
import { syntheticTable } from "./helpers/synthetic-tables";

// Debug → Tables (docs/0005-tables.md): a chapter's tables as grids that
// break at rows, on a phone.
test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});

const CHAPTER_ONE = "OEBPS/4269428405154643194_11-h-1.htm.xhtml";
const CURRENT_SPREAD = '[data-reader-spread-layer="current"]';
const TABLE = `${CURRENT_SPREAD} [data-reader-slice-type="table"]`;
const TITLE = "Table Specimens";

/** Eight columns of long unbreakable words: wider than any phone's page. */
function wideTable(): string {
  const row = (cell: (column: number) => string) =>
    `<tr>${Array.from({ length: 8 }, (_, column) => cell(column)).join("")}</tr>`;
  return `<table><thead>${row((column) => `<th>field_${column}</th>`)}</thead><tbody>${[
    0, 1, 2,
  ]
    .map((line) =>
      row((column) => `<td>Counteridentifier${line}${column}</td>`),
    )
    .join("")}</tbody></table>`;
}

/**
 * One-row tables of four one-word columns, each word a narrow letter longer
 * than the last: from tables that fit to tables that must scroll, with some
 * that miss the page by less than their padding.
 */
function nearMissTables(): string {
  return Array.from(
    { length: 17 },
    (_, index) =>
      `<p>Width ${index}.</p><table><tr>${`<td>mmmm${"i".repeat(index)}</td>`.repeat(4)}</tr></table>`,
  ).join("");
}

/**
 * The sample book with `tables` opening chapter one: by default a 49-row
 * table and a wide one.
 */
function tableBook(
  name: string,
  tables = `<p>A tall table follows.</p>${syntheticTable(6)}<p>And a wide one.</p>${wideTable()}`,
) {
  return epubVariant({
    name,
    title: TITLE,
    author: "Test Author",
    documents: {
      [CHAPTER_ONE]: (xhtml) =>
        xhtml.replace("</h2>", `</h2>${tables}<p>After the tables.</p>`),
    },
  });
}

/** Starts with tables as `mode`; a choice made in the Reader then stays. */
async function useTables(page: Page, mode: "grid" | "flat") {
  await page.addInitScript((value) => {
    if (localStorage.getItem("reader-tables-v1") === null)
      localStorage.setItem("reader-tables-v1", value);
  }, mode);
}

async function openTableChapter(page: Page, name: string, tables?: string) {
  await importAndOpenEpub(page, tableBook(name, tables), TITLE);
  await openContentsEntry(page, /CHAPTER I\./);
}

/** Turns forward until the current spread shows a table, and returns it. */
async function turnToTable(page: Page) {
  for (
    let turn = 0;
    turn < 6 && (await page.locator(TABLE).count()) === 0;
    turn++
  )
    await nextSpread(page);
  await expect(page.locator(TABLE).first()).toBeVisible();
}

/** Every table slice on the current spread draws the size the worker planned. */
async function expectTablesToFit(page: Page) {
  const mismatches = await page.locator(TABLE).evaluateAll((slices) =>
    slices.flatMap((slice) => {
      const expected = Number(
        slice.getAttribute("data-reader-expected-height"),
      );
      const table = slice.querySelector("table")!;
      const cells = [
        ...slice.querySelectorAll<HTMLElement>(".reader-table-cell-text"),
      ];
      // A line the browser measures wider than the worker did overflows
      // its column, and a cell clips it.
      const clipped = cells.filter(
        (cell) =>
          cell.scrollHeight > cell.clientHeight + 1 ||
          cell.scrollWidth > cell.clientWidth + 1,
      );
      return Math.abs(table.offsetHeight - expected) > 1 || clipped.length > 0
        ? [{ expected, actual: table.offsetHeight, clipped: clipped.length }]
        : [];
    }),
  );
  expect(mismatches).toEqual([]);
}

test("a tall table breaks at rows under its repeated header", async ({
  page,
}) => {
  await useTables(page, "grid");
  await openTableChapter(page, "tables-grid");
  await turnToTable(page);

  const header = page.locator(`${TABLE} thead th`);
  await expect(header.first()).toHaveText("Name");
  await expect(header).toHaveCount(4);

  // Body rows 1–48 show once each, in order, over several pages.
  const shown: number[] = [];
  let continuations = 0;
  for (let turn = 0; turn < 40; turn++) {
    const table = page.locator(TABLE).first();
    if ((await table.count()) === 0) break;
    await expectTablesToFit(page);
    const rows = await table
      // A row split over a page break counts where it starts.
      .locator(
        "tbody tr[data-reader-table-row]:not([data-reader-table-continued])",
      )
      .evaluateAll((elements) =>
        elements.map((row) =>
          Number(row.getAttribute("data-reader-table-row")),
        ),
      );
    shown.push(...rows);
    if (shown.length > rows.length) {
      continuations++;
      // A continuation repeats the header, without anchors of its own.
      const repeated = table.locator("thead tr[data-reader-table-repeated]");
      await expect(repeated).toHaveCount(1);
      await expect(
        repeated.locator("[data-content-anchor-block-id]"),
      ).toHaveCount(0);
    }
    if (shown.at(-1) === 48) break;
    await nextSpread(page);
  }
  expect(continuations).toBeGreaterThan(0);
  expect(shown).toEqual(Array.from({ length: 48 }, (_, index) => index + 1));
});

test("a table too wide for the page scrolls on its own", async ({ page }) => {
  await useTables(page, "grid");
  await openTableChapter(page, "tables-wide");
  const wide = page.locator(`${TABLE}[data-reader-table-scroll]`);
  // It follows the 48-row table.
  for (let turn = 0; turn < 30 && (await wide.count()) === 0; turn++)
    await nextSpread(page);
  await expect(wide).toBeVisible();
  await expectTablesToFit(page);

  const pages = await currentPages(page);
  const overflow = await wide.evaluate(
    (element) => element.scrollWidth - element.clientWidth,
  );
  expect(overflow).toBeGreaterThan(100);
  // A sideways swipe that starts in the table scrolls it.
  const box = (await wide.boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.synthesizeScrollGesture", {
    x: box.x + box.width - 40,
    y: box.y + box.height / 2,
    xDistance: -200,
    gestureSourceType: "touch",
    speed: 800,
  });
  await cdp.detach();
  await expect
    .poll(() => wide.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(50);
  // The page itself does not scroll, and the swipe did not turn it.
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await waitForReaderReady(page);
  expect(await currentPages(page)).toEqual(pages);
});

test("a table that misses the page by a little narrows its padding to fit", async ({
  page,
}) => {
  await useTables(page, "grid");
  await openTableChapter(page, "tables-near-miss", nearMissTables());

  // Each table by the length of its word: whether it scrolls, its cell
  // padding, and whether it fits its page.
  const seen = new Map<
    number,
    { scroll: boolean; padding: number; fits: boolean }
  >();
  for (let turn = 0; turn < 12 && seen.size < 17; turn++) {
    await expectTablesToFit(page);
    const tables = await page.locator(TABLE).evaluateAll((slices) =>
      slices.map((slice) => {
        const cell = slice.querySelector("td")!;
        return {
          length: cell.textContent!.trim().length,
          scroll: slice.hasAttribute("data-reader-table-scroll"),
          padding: parseFloat(getComputedStyle(cell).paddingLeft),
          fits:
            slice.querySelector("table")!.offsetWidth <= slice.clientWidth,
        };
      }),
    );
    for (const { length, ...table } of tables) seen.set(length, table);
    if (seen.size < 17) await nextSpread(page);
  }
  const tables = [...seen.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, table]) => table);
  expect(tables).toHaveLength(17);
  const full = tables[0]!.padding;
  expect(tables[0]!.scroll).toBe(false);
  expect(tables.at(-1)!.scroll).toBe(true);
  // Some miss by a little and fit with less padding; the rest keep it.
  expect(tables.some((table) => !table.scroll && table.padding < full)).toBe(
    true,
  );
  for (const table of tables) {
    if (table.scroll) expect(table.padding).toBe(full);
    else expect(table.fits).toBe(true);
  }
});

test("a highlight in a cell stays after the book reopens", async ({ page }) => {
  await useTables(page, "grid");
  await openTableChapter(page, "tables-highlight");
  await turnToTable(page);

  // Select the second body row's last cell, as the native handles would.
  const cell = page
    .locator(
      `${TABLE} tbody tr[data-reader-table-row="2"] .reader-table-cell-text`,
    )
    .last();
  const text = (await cell.textContent())!.trim();
  await cell.evaluate((element) => {
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

  const marked = page.locator(
    `${TABLE} .reader-table-cell-text mark[data-highlight-id]`,
  );
  await expect(marked.first()).toBeVisible();
  const markedText = async () =>
    (await marked.allTextContents()).join("").replace(/\s+/g, " ").trim();
  expect(await markedText()).toBe(text.replace(/\s+/g, " "));

  await page.reload();
  await waitForReaderReady(page);
  await expect(marked.first()).toBeVisible();
  expect(await markedText()).toBe(text.replace(/\s+/g, " "));
});

test("scroll mode shows a table as a grid", async ({ page }) => {
  await useTables(page, "grid");
  await openTableChapter(page, "tables-scroll");
  await page.evaluate(() =>
    localStorage.setItem("reader-reading-mode-v1", "scroll"),
  );
  await page.reload();
  const stage = page.locator('[data-reader-scroll-stage="settled"]');
  await expect(stage).toHaveCount(1);
  const table = page.locator(
    '[data-reader-scroll-stage] [data-reader-slice-type="table"]',
  );
  for (let step = 0; step < 20 && (await table.count()) === 0; step++)
    await page
      .locator("[data-reader-scroll-stage]")
      .evaluate((element) => element.scrollBy({ top: element.clientHeight }));
  await expect(table.first()).toBeAttached();
  await table.first().scrollIntoViewIfNeeded();
  await expect(table.first().locator("thead th").first()).toHaveText("Name");
});

test("with tables off, a table reads as one paragraph until Grid is chosen", async ({
  page,
}) => {
  await useTables(page, "flat");
  await openTableChapter(page, "tables-flat");
  const caption = page
    .locator(`${CURRENT_SPREAD} [data-reader-block-id]`)
    .filter({ hasText: "Table 7" })
    .first();
  for (let turn = 0; turn < 6 && (await caption.count()) === 0; turn++)
    await nextSpread(page);
  await expect(caption).toBeVisible();
  await expect(page.locator(TABLE)).toHaveCount(0);
  // The table's text follows as one block that starts with its header.
  const flattened = page
    .locator(`${CURRENT_SPREAD} [data-reader-block-id]`)
    .filter({ hasText: /^\s*Name\b/ })
    .first();
  if ((await flattened.count()) === 0) await nextSpread(page);
  await expect(flattened).toBeVisible();
  // More than one cell's text: the whole table, not its first cell.
  expect((await flattened.textContent())!.length).toBeGreaterThan(100);

  // Appearance → Layout → Tables opens the Reader again with grids.
  await showPhoneChrome(page);
  const settings = await openReaderTool(page, "Appearance", "Appearance");
  await settings.getByRole("tab", { name: "Layout", exact: true }).tap();
  await waitForSheetToRest(settings);
  await Promise.all([
    page.waitForEvent("load"),
    settings.getByRole("button", { name: "Grid", exact: true }).tap(),
  ]);
  await waitForReaderReady(page);
  await turnToTable(page);
  await expect(page.locator(`${TABLE} thead th`).first()).toHaveText("Name");
});
