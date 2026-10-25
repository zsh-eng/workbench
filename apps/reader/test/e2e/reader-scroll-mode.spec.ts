import type { CDPSession, Page } from "@playwright/test";
import {
  test,
  expect,
  openLocalBook,
  nextSpread,
  currentPages,
  openReaderTool,
  waitForReaderReady,
  waitForSheetToRest,
} from "./helpers/fixtures";

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});

const SCROLL_STAGE = "[data-reader-scroll-stage]";
const SETTLED_STAGE = '[data-reader-scroll-stage="settled"]';
const CURRENT_SPREAD = '[data-reader-spread-layer="current"]';

async function showChrome(page: Page) {
  const tools = page.getByRole("button", { name: "Open reader tools" });
  // Hidden chrome is translated above the viewport, not removed. A tap first
  // closes a highlight's tools, if they are open.
  const shown = async () =>
    (await tools.count()) > 0 &&
    (await tools.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return rect.top > 0 && rect.height > 0;
    }));
  // A tap toggles the chrome; wait for each one to land before another.
  for (let attempt = 0; attempt < 4 && !(await shown()); attempt++) {
    await page.evaluate(() => getSelection()?.removeAllRanges());
    await page.touchscreen.tap(195, 420);
    await expect
      .poll(shown, { timeout: 1500 })
      .toBe(true)
      .catch(() => {});
  }
  await expect.poll(shown).toBe(true);
}

/** Opens Appearance and returns its sheet once it has come in. */
async function openReadingSettings(page: Page) {
  await showChrome(page);
  return openReaderTool(page, "Appearance", "Appearance");
}

/** The Reading view row, Pages or Scroll, leads Appearance's Layout tab. */
async function chooseLayout(page: Page, layout: "Pages" | "Scroll") {
  const settings = await openReadingSettings(page);
  await settings.getByRole("tab", { name: "Layout", exact: true }).tap();
  // The sheet grows to fit the tab on its spring; tap once it rests.
  await waitForSheetToRest(settings);
  await settings
    .locator("[data-reading-layout-row]")
    .getByRole("button", { name: layout, exact: true })
    .tap();
  // The sheet closes as the layout changes behind it.
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

async function enterScroll(page: Page) {
  await chooseLayout(page, "Scroll");
  await expect(page.locator(SETTLED_STAGE)).toHaveCount(1);
}

const stageScrollTop = (page: Page) =>
  page
    .locator(SCROLL_STAGE)
    .evaluate((element) => Math.round(element.scrollTop));

async function scrollStageTo(page: Page, scrollTop: number) {
  await page
    .locator(SCROLL_STAGE)
    .evaluate((element, top) => element.scrollTo({ top }), scrollTop);
  await expect.poll(() => stageScrollTop(page)).toBe(scrollTop);
}

/**
 * Sets a selection and waits for the page to hear the change, then
 * releases the pointer, which is when the Reader reads a selection.
 */
async function selectAndRelease(page: Page, select: () => Promise<void>) {
  const heard = page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        document.addEventListener("selectionchange", () => resolve(), {
          once: true,
        }),
      ),
  );
  await select();
  await heard;
  await page.evaluate(() =>
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true })),
  );
}

/** Text lines in view, with their tops relative to the stage. */
const visibleLines = (page: Page) =>
  page.locator(SCROLL_STAGE).evaluate((stage) => {
    const top = stage.getBoundingClientRect().top;
    const lines = new Map<number, string>();
    // A line's fragments share its top; a highlight splits a fragment.
    for (const fragment of stage.querySelectorAll(
      "[data-content-anchor-start]",
    )) {
      const y = Math.round(fragment.getBoundingClientRect().top - top);
      if (y < 0 || y >= 844) continue;
      lines.set(y, (lines.get(y) ?? "") + (fragment.textContent ?? ""));
    }
    return [...lines]
      .filter(([, text]) => text.trim())
      .sort(([a], [b]) => a - b)
      .map(([y, text]) => ({ y, text }));
  });

