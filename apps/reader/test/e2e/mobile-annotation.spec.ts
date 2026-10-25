import type { Locator, Page } from "@playwright/test";
import {
  test,
  expect,
  openLocalBook,
  nextSpread,
  waitForReaderReady,
  waitForSheet,
} from "./helpers/fixtures";

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});

/**
 * Closes a phone sheet as a reader does: a tap on the dimmed page above
 * it. The detent Notebook has no close button of its own.
 */
async function closeSheet(page: Page, sheet: Locator) {
  const top = await sheet.evaluate(
    (element) =>
      (element.closest(".reader-sheet") ?? element).getBoundingClientRect().top,
  );
  await page.touchscreen.tap(195, Math.max(8, top / 2));
  await expect(sheet).not.toBeVisible();
}

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

test("Notes Island annotation and retained draft", async ({
  page,
  localBook,
}) => {
  test.setTimeout(60_000);
  await openLocalBook(page, localBook.id);
  for (let i = 0; i < 8; i++) await nextSpread(page);
  const input = page.getByRole("textbox", { name: "Write a note" });
  const colors = page.getByRole("group", { name: "Highlight colors" });
  const quote = page.getByTestId("note-quote");
  const footer = page.locator("[data-reader-footer]");
  const island = page.locator("[data-notes-island]");
  // Observe footer exclusion throughout entrance, dismissal and reopening.
  await page.evaluate(() => {
    const state = { running: true, overlaps: 0 };
    (window as unknown as { annotationFrames: typeof state }).annotationFrames =
      state;
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
  // The island stays inside the screen.
  const toolsBox = (await island.locator("> div > div").boundingBox())!;
  expect(toolsBox.x).toBeGreaterThanOrEqual(0);
  expect(toolsBox.x + toolsBox.width).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
  await page.getByRole("button", { name: "Add note" }).click();
  await expect(input).toBeFocused();
  await expect(colors).toHaveCount(0);
  await expect(quote).toBeVisible();
  const originalQuote = await quote.locator("span").first().innerText();
  await input.fill("This draft belongs to a passage.");
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
  await expect(
    page.getByRole("status").filter({ hasText: "Saved to notebook" }),
  ).toBeVisible();
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
  const notebookButton = page.getByRole("button", {
    name: "Open notebook",
    exact: true,
  });
  await expect(notebookButton).toHaveAttribute(
    "aria-description",
    "1 note in this book",
  );
  await notebookButton.click();
  const sheet = await waitForSheet(page, "Notebook");
  await expect(sheet).toContainText("This draft belongs to a passage.");
  await closeSheet(page, sheet);
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
  await expect(
    page.getByRole("status").filter({ hasText: "Saved to notebook" }),
  ).toBeVisible();
  await expect(page.locator("[data-notes-island]")).toHaveCount(0);
  await mark.click();
  const note = page.getByRole("region", { name: "Note", exact: true });
  await expect(note).toContainText("Worth rereading.");
  await expect(note).toContainText(/p\. \d+ · Today/);
  await note.getByRole("button", { name: "Delete note" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Note deleted" }),
  ).toBeVisible();
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
  // Selecting text hides the reading chrome; the island owns the bottom edge.
  await showChrome(page);
  const back = page.getByRole("button", { name: "Back to library" });
  await expect(back).toBeInViewport();
  // A plain yellow highlight, and a green highlight with a note. The reveal
  // tap clears selections for a moment, so retry until one holds.
  await expect(async () => {
    await selectPassage(page);
    await expect(page.locator('[data-notes-island="tools"]')).toBeVisible({
      timeout: 500,
    });
  }).toPass();
  await expect(back).not.toBeInViewport();
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
  // The capsule counts what the notebook shows.
  const open = page.getByRole("button", { name: "Open notebook", exact: true });
  await expect(open).toHaveAttribute(
    "aria-description",
    "1 note and 1 highlight in this book",
  );
  await open.click();
  await waitForSheet(page, "Notebook");
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
  await show.getByRole("button", { name: "Show all" }).click();
  await notebook.getByRole("button", { name: "Green highlights" }).click();
  await expect(heading).toHaveText(/1 of 2$/);
  await expect(notebook).toContainText("Green thought.");
  await show.getByRole("button", { name: "Show highlights" }).click();
  await expect(notebook).toContainText("Nothing matches these filters.");
  // The filtered-out entries leave before the empty state takes taps.
  await expect(notebook.locator("[data-note-id]")).toHaveCount(0);
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
  await waitForSheet(page, "Notebook");
  const groups = page
    .getByRole("region", { name: "Book notebook" })
    .locator("[data-notebook-group]");
  await expect(groups).toHaveCount(4);
  await expect(groups.nth(2)).toBeInViewport();
  await expect(groups.first()).not.toBeInViewport();
});

test("a notebook highlight has the note menu on phones too", async ({
  page,
  localBook,
}) => {
  await openLocalBook(page, localBook.id);
  for (let i = 0; i < 8; i++) await nextSpread(page);
  await selectPassage(page);
  await page.getByRole("button", { name: "Highlight with blue" }).click();
  await expect(page.locator("[data-notes-island]")).toHaveCount(0);
  await showChrome(page);
  await page
    .getByRole("button", { name: "Open notebook", exact: true })
    .click();
  await waitForSheet(page, "Notebook");
  const notebook = page.getByRole("region", { name: "Book notebook" });
  const entry = notebook.locator('[aria-label^="Highlight;"]');
  // A long press opens the same menu as a note's, without Edit.
  await entry.dispatchEvent("contextmenu");
  await expect(page.getByRole("menuitem", { name: "Edit note" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("menuitem", { name: "Copy text", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("menuitem", { name: "Delete highlight", exact: true })
    .click();
  await expect(entry).toHaveCount(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(entry).toHaveCount(1);
});

/**
 * Saves a highlight over a page break: the current page's last line runs on
 * to the next page's first line. Returns the passage as the book has it.
 */
async function highlightAcrossPageBreak(page: Page, bookId: string) {
  const findCut = () =>
    page.evaluate(() => {
      const paragraph = (layer: string, which: "first" | "last") => {
        const all = document.querySelectorAll(
          `[data-reader-spread-layer="${layer}"] p[data-reader-block-id]`,
        );
        return which === "first" ? all[0] : all[all.length - 1];
      };
      const last = paragraph("current", "last");
      const first = paragraph("next", "first");
      const id = last?.getAttribute("data-reader-block-id");
      if (!id || id !== first?.getAttribute("data-reader-block-id"))
        return null;
      // Whole words only: a line can end or start inside a broken word.
      const words = (line: Element | undefined) =>
        (line?.textContent ?? "").trim().split(/\s+/);
      const tail = words([...last!.querySelectorAll(":scope > span")].at(-1));
      const head = words(first!.querySelector(":scope > span") ?? undefined);
      if (tail.length < 4 || head.length < 4) return null;
      return {
        from: tail.slice(1, -1).join(" "),
        to: head.slice(1, -1).join(" "),
      };
    });
  let cut = await findCut();
  for (let turn = 0; turn < 20 && !cut; turn++) {
    await nextSpread(page);
    cut = await findCut();
  }
  if (!cut) throw new Error("No paragraph runs on to the next page");
  return page.evaluate(
    async ({ bookId, from, to }) => {
      const { syncV2Db: db } = await import("/src/lib/sync-v2/db.ts");
      const book = await db.books.get(bookId);
      const files = await db.bookFiles.where("bookId").equals(bookId).toArray();
      // Source whitespace can differ from the page's single spaces.
      const pattern = (words: string) =>
        new RegExp(
          words
            .split(" ")
            .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
            .join("\\s+"),
        );
      for (const item of book.spine) {
        const href = book.manifest.find(
          (entry: { id: string }) => entry.id === item.idref,
        ).href;
        const file = files.find(
          (entry: { path: string }) => entry.path === href,
        );
        if (!file) continue;
        const text =
          new DOMParser().parseFromString(
            await file.content.text(),
            "text/html",
          ).body.textContent ?? "";
        const start = text.match(pattern(from));
        if (start?.index === undefined) continue;
        const rest = text.slice(start.index).match(pattern(to));
        if (rest?.index === undefined) continue;
        const endOffset = start.index + rest.index + rest[0].length;
        const selectedText = text.slice(start.index, endOffset);
        await db.highlights.put({
          id: "across-pages",
          bookId,
          spineItemId: item.idref,
          startOffset: start.index,
          endOffset,
          selectedText,
          textBefore: "",
          textAfter: "",
          color: "blue",
          createdAt: Date.now(),
          isDeleted: false,
        });
        return { passage: selectedText.replace(/\s+/g, " ").trim(), to };
      }
      throw new Error("Passage not found in the book");
    },
    { bookId, ...cut },
  );
}

test("Copy writes a highlight's whole passage, past the page break, from its tools and its note", async ({
  page,
  localBook,
}) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const clipboard = () => page.evaluate(() => navigator.clipboard.readText());
  await openLocalBook(page, localBook.id);
  const { passage, to } = await highlightAcrossPageBreak(page, localBook.id);
  // Only the passage's first part is on this page.
  const mark = page
    .locator(
      '[data-reader-spread-layer="current"] mark[data-highlight-id="across-pages"]',
    )
    .first();
  await expect(mark).toBeVisible();
  await expect(
    page.locator('[data-reader-spread-layer="current"]'),
  ).not.toContainText(to);
  await mark.tap();
  const copy = page.getByRole("button", { name: "Copy text", exact: true });
  await copy.tap();
  await expect.poll(clipboard).toBe(passage);
  await expect(
    page.getByRole("status").filter({ hasText: "Copied to clipboard" }),
  ).toHaveCount(1);

  // Once noted, the highlight opens its note card, whose Copy still writes
  // the passage rather than the note.
  await page.getByRole("button", { name: "Add note" }).tap();
  await page
    .getByRole("textbox", { name: "Write a note" })
    .fill("A note, not the passage.");
  await page.getByRole("button", { name: "Save note", exact: true }).tap();
  await expect(page.locator("[data-notes-island]")).toHaveCount(0);
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await mark.tap();
  const note = page.getByRole("region", { name: "Note", exact: true });
  await expect(note).toContainText("A note, not the passage.");
  await note.getByRole("button", { name: "Copy text", exact: true }).tap();
  await expect.poll(clipboard).toBe(passage);
  await expect(
    note.getByRole("status").filter({ hasText: "Copied to clipboard" }),
  ).toHaveCount(1);

  // A fresh selection offers the same Copy, beside its colours.
  await page.touchscreen.tap(195, 120);
  await expect(page.locator("[data-notes-island]")).toHaveCount(0);
  await selectPassage(page);
  const selected = await page.evaluate(() => getSelection()!.toString());
  await copy.tap();
  await expect.poll(clipboard).toBe(selected.replace(/\s+/g, " ").trim());
});

test("tapping a highlight and closing its tools moves nothing on the page", async ({
  page,
  localBook,
}) => {
  await openLocalBook(page, localBook.id);
  for (let i = 0; i < 8; i++) await nextSpread(page);
  await selectPassage(page, 1);
  await page.getByRole("button", { name: "Highlight with yellow" }).tap();
  const island = page.locator("[data-notes-island]");
  await expect(island).toHaveCount(0);
  // Where the start of each line of text sits.
  const words = () =>
    page.evaluate(() => {
      const root = document.querySelector(
        '[data-reader-spread-layer="current"]',
      )!;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const points: number[][] = [];
      while (walker.nextNode()) {
        const node = walker.currentNode as Text;
        if (node.length < 2) continue;
        const range = document.createRange();
        range.setStart(node, 0);
        range.setEnd(node, 2);
        const rect = range.getBoundingClientRect();
        points.push([rect.x, rect.y]);
      }
      return points;
    });
  const expectInPlace = (now: number[][], before: number[][]) => {
    expect(now).toHaveLength(before.length);
    now.forEach(([x, y], index) => {
      expect(Math.abs(x! - before[index]![0]!)).toBeLessThan(1);
      expect(Math.abs(y! - before[index]![1]!)).toBeLessThan(1);
    });
  };
  // The browser reports any box that moves without being dragged.
  await page.evaluate(() => {
    const shifts: string[] = [];
    (window as unknown as { shifts: string[] }).shifts = shifts;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as {
        sources: { node?: Node }[];
      }[])
        for (const source of entry.sources)
          shifts.push(source.node?.nodeName ?? "?");
    }).observe({ type: "layout-shift" });
  });
  const before = await words();
  const mark = page
    .locator('[data-reader-spread-layer="current"] mark[data-color="yellow"]')
    .first();
  const box = (await mark.boundingBox())!;
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('[data-notes-island="tools"]')).toBeVisible();
  await expect
    .poll(() =>
      island.evaluate(
        (element) =>
          element.getAnimations({ subtree: true }).length === 0 &&
          getComputedStyle(element).opacity === "1",
      ),
    )
    .toBe(true);
  expectInPlace(await words(), before);

  // A tap on plain text below the highlight closes the tools.
  await page.touchscreen.tap(195, box.y + box.height + 160);
  await expect(island).toHaveCount(0);
  expectInPlace(await words(), before);
  expect(
    await page.evaluate(
      () => (window as unknown as { shifts: string[] }).shifts,
    ),
  ).toEqual([]);
});
