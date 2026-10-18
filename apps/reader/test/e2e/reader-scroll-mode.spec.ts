import type { CDPSession, Page } from "@playwright/test";
import {
  test,
  expect,
  openLocalBook,
  nextSpread,
  currentPages,
  waitForReaderReady,
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
  for (let attempt = 0; attempt < 3 && !(await shown()); attempt++) {
    await page.evaluate(() => getSelection()?.removeAllRanges());
    await page.touchscreen.tap(195, 420);
    await page.waitForTimeout(450);
  }
  await expect.poll(shown).toBe(true);
}

async function openReadingSettings(page: Page) {
  await showChrome(page);
  await page.getByRole("button", { name: "Open reader tools" }).tap();
  await page.getByRole("button", { name: "Themes & settings" }).tap();
}

/** Debug mode's Layout row sits at the top of the reading settings. */
async function chooseLayout(page: Page, layout: "Pages" | "Scroll") {
  await openReadingSettings(page);
  await page
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
  // Positions settle a moment after scrolling stops.
  await page.waitForTimeout(400);
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

/** Selects the start of the first long text run in the reading area. */
async function selectInRows(page: Page, pageIndex: number, length = 24) {
  const text = await page.evaluate(
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
  // The selection change must land before the release that resolves it.
  await expect
    .poll(() => page.evaluate(() => getSelection()?.toString()))
    .toBe(text);
  await page.waitForTimeout(50);
  await page.evaluate(() =>
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true })),
  );
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
  const after = await stageScrollTop(page);
  // The first line that was fully in view is now at the top of the reading
  // area, so the text moves up by less than one line and a paragraph gap.
  expect(after).toBeGreaterThanOrEqual(before);
  expect(after - before).toBeLessThan(48);
  const shift = after - before;
  const linesAfter = await visibleLines(page);
  expect(linesAfter.slice(0, 8).map((line) => line.text)).toEqual(
    linesBefore
      .filter((line) => line.y - shift >= 0)
      .slice(0, 8)
      .map((line) => line.text),
  );
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

test("The selection chip moves a selection at a page break into scroll mode", async ({
  page,
  localBook,
}) => {
  await openLocalBook(page, localBook.id);
  for (let index = 0; index < 6; index++) await nextSpread(page);
  const [pageNumber] = await currentPages(page);

  // Select the end of the page's last line.
  const selected = await page.evaluate((spread) => {
    const slices = document.querySelectorAll(
      `${spread} [data-reader-slice-type="text"]`,
    );
    const walker = document.createTreeWalker(
      slices[slices.length - 1]!,
      NodeFilter.SHOW_TEXT,
    );
    let last: Text | null = null;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.textContent?.trim()) last = node as Text;
    }
    const range = document.createRange();
    range.setStart(last!, Math.max(0, last!.length - 12));
    range.setEnd(last!, last!.length);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
    return range.toString();
  }, CURRENT_SPREAD);
  const chip = page.locator("[data-reader-selection-scroll-chip]");
  await expect(chip).toHaveText("Select across pages in Scroll");
  await chip.tap();

  await expect(page.locator(SETTLED_STAGE)).toHaveCount(1);
  await expect
    .poll(() => page.evaluate(() => getSelection()?.toString().trim()))
    .toBe(selected.trim());

  // Extend the same selection into the next page's first line.
  const extended = await page.evaluate((stage) => {
    const selection = getSelection()!;
    const row = selection.focusNode!.parentElement!.closest(
      "[data-scroll-row-index]",
    )!;
    const next = Number(row.getAttribute("data-page-index")) + 1;
    const slice = document.querySelector(
      `${stage} [data-page-index="${next}"] [data-reader-slice-type="text"]`,
    )!;
    const walker = document.createTreeWalker(slice, NodeFilter.SHOW_TEXT);
    const node = walker.nextNode() as Text;
    selection.extend(node, Math.min(node.length, 10));
    return selection.toString();
  }, SCROLL_STAGE);
  expect(normalized(extended).length).toBeGreaterThan(
    normalized(selected).length,
  );
  await page.evaluate(() =>
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true })),
  );
  await page.getByRole("button", { name: "Highlight with yellow" }).tap();
  await expect
    .poll(async () => (await savedHighlights(page, localBook.id)).length)
    .toBe(1);
  const [highlight] = await savedHighlights(page, localBook.id);
  expect(normalized(highlight!.selectedText)).toBe(normalized(extended));

  // Back on pages, the highlight runs from that page onto the next.
  await chooseLayout(page, "Pages");
  await expect(page.locator(SCROLL_STAGE)).toHaveCount(0);
  await waitForReaderReady(page);
  const marks = page.locator(
    `${CURRENT_SPREAD} mark[data-highlight-id="${highlight!.id}"]`,
  );
  if ((await currentPages(page))[0] !== pageNumber) {
    await page.keyboard.press("ArrowLeft");
    await expect.poll(() => currentPages(page)).toEqual([pageNumber]);
    await waitForReaderReady(page);
  }
  await expect(marks.first()).toBeVisible();
  await nextSpread(page);
  await expect(marks.first()).toBeVisible();
});

test("A pull from pages enters scroll mode only past the threshold", async ({
  page,
  localBook,
}) => {
  await openLocalBook(page, localBook.id);
  for (let index = 0; index < 4; index++) await nextSpread(page);
  const [pageNumber] = await currentPages(page);
  const cdp = await page.context().newCDPSession(page);
  // Pages keep the chapter's column ready in the background.
  await page.waitForTimeout(800);
  const pill = page.locator("[data-reader-pull-pill]");

  // A short pull: the peek, then a little text, then back to the page.
  await touchDrag(cdp, { x: 195, y: 700 }, { x: 195, y: 520 }, 12);
  await expect(page.locator(SCROLL_STAGE)).toHaveCount(0);
  await waitForReaderReady(page);
  expect(await currentPages(page)).toEqual([pageNumber]);

  // A long pull arms the pill; release enters scroll mode where the text is.
  await touchDrag(cdp, { x: 195, y: 780 }, { x: 195, y: 300 }, 36, false);
  await expect(pill).toHaveAttribute("data-reader-pull-pill", "armed");
  await expect(pill).toHaveText("Release to scroll");
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(page.locator(SETTLED_STAGE)).toHaveCount(1);
  await expect(pill).toHaveCount(0);
  const page0 = await page
    .locator(SCROLL_STAGE)
    .evaluate((element) =>
      Number(
        element.querySelector<HTMLElement>("[data-reader-page-tick]")?.dataset
          .readerPageStart ?? 0,
      ),
    );
  expect(page0).toBeGreaterThan(0);
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

  await openReadingSettings(page);
  await page.getByRole("tab", { name: "Type" }).tap();
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
