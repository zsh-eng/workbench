import type { Locator, Page } from "@playwright/test";
import {
  test,
  expect,
  openLocalBook,
  waitForReaderReady,
  nextSpread,
  currentPages,
  showNotesCapsule,
  openReaderTools,
  waitForSheet,
} from "./helpers/fixtures";

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});

test("captures thoughts over a stable book and browses both notebook orders", async ({
  page,
  localBook,
}) => {
  await openLocalBook(page, localBook.id);
  await page
    .getByRole("button", { name: "Mark as reading", exact: true })
    .click();
  for (let pageIndex = 0; pageIndex < 8; pageIndex++) await nextSpread(page);
  await waitForReaderReady(page);
  const spread = page.locator('[data-reader-spread-layer="current"]');
  const bounds = await spread.boundingBox();
  if (!bounds) throw new Error("No reading spread");
  if (!(await page.getByRole("button", { name: "Jot a note" }).isVisible())) {
    await page.touchscreen.tap(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2,
    );
  }
  await page.getByRole("button", { name: "Jot a note" }).click();
  const before = await currentPages(page);
  const stage = page.locator('[data-reader-stage-slot="content"]');
  const stageBefore = await stage.boundingBox();
  const input = page.getByRole("textbox", { name: "Write a note" });
  await expect(input).toBeFocused();
  // An empty or blank note offers nothing to save.
  const save = page.getByRole("button", { name: "Save note", exact: true });
  await expect(save).toHaveCount(0);
  await input.fill("  ");
  await expect(save).toHaveCount(0);
  await input.fill("A");
  await expect(save).toBeEnabled();
  await input.fill("");
  await expect(save).toHaveCount(0);
  // The composer rides above the phone keyboard. Emulate the viewport
  // signal, not an actual iOS keyboard.
  const composer = page.locator("[data-note-composer]");
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport!, "height", {
      configurable: true,
      value: window.innerHeight - 300,
    });
    Object.defineProperty(window.visualViewport!, "offsetTop", {
      configurable: true,
      value: 40,
    });
    window.visualViewport!.dispatchEvent(new Event("resize"));
    window.visualViewport!.dispatchEvent(new Event("scroll"));
  });
  await expect
    .poll(() =>
      composer.evaluate(
        (element) =>
          element.getBoundingClientRect().bottom -
          window.visualViewport!.offsetTop -
          window.visualViewport!.height,
      ),
    )
    .toBeLessThanOrEqual(1);
  await page.evaluate(() => {
    delete (window.visualViewport as unknown as { height?: number }).height;
    delete (window.visualViewport as unknown as { offsetTop?: number })
      .offsetTop;
    window.visualViewport!.dispatchEvent(new Event("resize"));
  });
  await input.fill(
    "How easily curiosity becomes courage.\nAlice follows the rabbit before she knows where it leads.\nIs the uncertainty part of the invitation?",
  );
  expect(await currentPages(page)).toEqual(before);
  expect(await stage.boundingBox()).toEqual(stageBefore);
  await page.context().setOffline(true);
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(input).not.toBeVisible();
  await expect(page.getByRole("status")).toContainText("Saved to notebook");
  await page.context().setOffline(false);
  expect(await currentPages(page)).toEqual(before);
  // Saving returns to plain reading; the chrome comes back with a tap.
  await showNotesCapsule(page);
  await page.getByRole("button", { name: "Jot a note" }).click();
  await input.fill("Return to this idea later.");
  await page.touchscreen.tap(
    bounds.x + bounds.width * 0.9,
    bounds.y + bounds.height * 0.3,
  );
  await expect(input).not.toBeVisible();
  expect(await currentPages(page)).toEqual(before);
  // Chrome remains visible after leaving note capture; the capsule offers the draft.
  await page.getByRole("button", { name: "Continue draft" }).click();
  await expect(input).toHaveValue("Return to this idea later.");
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(input).not.toBeVisible();
  await showNotesCapsule(page);
  await page.getByRole("button", { name: "Open notebook" }).click();
  await expect(
    page.getByRole("region", { name: "Book notebook" }),
  ).toContainText("Notebook 2");
  await page.getByRole("button", { name: "Notebook order" }).click();
  await page.getByRole("menuitemradio", { name: "By chapter" }).click();
  await expect(
    page.getByText("Return to this idea later.", { exact: true }),
  ).toBeVisible();
  const sheet = page.getByRole("dialog", { name: "Notebook", exact: true });
  await expect(
    sheet.getByRole("textbox", { name: "Write a note" }),
  ).toBeVisible();
  await expect(input).toHaveCount(1);
  await input.fill("A thought from the notebook.");
  await sheet.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(
    sheet.getByText("A thought from the notebook.", { exact: true }),
  ).toBeVisible();
  await expect(input).toHaveValue("");
  await input.fill("Keep this draft.");
  await sheet.getByRole("button", { name: "Close notebook" }).click();
  await expect(sheet).not.toBeVisible();
  // Closing the notebook returns to reading; the draft waits in the capsule.
  await expect(input).toHaveCount(0);
  await showNotesCapsule(page);
  await expect(
    page.getByRole("button", { name: "Continue draft" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(async (path) => {
        const { syncV2Db: db } = await import(path);
        return (await db.noteDrafts.toArray())[0]?.content;
      }, "/src/lib/sync-v2/db.ts"),
    )
    .toBe("Keep this draft.");
  await page.reload();
  await waitForReaderReady(page);
  const reloadedSpread = await page
    .locator('[data-reader-spread-layer="current"]')
    .boundingBox();
  await page.touchscreen.tap(
    reloadedSpread!.x + reloadedSpread!.width / 2,
    reloadedSpread!.y + reloadedSpread!.height / 2,
  );
  await page.getByRole("button", { name: "Continue draft" }).click();
  await expect(input).toHaveValue("Keep this draft.");
  await input.press("Escape");
  const tools = await openReaderTools(page);
  await tools.getByRole("button", { name: "Notebook", exact: true }).click();
  await waitForSheet(page, "Notebook");
  await expect(
    page.getByRole("region", { name: "Book notebook" }),
  ).toContainText("A thought from the notebook.");
  await expect
    .poll(() =>
      page.evaluate(async (path) => {
        const { syncV2Db: db } = await import(path);
        return (await db.notes.toArray()).filter(
          (note: { isDeleted: boolean }) => !note.isDeleted,
        ).length;
      }, "/src/lib/sync-v2/db.ts"),
    )
    .toBe(3);
  await page.setViewportSize({ width: 430, height: 844 });
  await waitForReaderReady(page);
  const firstLocation = page
    .getByRole("region", { name: "Book notebook" })
    .getByRole("button", { name: /p\. \d+/ })
    .first();
  await expect(firstLocation).toBeEnabled();
  await firstLocation.click();
  await waitForReaderReady(page);
  const expectedPassage = await page.evaluate(async (path) => {
    const { syncV2Db: db } = await import(path);
    const notes = await db.notes.orderBy("createdAt").toArray();
    return notes[0].anchor.textAfter.trim().replace(/\s+/g, " ");
  }, "/src/lib/sync-v2/db.ts");
  await expect(
    page.locator('[data-reader-spread-layer="current"]'),
  ).toContainText(expectedPassage);
});

