import type { Locator, Page } from "@playwright/test";
import {
  test,
  expect,
  openLocalBook,
  waitForReaderReady,
  nextSpread,
  currentPages,
  showNotesCapsule,
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
  const trigger = page.getByRole("button", { name: "Jot a note" });
  const capsule = page.locator("[data-notes-capsule]");
  const scrubber = page.locator("canvas.cursor-ew-resize");
  // Chrome is still entering after the tap; compare both bounds in one frame.
  await expect
    .poll(() =>
      capsule.evaluate((element) => {
        const scrubber = document.querySelector("canvas.cursor-ew-resize")!;
        return (
          scrubber.getBoundingClientRect().top -
          element.getBoundingClientRect().bottom
        );
      }),
    )
    .toBeGreaterThan(0);
  // The capsule rests right-aligned on the footer, where Jot a note was.
  const capsuleBounds = (await capsule.boundingBox())!;
  const scrubberBounds = (await scrubber.boundingBox())!;
  expect(Math.round(capsuleBounds.x + capsuleBounds.width)).toBe(380);
  expect(capsuleBounds.y + capsuleBounds.height).toBeLessThan(scrubberBounds.y);
  await expect(capsule).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  expect(
    Math.abs(scrubberBounds.x + scrubberBounds.width / 2 - 195),
  ).toBeLessThan(3);
  await trigger.click();
  const before = await currentPages(page);
  const stage = page.locator('[data-reader-stage-slot="content"]');
  const stageBefore = await stage.boundingBox();
  const input = page.getByRole("textbox", { name: "Write a note" });
  await expect(input).toBeFocused();
  const sendButton = page.locator('button[aria-label="Save note"]');
  await expect(sendButton).toHaveCSS("opacity", "0");
  await expect(
    page.getByRole("button", { name: "Save note", exact: true }),
  ).toHaveCount(0);
  await input.fill("  ");
  await expect(sendButton).toHaveCSS("opacity", "0");
  await input.fill("A");
  await expect(sendButton).toHaveCSS("opacity", "1");
  await expect(sendButton).toBeEnabled();
  await input.fill("");
  await expect(sendButton).toHaveCSS("opacity", "0");
  // The composer is the island: centred, 10 px from each edge.
  const island = page.locator("[data-notes-island] > div > div");
  await expect
    .poll(async () => {
      const box = (await island.boundingBox())!;
      return [Math.round(box.x), Math.round(box.width)];
    })
    .toEqual([10, 370]);
  const surface = page.locator("[data-note-input-surface]");
  expect((await surface.boundingBox())!.height).toBeLessThanOrEqual(56);
  const closedWidth = (await input.boundingBox())!.width;
  // Emulate the viewport signal, not an actual iOS keyboard.
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport!, "height", {
      configurable: true,
      value: window.innerHeight - 300,
    });
    window.visualViewport!.dispatchEvent(new Event("resize"));
  });
  await expect
    .poll(async () => (await input.boundingBox())!.width)
    .toBe(closedWidth);
  await expect(page.locator("[data-note-composer]")).toHaveCSS(
    "padding-bottom",
    "0px",
  );
  const immediateBottom = await page.evaluate(() => {
    Object.defineProperty(window.visualViewport!, "offsetTop", {
      configurable: true,
      value: 40,
    });
    window.visualViewport!.dispatchEvent(new Event("scroll"));
    return (document.querySelector("[data-note-composer]") as HTMLElement).style
      .bottom;
  });
  expect(immediateBottom).toBe("260px");
  await page.evaluate(() => {
    delete (window.visualViewport as unknown as { height?: number }).height;
    delete (window.visualViewport as unknown as { offsetTop?: number })
      .offsetTop;
    window.visualViewport!.dispatchEvent(new Event("resize"));
  });
  await expect
    .poll(async () => (await input.boundingBox())!.width)
    .toBe(closedWidth);
  const shortHeight = (await input.boundingBox())!.height;
  await input.fill(
    "How easily curiosity becomes courage.\nAlice follows the rabbit before she knows where it leads.\nIs the uncertainty part of the invitation?",
  );
  expect((await input.boundingBox())!.height).toBeGreaterThan(shortHeight);
  expect(await currentPages(page)).toEqual(before);
  expect(await stage.boundingBox()).toEqual(stageBefore);
  await page.screenshot({ path: "/tmp/reader-note-composer.png" });
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
  await page.screenshot({ path: "/tmp/reader-notebook-chat.png" });
  await page.getByRole("button", { name: "Notebook order" }).click();
  await page.getByRole("menuitemradio", { name: "By chapter" }).click();
  await expect(
    page.getByText("Return to this idea later.", { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "/tmp/reader-notebook-journal.png" });
  const sheet = page.getByRole("dialog", { name: "Notebook", exact: true });
  await expect(
    sheet.getByRole("textbox", { name: "Write a note" }),
  ).toBeVisible();
  await expect(input).toHaveCount(1);
  await expect(page.getByRole("region", { name: "Book notebook" })).toHaveCSS(
    "border-top-width",
    "0px",
  );
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
  await page
    .getByRole("button", { name: "Open reader tools", exact: true })
    .click();
  await page.getByRole("button", { name: "Notebook", exact: true }).click();
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
 * The passage starts inside a line, so its page is the visible page even when
 * the line continues a paragraph from the previous page. */
async function openSelectionNote(page: Page) {
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
    range.setStart(node, 5);
    range.setEnd(node, 30);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
  });
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString().length))
    .toBe(25);
  await page.evaluate(() =>
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true })),
  );
  await expect(
    page.getByRole("button", { name: "Note on highlight" }),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "Note on highlight" }).click();
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
  }, testInfo) => {
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
    await expect(
      tools.getByRole("button", { name: "Close notebook" }),
    ).toHaveCount(0);
    await expect(tools.locator('button[aria-label="Save note"]')).toHaveCSS(
      "opacity",
      "0",
    );
    const surface = tools.locator("[data-note-input-surface]");
    const panel = tools.locator('[data-slot="reader-tools-surface"]');
    await expect(panel).toHaveCSS("border-radius", "28px");
    await expect(surface).toHaveCSS("border-bottom-right-radius", "19px");
    await expect(surface).toHaveCSS("border-bottom-left-radius", "19px");
    await expect(surface).toHaveCSS("box-shadow", "none");
    const inputCorners = await surface.evaluate((field) => {
      const style = getComputedStyle(field);
      return {
        top: parseFloat(style.borderTopLeftRadius),
        bottom: parseFloat(style.borderBottomLeftRadius),
      };
    });
    expect(inputCorners.top).toBe(inputCorners.bottom);
    const headerTrigger = page.locator(
      'button[aria-label="Open reader tools"]',
    );
    const closeTrigger = tools
      .getByRole("button", { name: "Close reader tools", exact: true })
      .last();
    await expect(headerTrigger).toHaveAttribute("aria-pressed", "true");
    await expect(closeTrigger).toHaveAttribute("aria-pressed", "true");
    const cornerGaps = await panel.evaluate((panel) => {
      const field = panel.querySelector("[data-note-input-surface]")!;
      const outerBounds = panel.getBoundingClientRect();
      const innerBounds = field.getBoundingClientRect();
      const radiusDifference =
        parseFloat(getComputedStyle(panel).borderBottomRightRadius) -
        parseFloat(getComputedStyle(field).borderBottomRightRadius);
      return {
        horizontal: outerBounds.right - innerBounds.right,
        vertical: outerBounds.bottom - innerBounds.bottom,
        radiusDifference,
      };
    });
    expect(cornerGaps.horizontal).toBeCloseTo(cornerGaps.radiusDifference, 1);
    expect(cornerGaps.vertical).toBeCloseTo(cornerGaps.radiusDifference, 1);
    expect((await surface.boundingBox())!.height).toBeLessThanOrEqual(44);
    await noteInput.fill("A note for the notebook.");
    await tools.getByRole("button", { name: "Save note", exact: true }).click();
    const heading = tools.getByRole("heading", {
      name: "Notebook 1",
      exact: true,
    });
    await expect(heading).toBeVisible();
    const centers = await heading.locator("span").evaluateAll((spans) =>
      spans.map((span) => {
        const bounds = span.getBoundingClientRect();
        return bounds.y + bounds.height / 2;
      }),
    );
    expect(Math.abs(centers[0] - centers[1])).toBeLessThan(1);
    await noteInput.fill("Keep this desktop draft.");
    const toolbar = tools.getByRole("navigation", { name: "Reader tools" });
    await expect(toolbar.getByRole("button").last()).toHaveAccessibleName(
      "Close reader tools",
    );
    await page.screenshot({
      path: testInfo.outputPath("desktop-notebook-header.png"),
    });
    await tools
      .getByRole("button", { name: "Close reader tools", exact: true })
      .last()
      .click();
    const closingSidebar = page.locator('aside[aria-label="Reader tools"]');
    await expect(closingSidebar).toHaveAttribute("aria-hidden", "true");
    await expect(headerTrigger).toHaveAttribute("aria-pressed", "false");
    await expect(closingSidebar.locator("nav button").last()).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await expect(
      closingSidebar.locator('button[aria-label="Notebook"]'),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      closingSidebar.locator('[aria-label="Book notebook"]'),
    ).toHaveCount(1);
    await expect(
      closingSidebar.locator('[aria-label="Write a note"]'),
    ).toHaveCount(1);

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
    await page.setViewportSize({ width: 768, height: 850 });
    const closeInset = await toolbar.evaluate((nav) => {
      const close = nav.querySelector(
        'button[aria-label="Close reader tools"]',
      )!;
      return (
        nav.getBoundingClientRect().right - close.getBoundingClientRect().right
      );
    });
    expect(closeInset).toBeCloseTo(8, 0);
    const firstToolInset = await toolbar.evaluate((nav) => {
      const firstTool = nav.querySelector("button")!;
      return (
        firstTool.getBoundingClientRect().left -
        nav.getBoundingClientRect().left
      );
    });
    expect(firstToolInset).toBeCloseTo(12, 0);
    await page.screenshot({
      path: testInfo.outputPath("narrow-desktop-notebook-header.png"),
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await noteInput.fill("");
    const sendButton = tools.locator('button[aria-label="Save note"]');
    await expect(sendButton).toHaveCSS("opacity", "0");
    await expect(sendButton).toHaveCSS("transform", "none");
    await noteInput.fill("Reduced motion keeps the send button visible.");
    await expect(sendButton).toHaveCSS("opacity", "1");
    await expect(sendButton).toHaveCSS("transform", "none");
    await tools
      .getByRole("button", { name: "Close reader tools", exact: true })
      .last()
      .click();
    await page.mouse.move(200, 10);
    await page
      .getByRole("button", { name: "Toggle sidebar", exact: true })
      .click();
    await expect(page.locator('[data-slot="sidebar-inner"]')).toHaveCSS(
      "border-radius",
      "28px",
    );
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
    expect((await panel.boundingBox())!.x).toBeGreaterThan(1200);
    await expect(
      page.getByRole("region", { name: "Book notebook" }),
    ).toHaveCount(0);
    await page
      .getByRole("textbox", { name: "Write a note" })
      .fill("A thought from the margin");
    const editorBounds = (await panel.boundingBox())!;
    expect(editorBounds.width).toBeGreaterThanOrEqual(320);
    expect(editorBounds.width).toBeLessThanOrEqual(360);
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
    expect(savedBounds.x).toBe(editorBounds.x);
    expect(savedBounds.width).toBe(editorBounds.width);
    expect(savedBounds.height).toBeLessThan(160);
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

    await page.screenshot({ path: "/tmp/desktop-margin-note.png" });
    expect(await stage.boundingBox()).toEqual(before);
    expect(await currentPages(page)).toEqual(anchorPages);
    await nextSpread(page);
    const notebookPages = await currentPages(page);
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
    await page.screenshot({ path: "/tmp/reader-notes-tab.png" });
  });
  test("opens a note in the notebook when the page margin is narrow", async ({
    page,
    localBook,
  }, testInfo) => {
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
    await page.screenshot({ path: testInfo.outputPath("narrow-margin.png") });
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
    await expect(page.locator(".highlight-toolbar")).toHaveCount(1);
    const copyButton = page.getByRole("button", {
      name: "Copy highlighted text",
    });
    const noteButton = page.getByRole("button", { name: "Note on highlight" });
    await expect(noteButton).toBeVisible();
    await expect
      .poll(async () => {
        const copy = (await copyButton.boundingBox())!;
        const note = (await noteButton.boundingBox())!;
        return Math.abs(copy.y - note.y);
      })
      .toBeLessThan(1);
    expect((await noteButton.boundingBox())!.x).toBeGreaterThan(
      (await copyButton.boundingBox())!.x,
    );
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
    await page.screenshot({ path: "/tmp/reader-highlight-notebook.png" });
    const quotedText = await quote.locator("span").textContent();
    await expect(quote.locator("span")).toHaveCSS("text-overflow", "ellipsis");
    expect(
      await quote
        .locator("span")
        .evaluate((element) => element.scrollWidth > element.clientWidth),
    ).toBe(true);
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
    await expect(fullQuote).toHaveCSS("white-space", "pre-wrap");
    expect(
      await fullQuote.evaluate(
        (element) =>
          element.clientHeight > 30 &&
          element.scrollWidth <= element.clientWidth,
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
    if (!cancel && distances.at(-1)! >= 72)
      await page.screenshot({ path: "/tmp/reader-note-swipe-cue.png" });
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
  await expect(page.locator('button[aria-label="Save changes"]')).toHaveCSS(
    "opacity",
    "0",
  );
  await editor.fill("The revised thought.");
  await page.screenshot({ path: "/tmp/reader-note-edit.png" });
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
  const floatingHeight = (await input.boundingBox())!.height;
  await input.press("Escape");
  await showNotesCapsule(page);
  await page.getByRole("button", { name: "Open notebook" }).click();
  const sheet = page.getByRole("dialog", { name: "Notebook", exact: true });
  const sheetInput = sheet.getByRole("textbox", { name: "Write a note" });
  await expect(sheetInput).toHaveValue(text);
  await expect
    .poll(async () => (await sheetInput.boundingBox())!.height)
    .toBe(floatingHeight);
  await sheetInput.fill(`${text}\nWritten in the notebook.`);
  await expect
    .poll(async () => (await sheetInput.boundingBox())!.height)
    .toBeGreaterThan(floatingHeight);
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
    .toBeLessThan(floatingHeight);
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
  await expect(row).toHaveCSS("opacity", "1");
  await expect(row.locator("article")).toHaveCSS(
    "transform",
    "matrix(1, 0, 0, 1, 0, 0)",
  );
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