const savedHighlights = (page: Page, bookId: string) =>
  page.evaluate(async (id) => {
    const path = "/src/lib/db.ts";
    return (await import(path)).getBookHighlights(id) as Promise<
      { id: string; selectedText: string }[]
    >;
  }, bookId);

const normalized = (text: string) => text.replace(/\s+/g, " ").trim();
/** Text without its whitespace, which a line break can add or take away. */
const letters = (text: string) => text.replace(/\s+/g, "");

/** Selects the start of the first long text run in the reading area. */
async function selectInRows(page: Page, pageIndex: number, length = 24) {
  let text = "";
  await selectAndRelease(page, async () => {
    text = await page.evaluate(
      ({ selector, pageIndex, length }) => {
        const rows = document.querySelectorAll(
          `${selector} [data-page-index="${pageIndex}"]`,
        );
        for (const row of rows) {
          const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const range = document.createRange();
            range.selectNodeContents(node);
            if ((node.textContent?.trim().length ?? 0) < length) continue;
            const rect = range.getBoundingClientRect();
            if (rect.top < 140 || rect.bottom > 640) continue;
            range.setStart(node, 0);
            range.setEnd(node, length);
            getSelection()!.removeAllRanges();
            getSelection()!.addRange(range);
            return range.toString();
          }
        }
        throw new Error("No passage in the reading area");
      },
      { selector: SCROLL_STAGE, pageIndex, length },
    );
  });
  return text;
}

/**
 * A page boundary with `room` pixels of scrolling after it, preferring the
 * next one below the view's top. Page ticks carry each page's column offset
 * and its book page number.
 */
const pageWithRoom = (page: Page, room = 280) =>
  page.locator(SCROLL_STAGE).evaluate((element, room) => {
    const maxScroll = element.scrollHeight - element.clientHeight;
    const ticks = [
      ...element.querySelectorAll<HTMLElement>("[data-reader-page-tick]"),
    ]
      .map((tick) => ({
        pageIndex: Number(tick.dataset.readerPageTick),
        pageNumber: tick.textContent!.trim(),
        pageStart: Math.round(Number(tick.dataset.readerPageStart)),
      }))
      .filter((tick) => tick.pageStart + room <= maxScroll);
    const tick =
      ticks.find((candidate) => candidate.pageStart > element.scrollTop) ??
      ticks.at(-1);
    if (!tick) throw new Error("No page with room to scroll");
    return tick;
  }, room);

async function touchDrag(
  cdp: CDPSession,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps: number,
  release = true,
) {
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ ...from, id: 1 }],
  });
  for (let step = 1; step <= steps; step++) {
    const t = step / steps;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        {
          x: from.x + (to.x - from.x) * t,
          y: from.y + (to.y - from.y) * t,
          id: 1,
        },
      ],
    });
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
  if (release) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  }
}

test("Scroll mode saves paged highlight offsets and snaps back to the passage's page", async ({
  page,
  localBook,
}) => {
  await openLocalBook(page, localBook.id);
  for (let index = 0; index < 8; index++) await nextSpread(page);
  await enterScroll(page);

  const target = await pageWithRoom(page);
  await scrollStageTo(page, target.pageStart + 120);
  const selectedText = await selectInRows(page, target.pageIndex);
  await page.getByRole("button", { name: "Highlight with yellow" }).tap();

  await expect
    .poll(async () =>
      (await savedHighlights(page, localBook.id)).map(
        (highlight) => highlight.selectedText,
      ),
    )
    .toEqual([selectedText]);
  const [highlight] = await savedHighlights(page, localBook.id);
  // The column is redecorated from the stored offsets, as pages are.
  await expect(
    page
      .locator(`${SCROLL_STAGE} mark[data-highlight-id="${highlight!.id}"]`)
      .first(),
  ).toBeVisible();

  await chooseLayout(page, "Pages");
  await expect(page.locator(SCROLL_STAGE)).toHaveCount(0);
  expect(await currentPages(page)).toEqual([target.pageNumber]);
  expect(
    await page.evaluate(() => localStorage.getItem("reader-reading-mode-v1")),
  ).toBe("pages");

  // Pages place highlights from the stored canonical offsets, so the marked
  // text proves that scroll mode saved the same offsets as paged mode.
  const marks = page.locator(
    `${CURRENT_SPREAD} mark[data-highlight-id="${highlight!.id}"]`,
  );
  await expect(marks.first()).toBeVisible();
  expect(normalized((await marks.allTextContents()).join(""))).toBe(
    normalized(selectedText),
  );
});