/** Selects a short passage on the current spread and asks for a note on it.
 * "line" starts inside the first long line of the spread. "page-start" starts
 * at the first character of the spread's first page. "lower" starts in the
 * lower half of the window. Returns the passage's viewport top. */
async function openSelectionNote(
  page: Page,
  start: "line" | "page-start" | "lower" = "line",
) {
  const selected = await page.evaluate((start) => {
    const spread = document.querySelector(
      '[data-reader-spread-layer="current"]',
    )!;
    const root =
      start === "page-start"
        ? spread.querySelector("[data-reader-page-content]")!
        : spread;
    const usable = (node: Node) => {
      const length = node.textContent?.trim().length ?? 0;
      if (start === "line") return length >= 30;
      if (start === "page-start") return length > 0;
      // Above the lowest top that the margin column can take.
      const top = node.parentElement!.getBoundingClientRect().top;
      return length > 0 && top > innerHeight / 2 && top < innerHeight - 260;
    };
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && !usable(node)) node = walker.nextNode();
    if (!node) throw new Error("No passage to select");
    const range = document.createRange();
    const from = start === "line" ? 5 : node.textContent!.search(/\S/);
    range.setStart(node, from);
    // The passage can cross fragments, so count 25 characters across nodes.
    let remaining = 25;
    let end: Node | null = node;
    let offset = from;
    while (end) {
      const available = end.textContent!.length - offset;
      if (available >= remaining) {
        range.setEnd(end, offset + remaining);
        break;
      }
      remaining -= available;
      end = walker.nextNode();
      offset = 0;
    }
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    // A selection reports rendered line breaks; compare words only.
    const text = range.toString().replace(/\s+/g, " ");
    return { text, top: range.getClientRects()[0].top };
  }, start);
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.getSelection()?.toString().replace(/\s+/g, " "),
      ),
    )
    .toBe(selected.text);
  await page.evaluate(() =>
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true })),
  );
  await expect(
    page.getByRole("button", { name: "Note on highlight" }),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "Note on highlight" }).click();
  return selected.top;
}

/** Margin UI must stay beside the text columns of the current spread. */
async function expectClearOfText(target: Locator) {
  const overlaps = await target.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return [
      ...document.querySelectorAll(
        '[data-reader-spread-layer="current"] [data-reader-page-content]',
      ),
    ]
      .map((column) => column.getBoundingClientRect())
      .filter(
        (column) =>
          box.left < column.right &&
          column.left < box.right &&
          box.top < column.bottom &&
          column.top < box.bottom,
      )
      .map(
        (column) =>
          `${Math.round(box.left)}-${Math.round(box.right)} over text at ${Math.round(column.left)}-${Math.round(column.right)}`,
      );
  });
  expect(overlaps).toEqual([]);
}

