import type { Locator, Page } from "@playwright/test";
import {
  test,
  expect,
  openLocalBook,
  openReaderTools,
  showNotesCapsule,
  waitForReaderReady,
  waitForSheet,
  waitForSheetToRest,
} from "./helpers/fixtures";

test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});

const FRAME = "/debug/elements/frame/sheets";

/** The share of a sheet on screen. Overscroll padding is not the sheet. */
function visibleShare(dialog: Locator) {
  return dialog.evaluate((element) => {
    const sheet = element.closest(".reader-sheet") as HTMLElement;
    const box = sheet.getBoundingClientRect();
    const padding = parseFloat(getComputedStyle(sheet).paddingBottom);
    const height = box.height - padding;
    return Math.min(1, (innerHeight - box.top) / height);
  });
}

/** The share of the screen a sheet covers. Lists rest at 55% of it. */
function screenShare(dialog: Locator) {
  return dialog.evaluate((element) => {
    const sheet = element.closest(".reader-sheet") as HTMLElement;
    return (innerHeight - sheet.getBoundingClientRect().top) / innerHeight;
  });
}

/** Waits until a sheet has entered and rests; React Aria marks entry. */
async function settled(dialog: Locator) {
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(() =>
      dialog.evaluate(
        (element) =>
          !element
            .closest(".reader-sheet-overlay")
            ?.hasAttribute("data-entering"),
      ),
    )
    .toBe(true);
}

/** A finger drag in the middle of the screen; negative moves content up. */
async function swipe(page: Page, y: number, distance: number) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.synthesizeScrollGesture", {
    x: 195,
    y,
    yDistance: distance,
    gestureSourceType: "touch",
    speed: 1200,
  });
  await cdp.detach();
}

test("Reader sheets rest on detents and stack over Reader tools", async ({
  page,
}) => {
  await page.goto(`${FRAME}?state=tools&variant=detents`);
  const tools = page.getByRole("dialog", { name: "Reader tools" });
  await settled(tools);
  // Reader tools fit their content instead of a fixed height.
  await expect.poll(() => visibleShare(tools)).toBeCloseTo(1, 1);
  const toolsTop = await tools.evaluate(
    (element) => element.getBoundingClientRect().top,
  );
  expect(toolsTop).toBeGreaterThan(844 / 2);

  // Contents stacks over the tools at the lists' medium detent.
  await tools.getByRole("button", { name: /Contents/ }).click();
  const contents = page.getByRole("dialog", { name: "Contents" });
  await settled(contents);
  await expect.poll(() => screenShare(contents)).toBeCloseTo(0.55, 1);
  await expect(tools).toBeAttached();

  // A swipe up takes it to full height; Back returns to the tools.
  await swipe(page, 700, -500);
  await expect.poll(() => visibleShare(contents)).toBeGreaterThan(0.98);
  await contents.getByRole("button", { name: "Back to reader tools" }).click();
  await expect(contents).toBeHidden();
  await expect(tools).toBeVisible();

  // Appearance takes the place of the tools, fits its tab, and does not dim.
  await tools.getByRole("button", { name: "Appearance", exact: true }).click();
  const settings = page.getByRole("dialog", {
    name: "Appearance",
    exact: true,
  });
  await settled(settings);
  await expect(tools).toBeHidden();
  await expect.poll(() => visibleShare(settings)).toBeCloseTo(1, 1);
  await expect(page.locator(".reader-sheet-backdrop")).toHaveCount(0);

  // A taller tab raises the sheet's top edge, and the page stays in view.
  const top = () =>
    settings.evaluate(
      (element) =>
        element.closest(".reader-sheet")!.getBoundingClientRect().top,
    );
  const typeTop = await top();
  expect(typeTop).toBeGreaterThan(844 / 4);
  await settings.getByRole("tab", { name: "Theme" }).click();
  await expect.poll(top).toBeLessThan(typeTop - 40);
  await expect.poll(() => visibleShare(settings)).toBeCloseTo(1, 1);
  await waitForSheetToRest(settings);
  await settings.getByRole("tab", { name: "Type" }).click();
  await expect.poll(top).toBeCloseTo(typeTop, 0);
  await waitForSheetToRest(settings);

  // Changes apply to the page behind the sheet.
  const page17 = page.getByText("Curiouser and curiouser!", { exact: false });
  const before = await page17.evaluate((p) => getComputedStyle(p).fontFamily);
  await settings.getByRole("button", { name: /Garamond/i }).click();
  await expect
    .poll(() => page17.evaluate((p) => getComputedStyle(p).fontFamily))
    .not.toBe(before);
});

