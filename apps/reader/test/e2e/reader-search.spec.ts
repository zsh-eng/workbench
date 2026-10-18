import type { Page } from "@playwright/test";
import {
  currentPages,
  expect,
  nextSpread,
  openLocalBook,
  test,
  waitForReaderReady,
} from "./helpers/fixtures";

const CURRENT_SPREAD = '[data-reader-spread-layer="current"]';

/** Command-F on a Mac. The Desktop Chrome profile reports Windows. */
const FIND_SHORTCUT = "Control+f";

function searchField(page: Page) {
  return page.getByRole("searchbox", { name: "Search this book" });
}

function results(page: Page) {
  return page.locator("[data-search-result]");
}

async function search(page: Page, query: string) {
  await searchField(page).fill(query);
  await expect(page.locator("[data-search-status]")).toHaveAttribute(
    "data-search-status",
    "done",
  );
}

/** The text of the marked matches on the current spread, spaces removed. */
function marks(page: Page, name: "reader-search" | "reader-search-active") {
  return page.evaluate(
    ({ name, selector }) => {
      const spread = document.querySelector(selector)!;
      return [...(CSS.highlights.get(name) ?? [])]
        .filter((range) =>
          spread.contains((range as Range).commonAncestorContainer),
        )
        .map((range) => range.toString().replace(/\s+/g, ""));
    },
    { name, selector: CURRENT_SPREAD },
  );
}

function shownChapters(page: Page) {
  return page
    .locator(`${CURRENT_SPREAD} [data-reader-chapter-index]`)
    .evaluateAll((pages) =>
      pages.map((element) =>
        Number(element.getAttribute("data-reader-chapter-index")),
      ),
    );
}

function checkpoint(page: Page, bookId: string) {
  return page.evaluate(async (bookId) => {
    const { syncV2Db: db } = await import("/src/lib/sync-v2/db.ts");
    const row = await db
      .table("readingCheckpoints")
      .where("bookId")
      .equals(bookId)
      .first();
    return row
      ? { spine: row.currentSpineIndex, progress: row.scrollProgress }
      : null;
  }, bookId);
}

function historyKinds(page: Page, bookId: string) {
  return page.evaluate(
    (id) =>
      (
        JSON.parse(localStorage.getItem("reader-jump-history-v1") ?? "[]").find(
          (record: { bookId: string }) => record.bookId === id,
        )?.history.entries ?? []
      ).map((entry: { kind: string }) => entry.kind),
    bookId,
  );
}

test("search leaves the page alone until a result is chosen", async ({
  page,
  localBook,
}) => {
  await openLocalBook(page, localBook.id);
  await nextSpread(page);
  const start = await currentPages(page);
  await expect.poll(() => checkpoint(page, localBook.id)).not.toBeNull();
  const saved = await checkpoint(page, localBook.id);

  await page.keyboard.press(FIND_SHORTCUT);
  await expect(searchField(page)).toBeFocused();

  // A newer query replaces the one still running, and clearing stops it.
  await searchField(page).fill("Dinah");
  await search(page, "Alice");
  await expect(results(page).first()).toBeVisible();
  for (const match of await results(page).locator("strong").allTextContents())
    expect(match.toLowerCase()).toBe("alice");
  await searchField(page).fill("");
  await expect(results(page)).toHaveCount(0);
  await expect(page.locator("[data-search-status]")).toHaveCount(0);

  // Inline italics and a typed apostrophe for a curly one.
  await search(page, "rabbit actually TOOK a watch");
  await expect(results(page)).toHaveCount(1);
  await search(page, "miles I've fallen");
  await expect(results(page)).toHaveCount(1);
  await expect(results(page).first()).toContainText("miles I’ve fallen");
  expect(await currentPages(page)).toEqual(start);
  expect(await checkpoint(page, localBook.id)).toEqual(saved);

  await results(page).first().click();
  await expect
    .poll(() => marks(page, "reader-search-active"))
    .toEqual(["milesI’vefallen"]);
  await expect.poll(() => historyKinds(page, localBook.id)).toContain("search");
  await expect.poll(() => checkpoint(page, localBook.id)).not.toEqual(saved);

  // Opening a result closes the tools, which can cover the match.
  await expect(searchField(page)).toHaveCount(0);
  await page.keyboard.press(FIND_SHORTCUT);
  await expect(searchField(page)).toBeFocused();
  await search(page, "rabbit actually TOOK a watch");
  await results(page).first().click();
  await expect
    .poll(() => marks(page, "reader-search-active"))
    .toEqual(["Rabbitactuallytookawatch"]);
  // The match starts in roman type and ends in italics.
  const styles = await page.evaluate(() =>
    [...(CSS.highlights.get("reader-search-active") ?? [])].flatMap((range) => [
      getComputedStyle((range as Range).startContainer.parentElement!)
        .fontStyle,
      getComputedStyle((range as Range).endContainer.parentElement!).fontStyle,
    ]),
  );
  expect(styles).toEqual(["normal", "italic"]);
});