test("Reopening a book read in scroll mode restores scroll mode at the same line", async ({
  page,
  localBook,
}) => {
  await openLocalBook(page, localBook.id);
  for (let index = 0; index < 4; index++) await nextSpread(page);
  await enterScroll(page);

  const target = await pageWithRoom(page);
  // Partway into a line: the line below it is the first fully in view.
  await scrollStageTo(page, target.pageStart + 131);
  const before = await stageScrollTop(page);
  const linesBefore = await visibleLines(page);

  // Progress is saved for the page that holds the reading line, a third of
  // the way down, as a chapter percentage like a page turn saves it.
  const expectedProgress = await page
    .locator(SCROLL_STAGE)
    .evaluate((element) => {
      const ticks = [
        ...element.querySelectorAll<HTMLElement>("[data-reader-page-tick]"),
      ];
      const first = ticks[0]!;
      const paddingTop =
        parseFloat(first.style.top) +
        13 -
        Number(first.dataset.readerPageStart);
      const readingLine =
        element.scrollTop - paddingTop + element.clientHeight / 3;
      let pageIndex = 0;
      for (const tick of ticks) {
        if (Number(tick.dataset.readerPageStart) <= readingLine) {
          pageIndex = Number(tick.dataset.readerPageTick);
        }
      }
      return (pageIndex / ticks.length) * 100;
    });
  await expect
    .poll(() =>
      page.evaluate(async (bookId) => {
        const path = "/src/lib/db.ts";
        const db = await import(path);
        return (await db.getCurrentDeviceReadingCheckpoint(bookId))
          ?.scrollProgress;
      }, localBook.id),
    )
    .toBeCloseTo(expectedProgress, 3);

  await page.reload();
  // The page stays hidden: the book reopens straight into the column.
  await expect(page.locator(SETTLED_STAGE)).toHaveCount(1);
  // The first line that was fully in view is now at the top of the reading
  // area: the same lines follow, shifted up together.
  await expect
    .poll(async () => {
      const shift = (await stageScrollTop(page)) - before;
      const linesAfter = await visibleLines(page);
      const expected = linesBefore
        .filter((line) => line.y - shift >= 0)
        .slice(0, 8)
        .map((line) => line.text);
      return linesAfter
        .slice(0, 8)
        .every((line, index) => line.text === expected[index]);
    })
    .toBe(true);
});

test("A highlight made, opened and deleted in scroll mode never moves the text", async ({
  page,
  localBook,
}) => {
  await openLocalBook(page, localBook.id);
  for (let index = 0; index < 6; index++) await nextSpread(page);
  await enterScroll(page);

  const target = await pageWithRoom(page);
  await scrollStageTo(page, target.pageStart + 160);
  const stage = page.locator(SCROLL_STAGE);
  const before = await stageScrollTop(page);
  const linesBefore = await visibleLines(page);

  await selectInRows(page, target.pageIndex);
  await page.getByRole("button", { name: "Highlight with yellow" }).tap();
  await expect
    .poll(async () => (await savedHighlights(page, localBook.id)).length)
    .toBe(1);
  const [highlight] = await savedHighlights(page, localBook.id);
  const mark = stage
    .locator(`mark[data-highlight-id="${highlight!.id}"]`)
    .first();
  await expect(mark).toBeVisible();
  expect(await stageScrollTop(page)).toBe(before);
  expect(await visibleLines(page)).toEqual(linesBefore);

  // Tapping the highlight opens its tools in place.
  await page.evaluate(() => getSelection()?.removeAllRanges());
  const box = (await mark.boundingBox())!;
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByRole("button", { name: "Highlight with green" }).tap();
  await expect(mark).toHaveAttribute("data-color", "green");
  expect(await stageScrollTop(page)).toBe(before);

  await page.getByRole("button", { name: "Remove highlight" }).tap();
  await expect(stage.locator("mark[data-highlight-id]")).toHaveCount(0);
  expect(await stageScrollTop(page)).toBe(before);
  expect(await visibleLines(page)).toEqual(linesBefore);
});

