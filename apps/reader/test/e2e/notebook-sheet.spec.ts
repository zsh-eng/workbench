import type { CDPSession, Locator, Page } from "@playwright/test";
import {
  test,
  expect,
  openLocalBook,
  openReaderTools,
  waitForSheet,
  waitForSheetToRest,
} from "./helpers/fixtures";

test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});

async function addHighlights(page: Page, bookId: string, count: number) {
  await page.evaluate(
    async ({ bookId, count }) => {
      const data = await import("/src/lib/db.ts");
      const books = await data.getAllBooks();
      const book = books.find((item: { id: string }) => item.id === bookId);
      for (let index = 0; index < count; index++)
        await data.addHighlight({
          id: `h-${index}`,
          bookId,
          spineItemId: book.spine[2].idref as string,
          startOffset: 40 + index * 30,
          endOffset: 60 + index * 30,
          selectedText: `Passage ${index}. Words kept from the page.`,
          textBefore: "",
          textAfter: "",
          color: "yellow",
          createdAt: 1720000000000 + index * 1000,
        });
    },
    { bookId, count },
  );
}

/** A finger that swipes a Notebook entry away. */
async function swipeAway(page: Page, cdp: CDPSession, id: string) {
  const rect = (await page
    .locator(`[data-note-id="${id}"] article`)
    .boundingBox())!;
  const x = rect.x + rect.width * 0.25;
  const y = rect.y + Math.min(20, rect.height / 2);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y }],
  });
  for (const dx of [12, 30, 55, 80, 100])
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: x + dx, y }],
    });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
}

const entryIds = (sheet: Locator) =>
  sheet
    .locator("[data-note-id]")
    .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-note-id")));

for (const place of ["medium", "full"] as const)
  test(`Entries swiped away one after another ${place === "full" ? "move the Notebook once in full view" : "leave the Notebook at its detent"}, and Undo puts one back in place`, async ({
    page,
    localBook,
  }) => {
    await addHighlights(page, localBook.id, place === "medium" ? 6 : 4);
    await openLocalBook(page, localBook.id);
    await page.touchscreen.tap(195, 422);
    const tools = await openReaderTools(page);
    await tools.getByRole("button", { name: "Notebook", exact: true }).click();
    const notebook = await waitForSheet(page, "Notebook");
    await waitForSheetToRest(notebook);
    const cdp = await page.context().newCDPSession(page);
    if (place === "full") {
      await cdp.send("Input.synthesizeScrollGesture", {
        x: 195,
        y: 260,
        yDistance: -500,
        gestureSourceType: "touch",
        speed: 1200,
      });
      await waitForSheetToRest(notebook);
      await expect(
        notebook.getByRole("textbox", { name: "Write a note" }),
      ).toBeInViewport();
    }
    const before = await entryIds(notebook);
    expect(before).toHaveLength(place === "medium" ? 6 : 4);

    // The sheet's height goes through `data-sheet-fit-state` as it follows
    // the list; its top edge is sampled each frame.
    await notebook.evaluate((element) => {
      const surface = element.closest<HTMLElement>(".reader-sheet")!;
      const fit = surface.querySelector<HTMLElement>("[data-sheet-fit]")!;
      const record = { states: [] as string[], tops: [] as number[] };
      (window as { __record?: typeof record }).__record = record;
      new MutationObserver(() => {
        const state = fit.dataset.sheetFitState!;
        if (record.states.at(-1) !== state) record.states.push(state);
      }).observe(fit, { attributeFilter: ["data-sheet-fit-state"] });
      const sample = () => {
        record.tops.push(surface.getBoundingClientRect().top);
        if (surface.isConnected) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    const recorded = () =>
      page.evaluate(
        () =>
          (window as { __record?: { states: string[]; tops: number[] } })
            .__record!,
      );
    for (const id of before.slice(0, 2)) {
      await swipeAway(page, cdp, id!);
      await page.waitForTimeout(120);
    }
    await expect.poll(() => entryIds(notebook)).toEqual(before.slice(2));
    await waitForSheetToRest(notebook);
    const { states, tops } = await recorded();
    if (place === "medium") {
      // It held while the entries collapsed. Only the part below the
      // screen changed, at once.
      expect(states).toEqual(["held", "rest"]);
      // A fixed detent keeps its top edge: it never moves by a pixel.
      expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(1);
    } else {
      // It held while the entries collapsed, then followed them once: the
      // top edge goes down and never comes back up.
      expect(states).toEqual(["held", "settling", "rest"]);
      const rises = tops.filter((top, index) => top < tops[index - 1]!);
      expect(rises).toHaveLength(0);
      expect(tops.at(-1)!).toBeGreaterThan(tops[0]!);
    }

    // Undo brings an entry back where it was. The newest notice is in
    // front.
    await page
      .getByRole("button", { name: "Undo", exact: true })
      .first()
      .click();
    await expect
      .poll(async () => (await entryIds(notebook)).length)
      .toBe(before.length - 1);
    const after = await entryIds(notebook);
    expect(after).toEqual(before.filter((id) => after.includes(id)));
    await waitForSheetToRest(notebook);
    if (place === "full")
      await expect(
        notebook.getByRole("textbox", { name: "Write a note" }),
      ).toBeInViewport();
  });
