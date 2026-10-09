import type { Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import {
  test,
  expect,
  openLocalBook,
  nextSpread,
  waitForReaderReady,
} from "./helpers/fixtures";

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});

async function selectPassage(page: Page, index = 0) {
  await page.evaluate((index) => {
    (document.activeElement as HTMLElement | null)?.blur();
    const root = document.querySelector(
      '[data-reader-spread-layer="current"]',
    )!;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    let node = walker.nextNode();
    let found = 0;
    while (node) {
      range.selectNodeContents(node);
      if (
        (node.textContent?.trim().length ?? 0) >= 20 &&
        range.getBoundingClientRect().top >= 120 &&
        found++ === index
      )
        break;
      node = walker.nextNode();
    }
    if (!node) throw new Error("No sample passage");
    range.setStart(node, 0);
    range.setEnd(node, 20);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
  }, index);
  await page.evaluate(() =>
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true })),
  );
}

/** The capsule rides on the footer, so the chrome must be showing. */
async function showChrome(page: Page) {
  const capsule = page.locator("[data-notes-capsule]");
  if (!(await capsule.isVisible()))
    await page.touchscreen.tap(page.viewportSize()!.width / 2, 300);
  await expect(capsule).toBeVisible();
}

for (const reduced of [false, true]) {
  test(`Notes Island annotation and retained draft${reduced ? " narrow dark reduced motion" : ""}`, async ({
    page,
    localBook,
  }) => {
    test.setTimeout(60_000);
    if (reduced) await page.setViewportSize({ width: 320, height: 700 });
    await page.emulateMedia({
      reducedMotion: reduced ? "reduce" : "no-preference",
    });
    await openLocalBook(page, localBook.id);
    for (let i = 0; i < 8; i++) await nextSpread(page);
    if (reduced)
      await page.evaluate(() => document.documentElement.classList.add("dark"));
    const input = page.getByRole("textbox", { name: "Write a note" });
    const colors = page.getByRole("group", { name: "Highlight colors" });
    const quote = page.getByTestId("note-quote");
    const footer = page.locator("[data-reader-footer]");
    const island = page.locator("[data-notes-island]");
    const directory = "diagnostics/interface-review/notes-island";
    await mkdir(directory, { recursive: true });
    const capture = (name: string) =>
      page.screenshot({
        path: `${directory}/${reduced ? "dark-" : ""}${name}.png`,
        animations: "disabled",
      });
    // Observe footer exclusion throughout entrance, dismissal and reopening.
    await page.evaluate(() => {
      const state = { running: true, overlaps: 0 };
      (
        window as unknown as { annotationFrames: typeof state }
      ).annotationFrames = state;
      const sample = () => {
        if (
          document.querySelector("[data-notes-island]") &&
          document.querySelector("[data-reader-footer]")
        )
          state.overlaps++;
        if (state.running) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await selectPassage(page);
    await expect(colors).toBeVisible();
    await expect(input).toHaveCount(0);
    await expect(footer).toHaveCount(0);
    // The island is centred at the bottom, inside the screen.
    const toolsBox = (await island.locator("> div > div").boundingBox())!;
    const width = page.viewportSize()!.width;
    expect(Math.abs(toolsBox.x + toolsBox.width / 2 - width / 2)).toBeLessThan(
      2,
    );
    expect(toolsBox.x).toBeGreaterThanOrEqual(8);
    await capture("selection");
    await page.getByRole("button", { name: "Add note" }).click();
    await expect(input).toBeFocused();
    await expect(colors).toHaveCount(0);
    await expect(quote).toBeVisible();
    const originalQuote = await quote.locator("span").first().innerText();
    await input.fill("This draft belongs to a passage.");
    await capture("writing");
    const panel = page.locator("[data-note-composer]");
    await page.evaluate(() => {
      Object.defineProperty(window.visualViewport!, "height", {
        configurable: true,
        value: window.innerHeight - 300,
      });
      window.visualViewport!.dispatchEvent(new Event("resize"));
    });
    await expect
      .poll(async () => {
        const box = (await panel.boundingBox())!;
        return Math.round(box.y + box.height);
      })
      .toBe(page.viewportSize()!.height - 300);
    await expect(quote).toBeVisible();
    await capture("keyboard");
    await page.evaluate(() => {
      delete (window.visualViewport as unknown as { height?: number }).height;
      window.visualViewport!.dispatchEvent(new Event("resize"));
    });
    await input.press("Escape");
    await expect(panel).toHaveCount(0);
    // A new passage offers to attach itself to the unfinished draft.
    await selectPassage(page, 2);
    await expect(page.getByRole("button", { name: "Add note" })).toHaveCount(0);
    await page.getByRole("button", { name: "Attach to draft" }).click();
    await expect(input).toHaveValue("This draft belongs to a passage.");
    await expect(quote.locator("span").first()).not.toHaveText(originalQuote);
    const attachedQuote = await quote.locator("span").first().innerText();
    await page.getByRole("button", { name: "Save note", exact: true }).click();
    await expect(panel).toHaveCount(0);
    await expect(page.getByRole("status")).toContainText("Saved to notebook");
    await capture("saved");
    await expect(island).toHaveCount(0);
    const saved = await page.evaluate(async () => {
      const { syncV2Db: db } = await import("/src/lib/sync-v2/db.ts");
      return (await db.notes.toArray()).filter((note) => !note.isDeleted);
    });
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      content: "This draft belongs to a passage.",
      quote: { text: attachedQuote },
    });
    await showChrome(page);
    await capture("capsule");
    const notebookButton = page.getByRole("button", {
      name: "Open notebook",
      exact: true,
    });
    await expect(notebookButton).toHaveAttribute(
      "aria-description",
      "1 note in this book",
    );
    await notebookButton.click();
    const sheet = page.getByRole("dialog", { name: "Notebook", exact: true });
    await expect(sheet).toContainText("This draft belongs to a passage.");
    await capture("notebook");
    await sheet.getByRole("button", { name: "Close notebook" }).click();
    await expect(sheet).not.toBeVisible();
    await expect(page.locator("[data-note-composer]")).toHaveCount(0);
    const overlaps = await page.evaluate(() => {
      const state = (
        window as unknown as {
          annotationFrames: { running: boolean; overlaps: number };
        }
      ).annotationFrames;
      state.running = false;
      return state.overlaps;
    });
    expect(overlaps).toBe(0);
  });
}

test("attaching, quote removal and highlight deletion preserve note intent", async ({
  page,
  localBook,
}) => {
  await openLocalBook(page, localBook.id);
  for (let i = 0; i < 8; i++) await nextSpread(page);
  const input = page.getByRole("textbox", { name: "Write a note" });
  const quote = page.getByTestId("note-quote");
  await selectPassage(page);
  await page.getByRole("button", { name: "Highlight with yellow" }).click();
  const mark = page
    .locator('[data-reader-spread-layer="current"] mark')
    .first();
  await mark.click();
  // The current colour removes the highlight, as on desktop.
  await expect(
    page.getByRole("button", { name: "Remove highlight", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Add note" }).click();
  await input.fill("Retained thought");
  const first = await quote.locator("span").first().innerText();
  await input.press("Escape");
  await expect(page.locator("[data-note-composer]")).toHaveCount(0);
  await selectPassage(page, 2);
  await page.getByRole("button", { name: "Attach to draft" }).click();
  await expect(quote.locator("span").first()).not.toHaveText(first);
  await expect(input).toHaveValue("Retained thought");
  await page.getByRole("button", { name: "Remove quote" }).click();
  await expect(quote).toHaveCount(0);
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(page.locator("[data-note-composer]")).toHaveCount(0);
  await mark.click();
  await page
    .getByRole("button", { name: "Remove highlight", exact: true })
    .click();
  await expect(mark).toHaveCount(0);
  const saved = await page.evaluate(async () => {
    const { syncV2Db: db } = await import("/src/lib/sync-v2/db.ts");
    return (await db.notes.toArray()).filter((note) => !note.isDeleted);
  });
  expect(saved[0]).toMatchObject({ content: "Retained thought" });
  expect(saved[0]).not.toHaveProperty("quote");
});

test("a noted highlight opens its note on the island, with Undo for deletion", async ({
  page,
  localBook,
}) => {
  await openLocalBook(page, localBook.id);
  for (let i = 0; i < 8; i++) await nextSpread(page);
  await selectPassage(page);
  await page.getByRole("button", { name: "Highlight with green" }).click();
  const mark = page
    .locator('[data-reader-spread-layer="current"] mark')
    .first();
  await mark.click();
  await page.getByRole("button", { name: "Add note" }).click();
  await page
    .getByRole("textbox", { name: "Write a note" })
    .fill("Worth rereading.");
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Saved to notebook");
  await expect(page.locator("[data-notes-island]")).toHaveCount(0);
  await mark.click();
  const note = page.getByRole("region", { name: "Note", exact: true });
  await expect(note).toContainText("Worth rereading.");
  await expect(note).toContainText(/p\. \d+ · Today/);
  await page.screenshot({
    path: "diagnostics/interface-review/notes-island/note.png",
    animations: "disabled",
  });
  await note.getByRole("button", { name: "Delete note" }).click();
  await expect(page.getByRole("status")).toContainText("Note deleted");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const { syncV2Db: db } = await import("/src/lib/sync-v2/db.ts");
        return (await db.notes.toArray()).filter((item) => !item.isDeleted)
          .length;
      }),
    )
    .toBe(1);
  await mark.click();
  await note.getByRole("button", { name: "Show highlight tools" }).click();
  await expect(
    page.getByRole("button", { name: "Remove highlight", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("the notebook gathers highlights and filters them by type and colour", async ({
  page,
  localBook,
}) => {
  await openLocalBook(page, localBook.id);
  for (let i = 0; i < 8; i++) await nextSpread(page);
  // A plain yellow highlight, and a green highlight with a note.
  await selectPassage(page);
  await page.getByRole("button", { name: "Highlight with yellow" }).click();
  await selectPassage(page, 2);
  await page.getByRole("button", { name: "Highlight with green" }).click();
  await page
    .locator('[data-reader-spread-layer="current"] mark[data-color="green"]')
    .first()
    .click();
  await page.getByRole("button", { name: "Add note" }).click();
  await page
    .getByRole("textbox", { name: "Write a note" })
    .fill("Green thought.");
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await showChrome(page);
  await page
    .getByRole("button", { name: "Open notebook", exact: true })
    .click();
  const notebook = page.getByRole("region", { name: "Book notebook" });
  const heading = notebook.getByRole("heading", { level: 2 });
  await expect(heading).toHaveText(/Notebook\s*2$/);
  const show = notebook.getByRole("group", { name: "Show" });
  const height = (await notebook.boundingBox())!.height;
  await show.getByRole("button", { name: "Show highlights" }).click();
  await expect(heading).toHaveText(/1 of 2$/);
  await expect(
    notebook.getByRole("button", { name: /^Go to highlight:/ }),
  ).toHaveCount(1);
  await expect(notebook).not.toContainText("Green thought.");
  // Filtering does not move the filters under the finger.
  expect((await notebook.boundingBox())!.height).toBeCloseTo(height, 0);
  await page.screenshot({
    path: "diagnostics/interface-review/notes-island/notebook-filters.png",
    animations: "disabled",
  });
  await show.getByRole("button", { name: "Show all" }).click();
  await notebook.getByRole("button", { name: "Only green" }).click();
  await expect(heading).toHaveText(/1 of 2$/);
  await expect(notebook).toContainText("Green thought.");
  await show.getByRole("button", { name: "Show highlights" }).click();
  await expect(notebook).toContainText("Nothing matches these filters.");
  await notebook.getByRole("button", { name: "Show everything" }).click();
  await expect(heading).toHaveText(/Notebook\s*2$/);
  // A highlight opens its page and returns to reading.
  const yellow = notebook.getByRole("button", { name: /^Go to highlight:/ });
  await yellow.click();
  await expect(notebook).not.toBeVisible();
  await expect(
    page.locator(
      '[data-reader-spread-layer="current"] mark[data-color="yellow"]',
    ),
  ).toBeVisible();
});

test("the notebook opens at the current chapter", async ({
  page,
  localBook,
}) => {
  test.setTimeout(60_000);
  await openLocalBook(page, localBook.id);
  for (let i = 0; i < 8; i++) await nextSpread(page);
  const goTo = async (name: string) => {
    await showChrome(page);
    await page.getByRole("button", { name, exact: true }).click();
    await waitForReaderReady(page);
  };
  // Two highlights in each of four chapters overflow the notebook list.
  for (const color of ["yellow", "green", "blue", "magenta"]) {
    for (const index of [0, 2]) {
      await selectPassage(page, index);
      await page
        .getByRole("button", { name: `Highlight with ${color}` })
        .click();
      await expect(page.locator("[data-notes-island]")).toHaveCount(0);
    }
    await goTo("Next chapter");
  }
  await goTo("Previous chapter");
  await goTo("Previous chapter");
  await showChrome(page);
  await page
    .getByRole("button", { name: "Open notebook", exact: true })
    .click();
  const groups = page
    .getByRole("region", { name: "Book notebook" })
    .locator("[data-notebook-group]");
  await expect(groups).toHaveCount(4);
  await expect(groups.nth(2)).toBeInViewport();
  await expect(groups.first()).not.toBeInViewport();
});
