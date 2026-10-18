import type { Locator, Page } from "@playwright/test";
import { expect, test, waitForReaderReady } from "./helpers/fixtures";

test("renders highlights after a cold query resolves", async ({
  page,
  localBook,
}) => {
  await page.evaluate(async (bookId) => {
    const path = "/src/lib/db.ts";
    await (
      await import(path)
    ).addHighlight({
      id: "cold-card",
      bookId,
      spineItemId: "chapter",
      startOffset: 0,
      endOffset: 16,
      selectedText: "Cold query card.",
      textBefore: "",
      textAfter: "",
      color: "yellow",
      createdAt: Date.now(),
    });
  }, localBook.id);
  await page.goto("/highlights");
  await expect(
    page.getByText("Cold query card.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open at: Cold query card." }),
  ).toBeVisible();
});

test("a long list renders near the view and returns to its place from a book", async ({
  page,
  localBook,
}) => {
  await page.setViewportSize({ width: 1280, height: 850 });
  await page.evaluate(async (bookId) => {
    const path = "/src/lib/db.ts";
    const data = await import(path);
    const books = await data.getAllBooks();
    const book = books.find((item: { id: string }) => item.id === bookId);
    const spineItemId = book.spine[2].idref as string;
    for (let index = 0; index < 200; index++)
      await data.addHighlight({
        id: `long-${index}`,
        bookId,
        spineItemId,
        startOffset: index,
        endOffset: index + 5,
        selectedText: `Passage ${index}. ${"A line of kept words. ".repeat(4 + (index % 5) * 6)}`,
        textBefore: "",
        textAfter: "",
        color: index % 7 === 0 ? "blue" : "yellow",
        createdAt: 1720000000000 + index,
      });
  }, localBook.id);
  await page.goto("/highlights");
  await expect(page.getByText("Passage 0.", { exact: false })).toBeVisible();
  expect(await page.locator("article").count()).toBeLessThan(60);

  // The filters stay in place as the list and its counts shrink.
  const blue = page.getByRole("button", { name: "Blue highlights" });
  const left = (await blue.boundingBox())!.x;
  await blue.click();
  await expect(page.getByText("Passage 1.", { exact: false })).toHaveCount(0);
  expect((await blue.boundingBox())!.x).toBe(left);
  await blue.click();

  await page.evaluate(() =>
    window.scrollTo(0, document.documentElement.scrollHeight),
  );
  await expect(page.getByText("Passage 199.", { exact: false })).toBeVisible();

  // A passage partway down opens the book, and Back returns to it.
  await page.evaluate(() => window.scrollTo(0, 8000));
  await page.waitForTimeout(200);
  const before = await page.evaluate(() => {
    const button = [
      ...document.querySelectorAll<HTMLElement>('[aria-label^="Open at:"]'),
    ].find((item) => item.getBoundingClientRect().top >= 0)!;
    return {
      name: button.getAttribute("aria-label")!,
      top: button.getBoundingClientRect().top,
    };
  });
  await page.getByRole("button", { name: before.name, exact: true }).click();
  await expect(page).toHaveURL(`/reader/${localBook.id}`);
  await waitForReaderReady(page);
  await page.goBack();
  await expect(page).toHaveURL("/highlights");
  const returned = page.getByRole("button", { name: before.name, exact: true });
  await expect(returned).toBeVisible();
  expect(
    Math.abs((await returned.boundingBox())!.y - before.top),
  ).toBeLessThanOrEqual(2);
});