test("next and previous step across chapters", async ({ page, localBook }) => {
  await openLocalBook(page, localBook.id);
  await page.keyboard.press(FIND_SHORTCUT);
  await search(page, "Dinah");
  const sections = page.locator("[data-reader-search-panel] section");
  const firstChapter = await sections.first().locator("[data-search-result]");
  const last = (await firstChapter.count()) - 1;
  await firstChapter.nth(last).click();
  await waitForReaderReady(page);
  await expect
    .poll(() => marks(page, "reader-search-active"))
    .toEqual(["Dinah"]);
  const before = await shownChapters(page);

  // Enter in the field steps forward, into the next chapter.
  await page.keyboard.press(FIND_SHORTCUT);
  await expect(searchField(page)).toHaveValue("Dinah");
  await searchField(page).press("Enter");
  await expect(searchField(page)).toHaveCount(0);
  await expect
    .poll(async () => Math.max(...(await shownChapters(page))))
    .toBeGreaterThan(Math.max(...before));
  await expect
    .poll(() => marks(page, "reader-search-active"))
    .toEqual(["Dinah"]);
  const stepper = page.getByTestId("search-stepper");
  await expect(stepper).toContainText(`${last + 2} of`);

  // The header steps back, and Command-Shift-G steps forward again.
  await stepper.getByRole("button", { name: "Previous result" }).click();
  await expect.poll(() => shownChapters(page)).toEqual(before);
  await expect
    .poll(() => marks(page, "reader-search-active"))
    .toEqual(["Dinah"]);
  await expect(stepper).toContainText(`${last + 1} of`);
  await page.keyboard.press("Control+g");
  await expect(stepper).toContainText(`${last + 2} of`);
});

test("a step from the page starts where the reader is", async ({
  page,
  localBook,
}) => {
  await openLocalBook(page, localBook.id);
  for (let spread = 0; spread < 4; spread++) await nextSpread(page);
  const start = await currentPages(page);
  const chapter = await shownChapters(page);

  // Enter straight after typing, before the matches are on pages.
  await page.keyboard.press(FIND_SHORTCUT);
  await searchField(page).fill("the");
  await searchField(page).press("Enter");
  await expect(page.getByTestId("search-stepper")).toBeVisible();
  await waitForReaderReady(page);
  // The chapter's earlier matches are behind the reader.
  expect(await shownChapters(page)).toEqual(chapter);
  expect(await currentPages(page)).toEqual(start);
  await expect
    .poll(async () =>
      (await marks(page, "reader-search-active")).map((m) => m.toLowerCase()),
    )
    .toEqual(["the"]);
});