test.describe("Desktop margin notes", () => {
  test.use({
    viewport: { width: 1800, height: 1000 },
    hasTouch: false,
    isMobile: false,
  });
  test("remembers the sidebar tab after close and reload", async ({
    page,
    localBook,
  }) => {
    await openLocalBook(page, localBook.id);
    await page.mouse.move(600, 20);
    await page
      .getByRole("button", { name: "Open reader tools", exact: true })
      .click();
    const tools = page.getByRole("complementary", {
      name: "Reader tools",
      exact: true,
    });
    await tools.getByRole("button", { name: "Notebook", exact: true }).click();
    const noteInput = tools.getByRole("textbox", { name: "Write a note" });
    await expect(noteInput).toBeFocused();
    const headerTrigger = page.locator(
      'button[aria-label="Open reader tools"]',
    );
    const closeTrigger = tools
      .getByRole("button", { name: "Close reader tools", exact: true })
      .last();
    await expect(headerTrigger).toHaveAttribute("aria-pressed", "true");
    await expect(closeTrigger).toHaveAttribute("aria-pressed", "true");
    await noteInput.fill("A note for the notebook.");
    await tools.getByRole("button", { name: "Save note", exact: true }).click();
    const heading = tools.getByRole("heading", {
      name: "Notebook 1",
      exact: true,
    });
    await expect(heading).toBeVisible();
    await noteInput.fill("Keep this desktop draft.");
    await tools
      .getByRole("button", { name: "Close reader tools", exact: true })
      .last()
      .click();
    const closingSidebar = page.locator('aside[aria-label="Reader tools"]');
    await expect(closingSidebar).toHaveAttribute("aria-hidden", "true");
    await expect(headerTrigger).toHaveAttribute("aria-pressed", "false");

    await page.mouse.move(600, 20);
    await page
      .getByRole("button", { name: "Open reader tools", exact: true })
      .click();
    await expect(
      tools.getByRole("button", { name: "Notebook", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(noteInput).toBeFocused();
    await page.reload();
    await waitForReaderReady(page);
    await page.mouse.move(600, 20);
    await page
      .getByRole("button", { name: "Open reader tools", exact: true })
      .click();
    await expect(
      tools.getByRole("button", { name: "Notebook", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(noteInput).toBeFocused();
    await expect(noteInput).toHaveValue("Keep this desktop draft.");
    // Match the emulated browser platform, which can differ from the test host.
    const modifier = await page.evaluate(() =>
      /Mac/i.test(navigator.platform) ? "Meta" : "Control",
    );
    // The global toggle must also work while the notebook input has focus.
    await page.keyboard.press(`${modifier}+Shift+Backslash`);
    await expect(closingSidebar).toHaveAttribute("aria-hidden", "true");
    await page.keyboard.press(`${modifier}+Shift+Backslash`);
    await expect(noteInput).toBeFocused();
    await expect(noteInput).toHaveValue("Keep this desktop draft.");
    await expect(closeTrigger).toHaveAttribute("aria-pressed", "true");
    await expect(headerTrigger).toHaveAttribute("aria-pressed", "true");
  });
  test("captures a margin note without resizing the book", async ({
    page,
    localBook,
  }) => {
    // The rail needs a page margin wider than 1800 px windows have.
    await page.setViewportSize({ width: 2048, height: 1000 });
    await openLocalBook(page, localBook.id);
    const stage = page.locator('[data-reader-stage-slot="content"]');
    const before = await stage.boundingBox();
    for (let index = 0; index < 8; index++) await nextSpread(page);
    const anchorPages = await currentPages(page);
    await page.keyboard.press("n");
    await expect(
      page.getByRole("textbox", { name: "Write a note" }),
    ).not.toBeVisible();
    await openSelectionNote(page);
    const panel = page.locator("[data-note-composer]");
    await expect(panel).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Book notebook" }),
    ).toHaveCount(0);
    await page
      .getByRole("textbox", { name: "Write a note" })
      .fill("A thought from the margin");
    await expectClearOfText(panel);
    await page.getByRole("button", { name: "Save note", exact: true }).click();
    await expect(
      page.getByRole("textbox", { name: "Write a note" }),
    ).not.toBeVisible();
    await expect(
      page.getByRole("complementary", { name: "Page margin notes" }),
    ).toContainText("A thought from the margin");
    const savedNote = page.locator("[data-margin-note]");
    await expect(savedNote).toBeVisible();
    const savedBounds = (await savedNote.boundingBox())!;
    await expectClearOfText(savedNote);
    await openSelectionNote(page);
    await expect(savedNote).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Open notebook", exact: true }),
    ).toHaveCount(0);
    expect((await panel.boundingBox())!.y).toBeGreaterThanOrEqual(
      savedBounds.y + savedBounds.height,
    );
    await page
      .getByRole("textbox", { name: "Write a note" })
      .fill("A second thought");
    await page.getByRole("button", { name: "Save note", exact: true }).click();
    await expect(savedNote).toHaveCount(2);

    expect(await stage.boundingBox()).toEqual(before);
    expect(await currentPages(page)).toEqual(anchorPages);
    await nextSpread(page);
    const notebookPages = await currentPages(page);
    // A margin note sits beside its passage, not at the top of the margin.
    const passageTop = await openSelectionNote(page, "lower");
    await page
      .getByRole("textbox", { name: "Write a note" })
      .fill("A thought lower on the page");
    await page.getByRole("button", { name: "Save note", exact: true }).click();
    const lowerNote = page
      .locator("[data-margin-note]")
      .filter({ hasText: "A thought lower on the page" });
    await expect(lowerNote).toBeVisible();
    // Saving adds the passage's highlight, and the chapter is laid out again.
    await expect(
      page.locator('[data-reader-spread-layer="current"] mark.epub-highlight'),
    ).not.toHaveCount(0);
    await waitForReaderReady(page);
    await expect
      .poll(async () =>
        Math.abs((await lowerNote.boundingBox())!.y - passageTop),
      )
      .toBeLessThan(2);
    await expectClearOfText(lowerNote);
    await page.mouse.move(600, 20);
    await page
      .getByRole("button", { name: "Open reader tools", exact: true })
      .click();
    const tools = page.getByRole("complementary", {
      name: "Reader tools",
      exact: true,
    });
    await tools.getByRole("button", { name: "Notebook", exact: true }).click();
    await expect(
      tools.getByRole("button", { name: "Notebook", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    const notebook = tools.getByRole("region", { name: "Book notebook" });
    await tools
      .getByRole("textbox", { name: "Write a note" })
      .fill("Written directly in the notebook");
    await tools.getByRole("button", { name: "Save note", exact: true }).click();
    const sidebarNote = notebook
      .locator("article")
      .filter({ hasText: "Written directly in the notebook" });
    await expect(
      sidebarNote.getByRole("button", { name: /p\./ }),
    ).toContainText(`p. ${notebookPages[0]}`);

    await expect(notebook).toContainText("A thought from the margin");
    await expect(
      tools.getByRole("button", { name: "Open notebook", exact: true }),
    ).toHaveCount(0);
    await tools.getByRole("button", { name: "Contents", exact: true }).click();
    await expect(notebook).not.toBeVisible();
    await tools.getByRole("button", { name: "Notebook", exact: true }).click();
    await expect(notebook).toContainText("A thought from the margin");
    await expect(
      tools.getByRole("button", { name: "Open notebook", exact: true }),
    ).toHaveCount(0);
    expect(await stage.boundingBox()).toEqual(before);
  });
  test("keeps a note on the page where its passage starts", async ({
    page,
    localBook,
  }) => {
    await page.setViewportSize({ width: 2048, height: 1000 });
    await openLocalBook(page, localBook.id);
    // Find a spread whose first page opens inside a paragraph from the page
    // before: its first text does not start at offset 0:0:0 of its block.
    const firstOffset = () =>
      page.evaluate(
        () =>
          document
            .querySelector(
              '[data-reader-spread-layer="current"] [data-reader-page-content]',
            )
            ?.querySelector("[data-content-anchor-start]")
            ?.getAttribute("data-content-anchor-start") ?? "0:0:0",
      );
    for (let spread = 0; (await firstOffset()) === "0:0:0"; spread++) {
      expect(spread, "a page that continues a paragraph").toBeLessThan(20);
      await nextSpread(page);
    }
    const pages = await currentPages(page);
    await openSelectionNote(page, "page-start");
    await page
      .getByRole("textbox", { name: "Write a note" })
      .fill("A thought at the top of the page");
    await page.getByRole("button", { name: "Save note", exact: true }).click();
    // Saving adds the passage's highlight, so its chapter is laid out again.
    const savedNote = page
      .locator("[data-margin-note]")
      .filter({ hasText: "A thought at the top of the page" });
    await expect(savedNote).toBeVisible();
    await expect(page.locator("mark.epub-highlight")).not.toHaveCount(0);
    await waitForReaderReady(page);
    await expect(savedNote).toBeVisible();
    expect(await currentPages(page)).toEqual(pages);

    await page.mouse.move(600, 20);
    await page
      .getByRole("button", { name: "Open reader tools", exact: true })
      .click();
    const tools = page.getByRole("complementary", {
      name: "Reader tools",
      exact: true,
    });
    await tools.getByRole("button", { name: "Notebook", exact: true }).click();
    await expect(
      tools
        .getByRole("region", { name: "Book notebook" })
        .locator("article")
        .filter({ hasText: "A thought at the top of the page" })
        .getByRole("button", { name: /p\./ }),
    ).toContainText(`p. ${pages[0]}`);
  });
  test("opens a note in the notebook when the page margin is narrow", async ({
    page,
    localBook,
  }) => {
    // A 56 px page margin: no room for a composer beside the text.
    await page.setViewportSize({ width: 1280, height: 800 });
    await openLocalBook(page, localBook.id);
    for (let index = 0; index < 8; index++) await nextSpread(page);
    await openSelectionNote(page);
    await expect(
      page.getByRole("textbox", { name: "Write a note" }),
    ).toBeFocused();
    // No margin composer may cover the text; this margin has room for none.
    const composers = page.locator("[data-note-composer]");
    for (const composer of await composers.all())
      await expectClearOfText(composer);
    await expect(composers).toHaveCount(0);
    const sidebar = page.locator('aside[aria-label="Reader tools"]');
    await expect(sidebar).toHaveAttribute("aria-hidden", "false");
    await expect(
      sidebar.getByRole("button", { name: "Notebook", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    const input = sidebar.getByRole("textbox", { name: "Write a note" });
    await expect(input).toBeFocused();
    await expect(sidebar.getByTestId("note-quote")).toBeVisible();
    await input.fill("A thought kept in the notebook");
    await sidebar
      .getByRole("button", { name: "Save note", exact: true })
      .click();
    await expect(
      sidebar.getByRole("region", { name: "Book notebook" }),
    ).toContainText("A thought kept in the notebook");
    await input.press("Escape");
    await expect(sidebar).toHaveAttribute("aria-hidden", "true");

    const count = page.getByRole("button", { name: "Read margin notes" });
    await expect(count).toBeVisible();
    await expectClearOfText(count);
    await count.click();
    await expect(sidebar).toHaveAttribute("aria-hidden", "false");
    await expect(input).toBeFocused();
    await sidebar
      .getByRole("button", { name: "Close reader tools", exact: true })
      .last()
      .click();
    await expect(sidebar).toHaveAttribute("aria-hidden", "true");
    // Closing returns to reading; the notebook must not open again.
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    await expect(sidebar).toHaveAttribute("aria-hidden", "true");
    await expect(count).toBeVisible();
    await expect(page.locator("[data-note-composer]")).toHaveCount(0);
  });
});

test.describe("Highlight note capture", () => {
  test.use({
    viewport: { width: 900, height: 900 },
    hasTouch: false,
    isMobile: false,
  });
  test("quotes a highlight in the notebook when the page margin is narrow", async ({
    page,
    localBook,
  }) => {
    await openLocalBook(page, localBook.id);
    await page
      .getByRole("button", { name: "Mark as reading", exact: true })
      .click();
    for (let index = 0; index < 8; index++) await nextSpread(page);
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
      let remaining = 300;
      while (node && (node.textContent?.length ?? 0) < remaining) {
        remaining -= node.textContent?.length ?? 0;
        node = walker.nextNode();
      }
      if (!node) throw new Error("No long passage to select");
      range.setEnd(node, remaining);
      window.getSelection()!.removeAllRanges();
      window.getSelection()!.addRange(range);
    });
    await expect
      .poll(() => page.evaluate(() => window.getSelection()?.toString().length))
      .toBe(300);
    await page.evaluate(() =>
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true })),
    );
    await page.getByRole("button", { name: "Highlight with yellow" }).click();
    const highlight = page
      .locator('[data-reader-spread-layer="current"] [data-highlight-id]')
      .first();
    await highlight.click();
    await expect(
      page.getByRole("button", { name: "Note on highlight" }),
    ).toHaveCount(1);
    await page.getByRole("button", { name: "Note on highlight" }).click();
    // A 110 px page margin has no room for a composer beside the text, so
    // the note opens in the notebook.
    const quote = page.getByTestId("note-quote");
    await expect(quote).toBeVisible();
    await expect(page.locator("[data-note-composer]")).toHaveCount(0);
    await expect(
      page.getByRole("textbox", { name: "Write a note" }),
    ).toBeFocused();
    const quotedText = await quote.locator("span").textContent();
    await page
      .getByRole("textbox", { name: "Write a note" })
      .fill("This passage is worth revisiting.");
    await page.getByRole("button", { name: "Remove quote" }).click();
    await expect(quote).not.toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "Write a note" }),
    ).toHaveValue("This passage is worth revisiting.");
    // Escape returns to reading and keeps the draft for the next passage.
    await page.getByRole("textbox", { name: "Write a note" }).press("Escape");
    await highlight.click();
    await expect(
      page.getByRole("button", { name: "Note on highlight" }),
    ).toHaveCount(1);
    await page.getByRole("button", { name: "Note on highlight" }).click();
    await expect(quote).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "Write a note" }),
    ).toHaveValue("This passage is worth revisiting.");

    await page.getByRole("button", { name: "Save note", exact: true }).click();
    await expect(quote).not.toBeVisible();
    await page.getByRole("textbox", { name: "Write a note" }).press("Escape");
    await highlight.click();
    await expect(
      page.getByRole("button", { name: "Note on highlight" }),
    ).toHaveCount(1);
    await page.getByRole("button", { name: "Note on highlight" }).click();
    await expect(quote).toBeVisible();
    // The saved note's quote. The highlight's own entry may still be leaving
    // the open notebook.
    const savedNote = page
      .getByRole("region", { name: "Book notebook" })
      .locator('[aria-label^="Note;"]');
    const fullQuote = savedNote.locator("blockquote");
    await expect(fullQuote).toHaveText(quotedText!);
    // The saved note's quote wraps inside the notebook instead of overflowing.
    expect(
      await fullQuote.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    await savedNote.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
    const editor = page.getByRole("textbox", {
      name: "Edit note",
      exact: true,
    });
    await expect(editor).toHaveValue("This passage is worth revisiting.");
    await expect(fullQuote).toHaveText(quotedText!);
    // The pending composer quote stays separate from the note being edited.
    await expect(page.getByTestId("note-quote")).toContainText(quotedText!);
    await expect(
      page.locator("[data-note-input-surface] textarea"),
    ).toHaveValue("");
    await expect(
      fullQuote
        .locator("..")
        .getByRole("textbox", { name: "Edit note", exact: true }),
    ).toBeFocused();
    await editor.fill("A revised reading of this passage.");
    await editor.press("Control+Enter");
    await expect(
      page.getByRole("textbox", { name: "Write a note" }),
    ).toHaveValue("");
    await expect(
      page.getByRole("region", { name: "Book notebook" }),
    ).toContainText("A revised reading of this passage.");
    await expect(fullQuote).toHaveText(quotedText!);
  });
});