test("A page tapped while Reader tools still opens takes taps", async ({
  page,
}) => {
  // Reader tools hide everything outside them once they have entered. A
  // page that opened before then stayed inert until React Aria's top layer
  // kept it visible.
  await page.goto(`${FRAME}?state=tools&variant=detents`);
  const tools = page.getByRole("dialog", { name: "Reader tools" });
  await expect(tools).toBeVisible({ timeout: 30_000 });
  await tools
    .getByRole("button", { name: /Book status/ })
    .dispatchEvent("click");
  const status = page.getByRole("dialog", { name: "Reading status" });
  await settled(status);
  const finished = status.getByRole("button", { name: "Finished" });
  await finished.click();
  await expect(finished).toHaveAttribute("aria-pressed", "true");
});

test("A menu and a toast opened from a sheet take taps", async ({
  page,
  localBook,
}) => {
  // The sheet makes the page behind it inert. A menu or toast renders
  // outside the sheet, and stayed inert under it until it joined React
  // Aria's top layer.
  await openLocalBook(page, localBook.id);
  await page.touchscreen.tap(195, 422);
  const tools = await openReaderTools(page);
  await tools.getByRole("button", { name: "Notebook", exact: true }).click();
  const notebook = await waitForSheet(page, "Notebook");
  const input = notebook.getByRole("textbox", { name: "Write a note" });
  await input.fill("A note to delete");
  await input.press("Control+Enter");
  // The field keeps the words, read-only, until the note is saved.
  await expect(input).toHaveValue("");
  const note = notebook.getByText("A note to delete", { exact: true });
  await expect(note).toBeVisible();

  await note.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete note" }).click();
  await expect(note).toHaveCount(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(note).toBeVisible();
  await expect(notebook).toBeVisible();
});

test("The Reader opens Contents as a detent sheet by default", async ({
  page,
  localBook,
}) => {
  await openLocalBook(page, localBook.id);
  await page.touchscreen.tap(195, 422);
  await page
    .getByRole("button", { name: "Open reader tools", exact: true })
    .click();
  const tools = page.getByRole("dialog", { name: "Reader tools" });
  await settled(tools);
  await tools.getByRole("button", { name: /Contents/ }).click();
  const contents = page.getByRole("dialog", { name: "Contents" });
  await settled(contents);
  await expect.poll(() => screenShare(contents)).toBeCloseTo(0.55, 1);

  // A chapter is a tap away at the detent; the book turns to it behind the
  // sheet, which stays open, as the fixed-height sheet does.
  const chapter = contents
    .getByRole("button")
    .filter({ hasText: /Pool of Tears/i })
    .first();
  await expect(chapter).not.toHaveAttribute("aria-current", "location");
  await chapter.click();
  await expect(chapter).toHaveAttribute("aria-current", "location");

  // A swipe up takes the list to full height; Back returns to the tools.
  await swipe(page, 700, -500);
  await expect.poll(() => visibleShare(contents)).toBeGreaterThan(0.98);
  await contents.getByRole("button", { name: "Back to reader tools" }).click();
  await expect(contents).toBeHidden();
  await expect(tools).toBeVisible();
});

test("Search rests at the medium detent and full height", async ({
  page,
  localBook,
}) => {
  await openLocalBook(page, localBook.id);
  await page.touchscreen.tap(195, 422);
  await page
    .getByRole("button", { name: "Open reader tools", exact: true })
    .click();
  const tools = page.getByRole("dialog", { name: "Reader tools" });
  await settled(tools);
  await tools.getByRole("button", { name: /Search book/ }).click();
  const sheet = page.getByRole("dialog", { name: "Search book" });
  await settled(sheet);

  // An empty field takes focus. The keyboard would cover the medium
  // detent, so the sheet opens at full height.
  const field = sheet.getByRole("searchbox");
  await expect(field).toBeFocused();
  await expect.poll(() => visibleShare(sheet)).toBeGreaterThan(0.98);
  // A drag puts the keyboard away once the sheet has reached full height.
  await waitForSheetToRest(sheet);
  await field.fill("Dinah");
  await expect(sheet.locator("[data-search-status]")).toHaveAttribute(
    "data-search-status",
    "done",
  );

  // Dragged down by its header, it rests at the medium detent and puts the
  // keyboard away.
  await swipe(page, 60, 420);
  await expect.poll(() => screenShare(sheet)).toBeCloseTo(0.55, 1);
  await expect(field).not.toBeFocused();
  await waitForSheetToRest(sheet);

  // A result opens its page, and the sheet closes over it.
  const results = sheet.locator("[data-search-result]");
  await results.nth(1).click();
  await expect(sheet).toBeHidden();
  const stepper = page.getByTestId("search-stepper");
  await expect(stepper).toContainText("2 of");

  // The count brings the results back at the medium detent, with the
  // result in view and the keyboard away.
  await stepper.getByRole("button", { name: /Show all results/ }).tap();
  await settled(sheet);
  await expect.poll(() => screenShare(sheet)).toBeCloseTo(0.55, 1);
  await expect(results.nth(1)).toHaveAttribute("aria-current", "true");
  await expect(results.nth(1)).toBeInViewport();
  await expect(field).not.toBeFocused();

  // Tapping the field raises the sheet to full height.
  await field.tap();
  await expect(field).toBeFocused();
  await expect.poll(() => visibleShare(sheet)).toBeGreaterThan(0.98);
});

test("Open notebook in the notes bubble opens the Notebook sheet that Reader tools open, and its notes stay", async ({
  page,
  localBook,
}) => {
  const openFromBubble = async () => {
    await showNotesCapsule(page);
    await page
      .getByRole("button", { name: "Open notebook", exact: true })
      .click();
    return waitForSheet(page, "Notebook");
  };
  await openLocalBook(page, localBook.id);

  // Reader tools → Notebook, for comparison.
  await page.touchscreen.tap(195, 422);
  const tools = await openReaderTools(page);
  await tools.getByRole("button", { name: "Notebook", exact: true }).click();
  const fromTools = await waitForSheet(page, "Notebook");
  const toolsShare = await screenShare(fromTools);
  // Escape steps back to the tools, then closes them.
  await page.keyboard.press("Escape");
  await expect(fromTools).toHaveCount(0);
  await expect(tools.getByRole("button", { name: "Notebook" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // The bubble opens the same sheet, at the same height.
  const notebook = await openFromBubble();
  await expect.poll(() => screenShare(notebook)).toBeCloseTo(toolsShare, 2);
  const input = notebook.getByRole("textbox", { name: "Write a note" });
  await input.fill("A note from the bubble");
  await input.press("Control+Enter");
  await expect(
    notebook.getByText("A note from the bubble", { exact: true }),
  ).toBeVisible();

  await page.reload();
  await waitForReaderReady(page);
  const reopened = await openFromBubble();
  await expect(
    reopened.getByText("A note from the bubble", { exact: true }),
  ).toBeVisible();
});

test("With detent sheets off, Open notebook in the notes bubble still opens the Notebook", async ({
  page,
  localBook,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("reader-detent-sheets-v1", "false"),
  );
  await openLocalBook(page, localBook.id);
  await showNotesCapsule(page);
  await page
    .getByRole("button", { name: "Open notebook", exact: true })
    .click();
  const notebook = await waitForSheet(page, "Notebook");
  const input = notebook.getByRole("textbox", { name: "Write a note" });
  await input.fill("A note in the fixed sheet");
  await input.press("Control+Enter");
  const note = notebook.getByText("A note in the fixed sheet", { exact: true });
  await expect(note).toBeVisible();
  await notebook.getByRole("button", { name: "Close notebook" }).click();
  await expect(notebook).toBeHidden();

  await showNotesCapsule(page);
  await page
    .getByRole("button", { name: "Open notebook", exact: true })
    .click();
  await expect(note).toBeVisible();
});

/** Counts the moves that a sheet's spring runs from here on. */
async function countSprings(page: Page) {
  await page.evaluate(() => {
    const counted = window as Window & { springs?: number };
    counted.springs = 0;
    new MutationObserver((records) => {
      for (const record of records)
        if ((record.target as Element).hasAttribute("data-sheet-spring"))
          counted.springs!++;
    }).observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ["data-sheet-spring"],
    });
  });
  return () =>
    page.evaluate(() => (window as Window & { springs?: number }).springs);
}

for (const reducedMotion of ["no-preference", "reduce"] as const)
  test(`A sheet opens at its detent, changes detent and closes ${reducedMotion === "reduce" ? "in place with reduced motion" : "on its spring"}`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion });
    await page.goto("/debug/ideas/sheet-motion?motion=uikit");
    const springs = await countSprings(page);
    await page.getByRole("button", { name: "List", exact: true }).tap();
    const sheet = page.getByRole("dialog", { name: "List" });
    await settled(sheet);
    await expect.poll(() => screenShare(sheet)).toBeCloseTo(0.55, 1);

    await sheet.getByRole("button", { name: "Full height" }).tap();
    await expect.poll(() => visibleShare(sheet)).toBeGreaterThan(0.98);
    await sheet.getByRole("button", { name: "Medium", exact: true }).tap();
    await expect.poll(() => screenShare(sheet)).toBeCloseTo(0.55, 1);

    // A tap on the dimmed page above closes it, and the page takes taps.
    await page.touchscreen.tap(195, 60);
    await expect(sheet).toBeHidden();
    await page.getByRole("button", { name: "Menu", exact: true }).tap();
    const menu = page.getByRole("dialog", { name: "Menu" });
    await settled(menu);
    await menu.getByRole("button", { name: "Contents" }).tap();
    await expect(menu).toBeHidden();

    // Each move ran on the spring; with reduced motion, none did.
    if (reducedMotion === "reduce") expect(await springs()).toBe(0);
    else expect(await springs()).toBeGreaterThan(3);
  });