/**
 * Selects a few words at the start of the page's first line or the end of
 * its last (on a spread, the given page's), then releases.
 */
async function selectAtPageEdge(page: Page, edge: "first" | "last", slot = 0) {
  let selected = "";
  await selectAndRelease(page, async () => {
    selected = await page.evaluate(
      ({ spread, edge, slot }) => {
        const slices = document.querySelectorAll(
          `${spread} [data-reader-page-slot="${slot}"] [data-reader-slice-type="text"]`,
        );
        const slice = slices[edge === "first" ? 0 : slices.length - 1]!;
        const walker = document.createTreeWalker(slice, NodeFilter.SHOW_TEXT);
        const nodes: Text[] = [];
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (node.textContent?.trim()) nodes.push(node as Text);
        }
        const node = nodes[edge === "first" ? 0 : nodes.length - 1]!;
        const range = document.createRange();
        if (edge === "first") {
          range.setStart(node, 0);
          range.setEnd(node, Math.min(node.length, 12));
        } else {
          range.setStart(node, Math.max(0, node.length - 12));
          range.setEnd(node, node.length);
        }
        getSelection()!.removeAllRanges();
        getSelection()!.addRange(range);
        return range.toString();
      },
      { spread: CURRENT_SPREAD, edge, slot },
    );
  });
  return selected;
}

/** Selects a few words in the middle of the page, clear of its edges. */
async function selectInPage(page: Page) {
  await selectAndRelease(page, () =>
    page.evaluate((spread) => {
      const slices = [
        ...document.querySelectorAll(
          `${spread} [data-reader-slice-type="text"]`,
        ),
      ];
      const top = slices[0]!.getBoundingClientRect().bottom + 40;
      const bottom = slices.at(-1)!.getBoundingClientRect().top - 40;
      for (const slice of slices) {
        const walker = document.createTreeWalker(slice, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if ((node.textContent?.length ?? 0) < 12) continue;
          const range = document.createRange();
          range.setStart(node, 0);
          range.setEnd(node, 12);
          const rects = [...range.getClientRects()];
          if (rects.some((rect) => rect.top < top || rect.bottom > bottom))
            continue;
          getSelection()!.removeAllRanges();
          getSelection()!.addRange(range);
          return;
        }
      }
      throw new Error("No passage clear of the page's edges");
    }, CURRENT_SPREAD),
  );
}