test("swipes to edit without losing the compose draft or changing the note anchor", async ({
  page,
  localBook,
}) => {
  await openLocalBook(page, localBook.id);
  await page
    .getByRole("button", { name: "Mark as reading", exact: true })
    .click();
  for (let i = 0; i < 8; i++) await nextSpread(page);
  await waitForReaderReady(page);
  const spread = page.locator('[data-reader-spread-layer="current"]');
  const bounds = (await spread.boundingBox())!;
  const trigger = page.getByRole("button", { name: "Jot a note" });
  if (!(await trigger.isVisible()))
    await page.touchscreen.tap(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2,
    );
  await trigger.click();
  const compose = page.getByRole("textbox", { name: "Write a note" });
  await compose.fill("The original thought.");
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(compose).not.toBeVisible();
  await showNotesCapsule(page);
  await trigger.click();
  await expect(compose).toHaveValue("");
  const readNotes = () =>
    page.evaluate(async (path) => {
      const { syncV2Db: db } = await import(path);
      return (await db.notes.toArray()).filter(
        (note: { isDeleted?: boolean }) => !note.isDeleted,
      );
    }, "/src/lib/sync-v2/db.ts");
  const original = (await readNotes())[0];
  await compose.fill("Keep my next thought.");
  await compose.press("Escape");
  await showNotesCapsule(page);
  await page.getByRole("button", { name: "Open notebook" }).click();
  const row = page.locator(`[data-note-id="${original.id}"]`);
  const notebookList = row.locator("..");
  async function expectNoHorizontalOverflow() {
    expect(
      await notebookList.evaluate(
        (element) => element.scrollWidth - element.clientWidth,
      ),
    ).toBe(0);
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBe(0);
  }
  await expectNoHorizontalOverflow();
  const cdp = await page.context().newCDPSession(page);
  async function drag(distances: number[], cancel = false) {
    const rect = (await row.locator("article").boundingBox())!;
    const x = rect.x + rect.width * 0.75;
    const y = rect.y + 20;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y }],
    });
    for (const distance of distances) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: x - distance, y }],
      });
    }
    if (distances.at(-1)! >= 72)
      await expect(row.locator("[data-swipe-ready=true]")).toBeVisible();
    else await expect(row.locator("[data-swipe-ready=true]")).toHaveCount(0);
    await expectNoHorizontalOverflow();
    await cdp.send("Input.dispatchTouchEvent", {
      type: cancel ? "touchCancel" : "touchEnd",
      touchPoints: [],
    });
  }
  await drag([12, 30]);
  await expect(compose).toHaveValue("Keep my next thought.");
  await drag([12, 40, 85, 30]);
  await expect(compose).toHaveValue("Keep my next thought.");
  await drag([12, 40, 85], true);
  await expect(compose).toHaveValue("Keep my next thought.");
  await drag([12, 40, 85]);
  const editor = page.getByRole("textbox", { name: "Edit note", exact: true });
  await expect(editor).toHaveValue("The original thought.");
  await expect(page.getByText("Editing note", { exact: true })).toBeVisible();
  await editor.fill("   ");
  await expect(
    page.locator('button[aria-label="Save changes"]'),
  ).toBeDisabled();
  await editor.fill("The revised thought.");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(compose).toHaveValue("Keep my next thought.");
  await expect(row).toContainText("The revised thought.");
  const saved = await readNotes();
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({
    id: original.id,
    anchor: original.anchor,
    createdAt: original.createdAt,
    content: "The revised thought.",
  });
  await row.locator("article").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit note" }).click();
  await expect(editor).toHaveValue("The revised thought.");
  await editor.fill("Discard this edit.");
  await page.getByRole("button", { name: "Cancel editing" }).click();
  await expect(compose).toHaveValue("Keep my next thought.");
  expect((await readNotes())[0].content).toBe("The revised thought.");
  await expect
    .poll(() =>
      page.evaluate(async (path) => {
        const { syncV2Db: db } = await import(path);
        return (await db.noteDrafts.toArray()).map(
          (draft: { content: string; purpose: string }) => ({
            content: draft.content,
            purpose: draft.purpose,
          }),
        );
      }, "/src/lib/sync-v2/db.ts"),
    )
    .toEqual([{ content: "Keep my next thought.", purpose: "create" }]);
  await expect(page.getByRole("menuitem", { name: "Edit note" })).toBeHidden();
  // Long press provides the same action without requiring a swipe.
  const rect = (await row.locator("article").boundingBox())!;
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: rect.x + rect.width / 2, y: rect.y + 20 }],
  });
  await expect(
    page
      .locator('[data-slot="context-menu-content"]')
      .getByRole("menuitem", { name: "Edit note" }),
  ).toBeVisible();
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await page
    .locator('[data-slot="context-menu-content"]')
    .getByRole("menuitem", { name: "Edit note" })
    .click();
  await expect(editor).toHaveValue("The revised thought.");
  await editor.fill("Resume this edit.");
  await expect
    .poll(() =>
      page.evaluate(async (path) => {
        const { syncV2Db: db } = await import(path);
        return (await db.noteDrafts.toArray()).find(
          (draft: { purpose: string }) => draft.purpose === "edit",
        )?.content;
      }, "/src/lib/sync-v2/db.ts"),
    )
    .toBe("Resume this edit.");
  await page.reload();
  await waitForReaderReady(page);
  // The first spread can be ready before loading chrome finishes its exit.
  // Wait before deciding whether the footer needs to be revealed by a tap.
  await expect(
    page.locator("[data-notes-capsule] button:disabled"),
  ).toHaveCount(0);
  await showNotesCapsule(page);
  await page.getByRole("button", { name: "Continue draft" }).click();
  await expect(compose).toHaveValue("Keep my next thought.");
  await compose.press("Escape");
  await showNotesCapsule(page);
  await page.getByRole("button", { name: "Open notebook" }).click();
  await row.locator("article").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit note" }).click();
  await expect(editor).toHaveValue("Resume this edit.");
  // A received edit must not be overwritten by this stale edit draft.
  await page.evaluate(
    async ({ path, id }) => {
      const { updateNote } = await import(path);
      await updateNote(id, "Changed elsewhere.");
    },
    { path: "/src/data/notes.ts", id: original.id },
  );
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "changed on another device",
  );
  await expect(editor).toHaveValue("Resume this edit.");
  expect((await readNotes())[0].content).toBe("Changed elsewhere.");
  await page.getByRole("button", { name: "Cancel editing" }).click();
  await expect(compose).toHaveValue("Keep my next thought.");
  await cdp.detach();
});

