import type { Page } from "@playwright/test";
import {
  expect,
  nextSpread,
  openLocalBook,
  selectPassage,
  test as base,
} from "./helpers/fixtures";

// WebKit keeps no Blob in IndexedDB for a context without a profile, and the
// Reader keeps its books there. Each test gets a new profile instead.
const test = base.extend({
  context: async (
    {
      playwright,
      browserName,
      viewport,
      hasTouch,
      isMobile,
      userAgent,
      deviceScaleFactor,
      baseURL,
    },
    use,
    testInfo,
  ) => {
    const context = await playwright[browserName].launchPersistentContext(
      testInfo.outputPath("profile"),
      {
        viewport,
        hasTouch,
        isMobile,
        userAgent,
        deviceScaleFactor,
        baseURL,
        serviceWorkers: "block",
      },
    );
    await use(context);
    await context.close();
  },
});

// A phone. playwright.config.ts runs this file in Chromium and, as an
// iPhone, in WebKit.
test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});

/** Text as the Reader stores and copies it: one space between words. */
const words = (text: string) => text.replace(/\s+/g, " ").trim();

function savedHighlightTexts(page: Page, bookId: string) {
  return page.evaluate(async (bookId) => {
    const path = "/src/lib/db.ts";
    const highlights: { selectedText: string }[] = await (
      await import(path)
    ).getBookHighlights(bookId);
    return highlights.map((highlight) => highlight.selectedText);
  }, bookId);
}

/** Keeps what Copy writes. Playwright's WebKit cannot read the clipboard. */
async function recordCopies(page: Page): Promise<() => Promise<string[]>> {
  await page.evaluate(() => {
    const copies: string[] = [];
    Object.assign(window, { copies });
    navigator.clipboard.writeText = async (text: string) => {
      copies.push(text);
    };
  });
  return () =>
    page.evaluate(() => (window as unknown as { copies: string[] }).copies);
}

// The Reader reads a selection a moment after the finger lifts. A selection
// changed after that, by a handle or a key, must still be the one a tool
// acts on when it is tapped straight away.
test("Copy, Note and Highlight act on the selection as it is when tapped", async ({
  page,
  localBook,
}) => {
  await openLocalBook(page, localBook.id);
  for (let turn = 0; turn < 8; turn++) await nextSpread(page);
  const copies = await recordCopies(page);
  const yellow = page.getByRole("button", { name: "Highlight with yellow" });

  await selectPassage(page, { index: 0, length: 20 });
  await expect(yellow).toBeVisible();
  let final = await selectPassage(page, {
    index: 1,
    length: 32,
    release: false,
  });
  await page.getByRole("button", { name: "Copy text", exact: true }).tap();
  await expect.poll(copies).toEqual([words(final)]);

  final = await selectPassage(page, { index: 2, length: 28, release: false });
  await page.getByRole("button", { name: "Add note" }).tap();
  const input = page.getByRole("textbox", { name: "Write a note" });
  await expect(input).toBeFocused();
  await expect(
    page.getByTestId("note-quote").locator("span").first(),
  ).toHaveText(words(final));
  await input.press("Escape");
  await expect(page.locator("[data-note-composer]")).toHaveCount(0);

  await selectPassage(page, { index: 0, length: 20 });
  await expect(yellow).toBeVisible();
  final = await selectPassage(page, { index: 3, length: 24, release: false });
  await yellow.tap();
  await expect
    .poll(() => savedHighlightTexts(page, localBook.id))
    .toEqual([words(final)]);
});