async function clearSelection(page: Page) {
  await page.evaluate(() => {
    getSelection()!.removeAllRanges();
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
}

const SPILL_TAB = "[data-reader-spill-tab]";

/** A reader without Debug mode: Scroll is offered; the pull is not. */
const withoutDebugMode = (page: Page) =>
  page.addInitScript(() =>
    localStorage.setItem("reader-debug-enabled-v1", "false"),
  );
const ISLAND_TOOLS = '[data-notes-island="tools"]';

type Box = { top: number; bottom: number; left: number; right: number };
const overlaps = (a: Box, b: Box) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/** Boxes of the selection, the spill tab and the highlight tools. */
const selectionLayout = (page: Page, tools: string) =>
  page.evaluate(
    ({ tab, tools }) => {
      const box = (rect: DOMRect) => ({
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
      });
      const range = getSelection()!.getRangeAt(0);
      return {
        selection: [...range.getClientRects()].map(box),
        tab: box(document.querySelector(tab)!.getBoundingClientRect()),
        tools: box(document.querySelector(tools)!.getBoundingClientRect()),
      };
    },
    { tab: SPILL_TAB, tools },
  );

/** Nothing covers anything else: the selection, the tab, the tools. */
const clearOfEachOther = async (page: Page, tools: string) => {
  const layout = await selectionLayout(page, tools);
  return (
    !overlaps(layout.tab, layout.tools) &&
    !layout.selection.some(
      (rect) => overlaps(rect, layout.tab) || overlaps(rect, layout.tools),
    )
  );
};

test("A selection cut by a page break offers the rest of the sentence, clear of the highlight tools", async ({
  page,
  localBook,
}) => {
  await openLocalBook(page, localBook.id);
  for (let index = 0; index < 6; index++) await nextSpread(page);

  const tab = page.locator(SPILL_TAB);
  for (const edge of ["last", "first"] as const) {
    // The next page's head continues this page's last sentence.
    if (edge === "first") {
      await clearSelection(page);
      await expect(tab).toHaveCount(0);
      await nextSpread(page);
    }
    await selectAtPageEdge(page, edge);
    await expect(page.locator(ISLAND_TOOLS)).toBeVisible();
    await expect(tab).toBeVisible();
    // It names what it does and quotes the words on the other page.
    await expect(tab).toHaveAccessibleName(
      edge === "last"
        ? /^Continue selection onto page \d+: “.+”$/
        : /^Extend selection back to page \d+: “.+”$/,
    );
    await expect.poll(() => clearOfEachOther(page, ISLAND_TOOLS)).toBe(true);
  }

  // A selection clear of the page's edges does not offer it.
  await selectInPage(page);
  await expect(page.locator(ISLAND_TOOLS)).toBeVisible();
  await expect(tab).toHaveCount(0);
});

test("The spill tab finishes the sentence on the next page, and the highlight returns to pages where it ends", async ({
  page,
  localBook,
}) => {
  // Every reader has it, not only Debug mode.
  await withoutDebugMode(page);
  await openLocalBook(page, localBook.id);
  for (let index = 0; index < 6; index++) await nextSpread(page);
  const [pageNumber] = await currentPages(page);

  const selected = await selectAtPageEdge(page, "last");
  const tab = page.locator(SPILL_TAB);
  await expect(tab).toBeVisible();
  const beyond = (await tab.getAttribute("aria-label"))!.match(/“(.+)”$/)![1]!;
  await tab.tap();

  // The column takes the selection and grows it over the break to the end
  // of the sentence, with the tools back for it.
  await expect(page.locator(SETTLED_STAGE)).toHaveCount(1);
  await expect
    .poll(async () =>
      letters((await page.evaluate(() => getSelection()?.toString())) ?? ""),
    )
    .toBe(letters(selected + beyond));
  await page.getByRole("button", { name: "Highlight with yellow" }).tap();
  await expect
    .poll(async () => (await savedHighlights(page, localBook.id)).length)
    .toBe(1);
  const [highlight] = await savedHighlights(page, localBook.id);
  expect(letters(highlight!.selectedText)).toBe(letters(selected + beyond));

  // Back on pages, at the page where the highlight ends; the reading mode
  // stays Pages.
  await expect(page.locator(SCROLL_STAGE)).toHaveCount(0);
  await expect
    .poll(() => currentPages(page))
    .toEqual([String(Number(pageNumber) + 1)]);
  await expect(
    page
      .locator(`${CURRENT_SPREAD} mark[data-highlight-id="${highlight!.id}"]`)
      .first(),
  ).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem("reader-reading-mode-v1")),
  ).not.toBe("scroll");
});