test("keeps the mobile draft and its full height between the island and the notebook", async ({
  page,
  localBook,
}) => {
  await openLocalBook(page, localBook.id);
  await page
    .getByRole("button", { name: "Mark as reading", exact: true })
    .click();
  for (let i = 0; i < 8; i++) await nextSpread(page);
  await waitForReaderReady(page);
  const spread = page.locator('[data-reader-spread-layer="current"]');
  const trigger = page.getByRole("button", { name: "Jot a note" });
  if (!(await trigger.isVisible())) {
    const bounds = (await spread.boundingBox())!;
    await page.touchscreen.tap(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2,
    );
  }
  await trigger.click();
  const text =
    "First line of my thought.\nThe next part is here.\nA third line to remember.";
  const input = page.getByRole("textbox", { name: "Write a note" });
  await input.fill(text);
  await input.press("Escape");
  await showNotesCapsule(page);
  await page.getByRole("button", { name: "Open notebook" }).click();
  const sheet = page.getByRole("dialog", { name: "Notebook", exact: true });
  const sheetInput = sheet.getByRole("textbox", { name: "Write a note" });
  /** The field grows to show every line instead of scrolling inside. */
  const showsEveryLine = () =>
    sheetInput.evaluate(
      (element) => element.scrollHeight <= element.clientHeight + 1,
    );
  await expect(sheetInput).toHaveValue(text);
  await expect.poll(showsEveryLine).toBe(true);
  const threeLines = (await sheetInput.boundingBox())!.height;
  await sheetInput.fill(`${text}\nWritten in the notebook.`);
  await expect
    .poll(async () => (await sheetInput.boundingBox())!.height)
    .toBeGreaterThan(threeLines);
  await expect.poll(showsEveryLine).toBe(true);
  await sheet.getByRole("button", { name: "Close notebook" }).click();
  await expect(sheet).not.toBeVisible();
  await showNotesCapsule(page);
  await page.getByRole("button", { name: "Continue draft" }).click();
  await expect(input).toHaveValue(`${text}\nWritten in the notebook.`);
  await input.fill("Now a shorter thought.");
  await input.press("Escape");
  await showNotesCapsule(page);
  await page.getByRole("button", { name: "Open notebook" }).click();
  await expect(sheetInput).toHaveValue("Now a shorter thought.");
  await expect
    .poll(async () => (await sheetInput.boundingBox())!.height)
    .toBeLessThan(threeLines);
});