test("a step as the book opens starts where the reader is", async ({
  page,
  localBook,
}) => {
  await openLocalBook(page, localBook.id);
  for (let spread = 0; spread < 4; spread++) await nextSpread(page);
  const start = await currentPages(page);
  // Book page numbers count the chapters laid out so far, so they settle
  // once the earlier chapters are.
  await page.reload();
  await waitForReaderReady(page);
  await expect.poll(() => currentPages(page)).toEqual(start);

  // Design ideas' `?search=` steps as soon as the page shows, before then.
  await page.goto(`/reader/${localBook.id}?search=the`);
  await expect(page.getByTestId("search-stepper")).toBeVisible();
  await waitForReaderReady(page);
  await expect.poll(() => currentPages(page)).toEqual(start);
});

test("a result opens the right page after the type changes", async ({
  page,
  localBook,
}) => {
  await openLocalBook(page, localBook.id);
  await page.keyboard.press(FIND_SHORTCUT);
  await search(page, "Dinah");
  const result = results(page).nth(7);
  const pageNumber = () => result.locator("[aria-label^='Page']").textContent();
  await expect.poll(pageNumber).not.toBe("");
  const before = await pageNumber();

  await page.getByRole("button", { name: "Reading appearance" }).click();
  await page.getByRole("button", { name: "Increase font size" }).click();
  await page.getByRole("button", { name: "Increase font size" }).click();
  await page.getByRole("button", { name: "Search book" }).click();
  await expect.poll(pageNumber).not.toBe(before);

  await result.click();
  await waitForReaderReady(page);
  // The page number follows the new layout to the page that opened.
  await expect
    .poll(async () => (await currentPages(page)).includes(await pageNumber()))
    .toBe(true);
  await expect
    .poll(() => marks(page, "reader-search-active"))
    .toEqual(["Dinah"]);
});

test.describe("on a phone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test("search opens from Reader tools and steps from the page", async ({
    page,
    localBook,
  }) => {
    await openLocalBook(page, localBook.id);
    await page.touchscreen.tap(195, 350);
    await page
      .getByRole("button", { name: "Open reader tools", exact: true })
      .tap();
    await page.getByRole("button", { name: /Search book/ }).tap();
    await expect(searchField(page)).toBeFocused();
    await search(page, "Dinah");

    await results(page).nth(6).tap();
    const stepper = page.getByTestId("search-stepper");
    await expect(stepper).toContainText("7 of");
    await expect(searchField(page)).toHaveCount(0);
    // The header and footer would cover a match near the page's edge.
    const back = page.getByRole("button", { name: "Back to library" });
    await expect(back).not.toBeInViewport();
    await waitForReaderReady(page);
    await expect
      .poll(() => marks(page, "reader-search-active"))
      .toEqual(["Dinah"]);

    // Stepping with the header showing clears it too.
    await page.touchscreen.tap(195, 350);
    await expect(back).toBeInViewport();
    await stepper.getByRole("button", { name: "Next result" }).tap();
    await expect(stepper).toContainText("8 of");
    await expect(back).not.toBeInViewport();
    await expect
      .poll(() => marks(page, "reader-search-active"))
      .toEqual(["Dinah"]);

    // The count brings the results back, with this book's query.
    await stepper.getByRole("button", { name: /Show all results/ }).tap();
    await expect(searchField(page)).toHaveValue("Dinah");
    await expect(results(page).nth(7)).toHaveAttribute("aria-current", "true");
    await page.keyboard.press("Escape");
    await expect(searchField(page)).toHaveCount(0);

    await stepper.getByRole("button", { name: "Close search" }).tap();
    await expect(stepper).toHaveCount(0);
    await expect.poll(() => marks(page, "reader-search")).toEqual([]);

    await page.reload();
    await waitForReaderReady(page);
    await page.touchscreen.tap(195, 350);
    await page
      .getByRole("button", { name: "Open reader tools", exact: true })
      .tap();
    await page.getByRole("button", { name: /Search book/ }).tap();
    await expect(searchField(page)).toHaveValue("Dinah");
    await expect(results(page).first()).toBeVisible();
  });
});