test("Without Debug mode, a visit to the column leaves no Scroll layout behind, a pull stays on the page, and Appearance offers Scroll", async ({
  page,
  localBook,
}) => {
  await withoutDebugMode(page);
  await openLocalBook(page, localBook.id);
  for (let index = 0; index < 6; index++) await nextSpread(page);
  await selectAtPageEdge(page, "last");
  await page.locator(SPILL_TAB).tap();
  await expect(page.locator(SETTLED_STAGE)).toHaveCount(1);

  // Reloading mid-visit reopens the book in pages.
  await page.reload();
  await waitForReaderReady(page);
  await expect(
    page.locator(`${CURRENT_SPREAD} [data-reader-page-content]`).first(),
  ).toBeVisible();
  await expect(page.locator(SCROLL_STAGE)).toHaveCount(0);
  expect(
    await page.evaluate(() => localStorage.getItem("reader-reading-mode-v1")),
  ).not.toBe("scroll");

  // A long pull from pages stays on the page.
  const cdp = await page.context().newCDPSession(page);
  await touchDrag(cdp, { x: 195, y: 780 }, { x: 195, y: 300 }, 36, false);
  await expect(page.locator("[data-reader-pull-pill]")).toHaveCount(0);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(page.locator(SCROLL_STAGE)).toHaveCount(0);

  // Appearance's Layout offers Pages or Scroll, and Scroll reads the
  // chapter as one column.
  await enterScroll(page);
  expect(
    await page.evaluate(() => localStorage.getItem("reader-reading-mode-v1")),
  ).toBe("scroll");
});

test.describe("on a desktop", () => {
  test.use({
    viewport: { width: 1280, height: 800 },
    isMobile: false,
    hasTouch: false,
  });

  /** Pages or Scroll from the Reader tools sidebar. */
  async function chooseDesktopLayout(page: Page, layout: "Pages" | "Scroll") {
    const sidebar = page.locator('aside[aria-label="Reader tools"]');
    if ((await sidebar.getAttribute("aria-hidden")) === "true") {
      const tools = page.getByRole("button", {
        name: "Open reader tools",
        exact: true,
      });
      const bounds = await tools.boundingBox();
      if (!bounds || bounds.y < 0) {
        await page.locator('[data-reader-chrome-rail="top"]').hover();
      }
      await expect(tools).toBeInViewport();
      await tools.click();
    }
    await expect(sidebar).toHaveAttribute("aria-hidden", "false");
    const row = sidebar.locator("[data-reading-layout-row]");
    if (!(await row.isVisible())) {
      await sidebar
        .getByRole("button", { name: "Reading appearance", exact: true })
        .click();
    }
    await row.getByRole("button", { name: layout, exact: true }).click();
  }

  test("Scroll to Pages slides the page into its place in a two-page spread", async ({
    page,
    localBook,
  }) => {
    await openLocalBook(page, localBook.id);
    for (let index = 0; index < 3; index++) await nextSpread(page);
    await chooseDesktopLayout(page, "Scroll");
    await expect(page.locator(SETTLED_STAGE)).toHaveCount(1);
    await scrollStageTo(page, (await stageScrollTop(page)) + 300);

    // Follow the snapping page's first line until the pages take over.
    const lastSeen = page.evaluate(
      () =>
        new Promise<{ anchor: string; left: number; top: number } | null>(
          (resolve) => {
            let last: { anchor: string; left: number; top: number } | null =
              null;
            const sample = () => {
              const stage = document.querySelector<HTMLElement>(
                "[data-reader-scroll-stage]",
              );
              if (!stage) return resolve(last);
              const snapPage = stage.dataset.readerSnapPage;
              const line =
                snapPage === undefined
                  ? null
                  : stage.querySelector(
                      `[data-page-index="${snapPage}"] [data-content-anchor-start]`,
                    );
              if (line) {
                const box = line.getBoundingClientRect();
                last = {
                  anchor: line.getAttribute("data-content-anchor-start") ?? "",
                  left: box.left,
                  top: box.top,
                };
              }
              requestAnimationFrame(sample);
            };
            requestAnimationFrame(sample);
          },
        ),
    );
    await chooseDesktopLayout(page, "Pages");
    const seen = await lastSeen;
    expect(seen).not.toBeNull();

    // The same line on the page sits where the column left it.
    const line = page
      .locator(
        `${CURRENT_SPREAD} [data-content-anchor-start="${seen!.anchor}"]`,
      )
      .first();
    const box = await line.boundingBox();
    expect(box).not.toBeNull();
    expect(Math.abs(box!.x - seen!.left)).toBeLessThan(2);
    expect(Math.abs(box!.y - seen!.top)).toBeLessThan(2);
    // The page went to the spread's first place, beside the next page.
    const slots = page.locator(`${CURRENT_SPREAD} [data-reader-page-slot]`);
    await expect(slots).toHaveCount(2);
  });

  test("Only the spread's outer edges offer the spill tab, clear of the highlight pill", async ({
    page,
    localBook,
  }) => {
    await withoutDebugMode(page);
    await openLocalBook(page, localBook.id);
    for (let index = 0; index < 3; index++) await nextSpread(page);
    // The right page's foot: the next page is not in view.
    await selectAtPageEdge(page, "last", 1);
    await expect(page.locator(SPILL_TAB)).toBeVisible();
    await expect
      .poll(() => clearOfEachOther(page, ".highlight-toolbar"))
      .toBe(true);
    // The left page's foot: the facing page shows the rest.
    await selectAtPageEdge(page, "last", 0);
    await expect(page.locator(".highlight-toolbar")).toBeVisible();
    await expect(page.locator(SPILL_TAB)).toHaveCount(0);
  });
});