test("swipes right to delete and undo while keeping the compose draft", async ({
  page,
  localBook,
}) => {
  await openLocalBook(page, localBook.id);
  await page
    .getByRole("button", { name: "Mark as reading", exact: true })
    .click();
  for (let i = 0; i < 8; i++) await nextSpread(page);
  await waitForReaderReady(page);
  const trigger = page.getByRole("button", { name: "Jot a note" });
  if (!(await trigger.isVisible())) {
    const rect = (await page
      .locator('[data-reader-spread-layer="current"]')
      .boundingBox())!;
    await page.touchscreen.tap(
      rect.x + rect.width / 2,
      rect.y + rect.height / 2,
    );
  }
  await trigger.click();
  const compose = page.getByRole("textbox", { name: "Write a note" });
  await compose.fill("A thought to delete.");
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(compose).not.toBeVisible();
  await showNotesCapsule(page);
  await trigger.click();
  await expect(compose).toHaveValue("");
  const readNotes = () =>
    page.evaluate(async (path) => {
      const { syncV2Db: db } = await import(path);
      return db.notes.toArray();
    }, "/src/lib/sync-v2/db.ts");
  const original = (await readNotes())[0];
  await compose.fill("Keep this draft.");
  await compose.press("Escape");
  await showNotesCapsule(page);
  await page.getByRole("button", { name: "Open notebook" }).click();
  await expect(page.getByRole("button", { name: "Note actions" })).toHaveCount(
    0,
  );
  const row = page.locator(`[data-note-id="${original.id}"]`);
  const cdp = await page.context().newCDPSession(page);
  async function swipe(travel: number[], cancel = false) {
    const rect = (await row.locator("article").boundingBox())!;
    const x = rect.x + rect.width * 0.25,
      y = rect.y + 20;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y }],
    });
    for (const dx of travel)
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: x + dx, y }],
      });
    await expect(row).toContainText("A thought to delete.");
    expect(
      await row
        .locator("..")
        .evaluate((element) => element.scrollWidth - element.clientWidth),
    ).toBe(0);
    await cdp.send("Input.dispatchTouchEvent", {
      type: cancel ? "touchCancel" : "touchEnd",
      touchPoints: [],
    });
  }
  await swipe([12, 35]);
  await expect(row).toBeVisible();
  await swipe([12, 40, 90, 30]);
  await expect(row).toBeVisible();
  await swipe([12, 40, 90], true);
  await expect(row).toBeVisible();
  await page.context().setOffline(true);
  await swipe([12, 40, 90]);
  await expect(row).toHaveCount(0);
  await expect(compose).toHaveValue("Keep this draft.");
  expect((await readNotes())[0].isDeleted).toBe(true);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(row).toBeVisible();
  expect((await readNotes())[0]).toMatchObject({
    id: original.id,
    content: original.content,
    anchor: original.anchor,
    createdAt: original.createdAt,
    isDeleted: false,
  });
  // The restored row is back in place, not left mid-swipe.
  await expect(row).toHaveCSS("opacity", "1");
  await expect
    .poll(async () => {
      const article = (await row.locator("article").boundingBox())!;
      const slot = (await row.boundingBox())!;
      return Math.abs(article.x - slot.x);
    })
    .toBeLessThan(1);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await row.locator("article").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit note" }).click();
  await page
    .getByRole("textbox", { name: "Edit note", exact: true })
    .fill("An unfinished edit.");
  await swipe([12, 40, 90]);
  await expect(row).toHaveCount(0);
  await expect(compose).toHaveValue("Keep this draft.");
  await expect
    .poll(() =>
      page.evaluate(async (path) => {
        const { syncV2Db: db } = await import(path);
        return (await db.noteDrafts.toArray()).map(
          (draft: { purpose: string }) => draft.purpose,
        );
      }, "/src/lib/sync-v2/db.ts"),
    )
    .toEqual(["create"]);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(row).toContainText("A thought to delete.");
  await page.context().setOffline(false);
  await cdp.detach();
});
