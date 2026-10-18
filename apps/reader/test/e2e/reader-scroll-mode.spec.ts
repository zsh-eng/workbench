import {
  test,
  expect,
  openLocalBook,
  nextSpread,
  currentPages,
} from "./helpers/fixtures";

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});

const SCROLL_STAGE = "[data-reader-scroll-stage]";

/** Shows the phone chrome, which carries the Debug-mode Pages/Scroll switch. */
async function showChrome(page: import("@playwright/test").Page) {
  const modeSwitch = page.getByRole("radiogroup", {
    name: "Reading mode (Debug)",
  });
  // Hidden chrome is translated above the viewport, not removed.
  const top = () =>
    modeSwitch.evaluate((element) => element.getBoundingClientRect().top);
  if ((await top()) < 0) await page.touchscreen.tap(195, 420);
  await expect.poll(top).toBeGreaterThan(0);
}

test("Scroll mode saves paged highlight offsets and snaps back to the passage's page", async ({
  page,
  localBook,
}) => {
  await openLocalBook(page, localBook.id);
  for (let index = 0; index < 8; index++) await nextSpread(page);

  await showChrome(page);
  await page.getByRole("radio", { name: "Scroll" }).tap();
  const stage = page.locator(SCROLL_STAGE);
  await expect(stage).toHaveAttribute("data-reader-scroll-stage", "settled");

  // Scroll to the middle of the next page. Page ticks carry each page's
  // column offset and its book page number.
  const target = await stage.evaluate((element) => {
    const tick = [
      ...element.querySelectorAll<HTMLElement>("[data-reader-page-tick]"),
    ].find(
      (candidate) =>
        Number(candidate.dataset.readerPageStart) > element.scrollTop,
    )!;
    const scrollTop = Math.round(Number(tick.dataset.readerPageStart) + 300);
    element.scrollTo({ top: scrollTop });
    return {
      pageIndex: tick.dataset.readerPageTick!,
      pageNumber: tick.textContent!.trim(),
      scrollTop,
    };
  });
  await expect
    .poll(() => stage.evaluate((element) => element.scrollTop))
    .toBe(target.scrollTop);

  // Select the first long text run in the reading area of that page.
  const selectedText = await page.evaluate(
    ({ selector, pageIndex }) => {
      const rows = document.querySelectorAll(
        `${selector} [data-page-index="${pageIndex}"]`,
      );
      for (const row of rows) {
        const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const range = document.createRange();
          range.selectNodeContents(node);
          if ((node.textContent?.trim().length ?? 0) < 24) continue;
          if (range.getBoundingClientRect().top < 140) continue;
          range.setStart(node, 0);
          range.setEnd(node, 24);
          getSelection()!.removeAllRanges();
          getSelection()!.addRange(range);
          return range.toString();
        }
      }
      throw new Error("No passage in the reading area");
    },
    { selector: SCROLL_STAGE, pageIndex: target.pageIndex },
  );
  // The selection change must land before the release that resolves it.
  await expect
    .poll(() => page.evaluate(() => getSelection()?.toString()))
    .toBe(selectedText);
  await page.waitForTimeout(50);
  await page.evaluate(() =>
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true })),
  );
  await page.getByRole("button", { name: "Highlight with yellow" }).tap();

  const savedHighlights = () =>
    page.evaluate(async (bookId) => {
      const path = "/src/lib/db.ts";
      return (await import(path)).getBookHighlights(bookId);
    }, localBook.id);
  await expect
    .poll(async () =>
      (await savedHighlights()).map(
        (highlight: { selectedText: string }) => highlight.selectedText,
      ),
    )
    .toEqual([selectedText]);
  const [highlight] = await savedHighlights();
  // The column is redecorated from the stored offsets, as pages are.
  await expect(
    stage.locator(`mark[data-highlight-id="${highlight.id}"]`).first(),
  ).toBeVisible();

  await showChrome(page);
  await page.getByRole("radio", { name: "Pages" }).tap();
  await expect(stage).toHaveCount(0);
  expect(await currentPages(page)).toEqual([target.pageNumber]);

  // Pages place highlights from the stored canonical offsets, so the marked
  // text proves that scroll mode saved the same offsets as paged mode.
  const marks = page.locator(
    `[data-reader-spread-layer="current"] mark[data-highlight-id="${highlight.id}"]`,
  );
  await expect(marks.first()).toBeVisible();
  expect(
    (await marks.allTextContents()).join("").replace(/\s+/g, " ").trim(),
  ).toBe(selectedText.replace(/\s+/g, " ").trim());
});