test("A pull from pages enters scroll mode only past the threshold", async ({
  page,
  localBook,
}) => {
  await openLocalBook(page, localBook.id);
  for (let index = 0; index < 4; index++) await nextSpread(page);
  const [pageNumber] = await currentPages(page);
  const cdp = await page.context().newCDPSession(page);
  const pill = page.locator("[data-reader-pull-pill]");
  const release = () =>
    cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });

  // A short pull: the peek, then a little text, then back to the page. The
  // pull starts once the chapter's column is ready in the background.
  let pulled = false;
  for (let attempt = 0; attempt < 10 && !pulled; attempt++) {
    await touchDrag(cdp, { x: 195, y: 700 }, { x: 195, y: 520 }, 12, false);
    pulled = await expect(pill)
      .toHaveAttribute("data-reader-pull-pill", "pulling", { timeout: 1000 })
      .then(() => true)
      .catch(() => false);
    await release();
  }
  expect(pulled).toBe(true);
  await expect(pill).toHaveCount(0);
  await expect(page.locator(SCROLL_STAGE)).toHaveCount(0);
  await waitForReaderReady(page);
  expect(await currentPages(page)).toEqual([pageNumber]);

  // A long pull arms the pill; release enters scroll mode where the text is.
  await touchDrag(cdp, { x: 195, y: 780 }, { x: 195, y: 300 }, 36, false);
  await expect(pill).toHaveAttribute("data-reader-pull-pill", "armed");
  await expect(pill).toHaveText("Release to scroll");
  await release();
  await expect(page.locator(SETTLED_STAGE)).toHaveCount(1);
  await expect(pill).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("reader-reading-mode-v1")),
    )
    .toBe("scroll");
});

test("A sideways swipe in scroll mode returns to the page that holds the reading line", async ({
  page,
  localBook,
}) => {
  await openLocalBook(page, localBook.id);
  for (let index = 0; index < 4; index++) await nextSpread(page);
  await enterScroll(page);
  const stage = page.locator(SCROLL_STAGE);
  const target = await pageWithRoom(page);
  const third = await stage.evaluate((element) => element.clientHeight / 3);
  const paddingTop = await stage.evaluate((element, pageIndex) => {
    const tick = element.querySelector<HTMLElement>(
      `[data-reader-page-tick="${pageIndex}"]`,
    )!;
    return (
      parseFloat(tick.style.top) + 13 - Number(tick.dataset.readerPageStart)
    );
  }, target.pageIndex);

  // The next page starts just above the reading line, a third of the way
  // down: that page is the one the swipe returns to.
  const readingLineAt = (scrollTop: number) => scrollTop - paddingTop + third;
  const scrollTop = Math.round(target.pageStart + paddingTop - third + 40);
  expect(readingLineAt(scrollTop)).toBeGreaterThan(target.pageStart);
  await scrollStageTo(page, scrollTop);
  const cdp = await page.context().newCDPSession(page);
  await touchDrag(cdp, { x: 80, y: 420 }, { x: 320, y: 426 }, 8);
  await expect(stage).toHaveCount(0);
  expect(await currentPages(page)).toEqual([target.pageNumber]);
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("reader-reading-mode-v1")),
    )
    .toBe("pages");
});