test.describe("Mobile highlight durability", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  test("saves offline and supports keyboard activation and pointer cancellation", async ({
    page,
    localBook,
  }) => {
    const { openLocalBook, nextSpread } = await import("./helpers/fixtures");
    await openLocalBook(page, localBook.id);
    for (let index = 0; index < 8; index++) await nextSpread(page);
    // Load the existing database module before taking the browser offline.
    await page.evaluate(async () => {
      const path = "/src/lib/db.ts";
      await import(path);
    });
    await page.evaluate(() => {
      const root = document.querySelector(
        '[data-reader-spread-layer="current"]',
      )!;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node && (node.textContent?.trim().length ?? 0) < 30)
        node = walker.nextNode();
      if (!node) throw new Error("No passage to select");
      const range = document.createRange();
      range.setStart(node, 0);
      range.setEnd(node, 25);
      window.getSelection()!.removeAllRanges();
      window.getSelection()!.addRange(range);
    });
    await expect
      .poll(() => page.evaluate(() => window.getSelection()?.toString().length))
      .toBe(25);
    await page.evaluate(() =>
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true })),
    );
    const yellow = page.getByRole("button", { name: "Highlight with yellow" });
    await expect(yellow).toBeVisible();
    await page.context().setOffline(true);
    await yellow.tap();
    const savedHighlights = () =>
      page.evaluate(async (bookId) => {
        const path = "/src/lib/db.ts";
        return (await import(path)).getBookHighlights(bookId);
      }, localBook.id);
    await expect
      .poll(async () =>
        (await savedHighlights()).map((h: { color: string }) => h.color),
      )
      .toEqual(["yellow"]);
    const passage = page
      .locator('[data-reader-spread-layer="current"] [data-highlight-id]')
      .first();
    await passage.tap();
    const remove = page.getByRole("button", { name: "Remove highlight" });
    await expect(remove).toBeVisible();
    await remove.dispatchEvent("pointerdown", {
      pointerId: 3,
      pointerType: "touch",
      bubbles: true,
      cancelable: true,
    });
    await remove.dispatchEvent("pointercancel", {
      pointerId: 3,
      pointerType: "touch",
      bubbles: true,
    });
    await expect(remove).toBeVisible();
    expect(
      (await savedHighlights()).map((h: { color: string }) => h.color),
    ).toEqual(["yellow"]);
    const green = page.getByRole("button", { name: "Highlight with green" });
    await green.focus();
    await page.keyboard.press("Enter");
    await expect
      .poll(async () =>
        (await savedHighlights()).map((h: { color: string }) => h.color),
      )
      .toEqual(["green"]);
    await remove.focus();
    await page.keyboard.press("Space");
    await expect.poll(savedHighlights).toEqual([]);
    await expect(remove).not.toBeVisible();
    await expect(passage).toHaveCount(0);
    await page.context().setOffline(false);
  });
});

/**
 * Highlights "nothing so <i>very</i> remarkable" on a phone. The passage mixes
 * plain and italic text, so the highlight crosses two formatting changes.
 */
async function highlightMixedFormatPassage(
  page: Page,
  bookId: string,
): Promise<Locator> {
  const { openLocalBook, nextSpread } = await import("./helpers/fixtures");
  await openLocalBook(page, bookId);
  const current = page.locator('[data-reader-spread-layer="current"]');
  for (let index = 0; index < 12; index++) {
    if ((await current.getByText("remarkable in that").count()) > 0) break;
    await nextSpread(page);
  }
  await page.evaluate(() => {
    const root = document.querySelector(
      '[data-reader-spread-layer="current"]',
    )!;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let start: Text | null = null;
    let end: Text | null = null;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent ?? "";
      if (!start && text.includes("nothing so")) start = node as Text;
      if (start && text.includes("remarkable")) {
        end = node as Text;
        break;
      }
    }
    if (!start || !end) throw new Error("No mixed-format passage");
    const range = document.createRange();
    range.setStart(start, start.textContent!.indexOf("nothing"));
    range.setEnd(
      end,
      end.textContent!.indexOf("remarkable") + "remarkable".length,
    );
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
  });
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString()))
    .toMatch(/^nothing so\s+very\s+remarkable$/);
  await page.evaluate(() =>
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true })),
  );
  const yellow = page.getByRole("button", { name: "Highlight with yellow" });
  await yellow.tap();
  await expect(yellow).toBeHidden();
  const marks = current.locator("[data-highlight-id]");
  await expect(marks.first()).toBeVisible();
  return marks;
}

test.describe("Touch highlight rendering", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  test("a highlight stays continuous across italic text", async ({
    page,
    localBook,
  }) => {
    const marks = await highlightMixedFormatPassage(page, localBook.id);

    // Each line of the highlight paints one unbroken background.
    const breaks = await marks.evaluateAll((elements) => {
      const rects = elements
        .flatMap((element) => [...element.getClientRects()])
        .filter((rect) => rect.width > 0)
        .sort((a, b) => a.top - b.top || a.left - b.left);
      const found: number[] = [];
      for (let index = 1; index < rects.length; index++) {
        const previous = rects[index - 1]!;
        const rect = rects[index]!;
        if (Math.abs(rect.top - previous.top) > 1) continue;
        if (rect.left - previous.right > 0.5) {
          found.push(rect.left - previous.right);
        }
      }
      return found;
    });
    expect(breaks).toEqual([]);
  });
});