test("A typography change in scroll mode keeps the reading line in place", async ({
  page,
  localBook,
}) => {
  await openLocalBook(page, localBook.id);
  for (let index = 0; index < 4; index++) await nextSpread(page);
  await enterScroll(page);
  const target = await pageWithRoom(page);
  await scrollStageTo(page, target.pageStart + 150);

  // The line under the reading line, a third of the way down.
  const readingLine = () =>
    page.locator(SCROLL_STAGE).evaluate((stage) => {
      const y = stage.getBoundingClientRect().top + stage.clientHeight / 3;
      const fragments = [
        ...stage.querySelectorAll("[data-content-anchor-start]"),
      ]
        .map((fragment) => ({
          rect: fragment.getBoundingClientRect(),
          text: fragment.textContent ?? "",
        }))
        .filter((fragment) => fragment.text.trim());
      const first = fragments
        .filter((fragment) => fragment.rect.bottom > y)
        .sort((a, b) => a.rect.top - b.rect.top)[0]!;
      const line = fragments.filter(
        (fragment) => Math.abs(fragment.rect.top - first.rect.top) < 2,
      );
      return {
        top: Math.round(first.rect.top),
        text: line.map((fragment) => fragment.text).join(""),
      };
    });
  const before = await readingLine();

  const settings = await openReadingSettings(page);
  await page.getByRole("tab", { name: "Type" }).tap();
  await waitForSheetToRest(settings);
  await page
    .getByRole("button", { name: /increase|larger/i })
    .first()
    .tap();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // The text reflows. The line that holds the reading line's first word stays
  // where that line was.
  const firstWord = before.text.trim().split(/\s+/)[0]!;
  await expect
    .poll(async () => {
      const after = await readingLine();
      return (
        Math.abs(after.top - before.top) <= 8 && after.text.includes(firstWord)
      );
    })
    .toBe(true);
});

/** The text of the search marks drawn in the scroll column. */
const scrollSearchMarks = (
  page: Page,
  name: "reader-search" | "reader-search-active",
) =>
  page.evaluate(
    ({ name, selector }) => {
      const stage = document.querySelector(selector);
      if (!stage) return [];
      return [...(CSS.highlights.get(name) ?? [])]
        .filter((range) =>
          stage.contains((range as Range).commonAncestorContainer),
        )
        .map((range) => range.toString().replace(/\s+/g, ""));
    },
    { name, selector: SCROLL_STAGE },
  );

test("Search marks its matches in the scroll column as rows mount", async ({
  page,
  localBook,
}) => {
  await openLocalBook(page, localBook.id);
  await nextSpread(page);
  await enterScroll(page);

  await showChrome(page);
  const sheet = await openReaderTool(page, /Search book/, "Search book");
  const field = page.getByRole("searchbox", { name: "Search this book" });
  await field.fill("Dinah");
  await expect(page.locator("[data-search-status]")).toHaveAttribute(
    "data-search-status",
    "done",
  );
  // The sheet grows to fit the results.
  await waitForSheetToRest(sheet);
  await page.locator("[data-search-result]").nth(2).tap();
  await expect(page.getByTestId("search-stepper")).toContainText("3 of");
  await expect(page.locator(SETTLED_STAGE)).toHaveCount(1);
  await expect
    .poll(() => scrollSearchMarks(page, "reader-search-active"))
    .toEqual(["Dinah"]);

  // Far rows are unmounted; the marks come back with them.
  const matchTop = await stageScrollTop(page);
  const height = await page
    .locator(SCROLL_STAGE)
    .evaluate((element) => element.scrollHeight);
  await scrollStageTo(page, matchTop > height / 2 ? 0 : height - 844);
  await expect
    .poll(() => scrollSearchMarks(page, "reader-search-active"))
    .toEqual([]);
  await scrollStageTo(page, matchTop);
  await expect
    .poll(() => scrollSearchMarks(page, "reader-search-active"))
    .toEqual(["Dinah"]);
});
