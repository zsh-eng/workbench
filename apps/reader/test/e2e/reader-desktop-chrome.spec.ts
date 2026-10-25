import { test, expect, openLocalBook } from "./helpers/fixtures";

test("desktop chrome shows from either edge and hides its controls together", async ({
  page,
  localBook,
}) => {
  await page.setViewportSize({ width: 1280, height: 850 });
  await openLocalBook(page, localBook.id);
  const header = page.locator('[data-reader-header="desktop"]');
  const footer = page.locator("[data-reader-footer]");
  const library = page.getByRole("button", { name: "Library", exact: true });
  const tools = header.getByRole("button", {
    name: "Open reader tools",
    exact: true,
  });
  await page
    .locator("[data-reader-header-accessory]")
    .getByRole("button", { name: "Dismiss reading status prompt" })
    .click();
  await page.mouse.move(640, 400);
  await expect(header).toHaveAttribute("aria-hidden", "true");
  await expect(library).toHaveCount(0);
  await expect(footer).toHaveCount(0);

  await page.locator('[data-reader-chrome-rail="top"]').hover();
  await expect(header).toHaveAttribute("aria-hidden", "false");
  await expect(library).toBeVisible();
  await expect(tools).toBeVisible();
  await expect(footer).toBeVisible();

  await page.mouse.move(640, 400);
  await expect(header).toHaveAttribute("aria-hidden", "true");
  await expect(footer).toHaveCount(0);
  await expect(library).toHaveCount(0);
  await expect(tools).toHaveCount(0);

  // Bottom-edge hover reveals the same controls.
  await page.locator('[data-reader-chrome-rail="bottom"]').hover();
  await expect(footer).toBeVisible();
  await expect(tools).toBeVisible();
  // There is no app sidebar: the left control goes back to the Library.
  await library.click();
  await expect(page).toHaveURL("/");
});

test("Escape closes the tools sidebar after menus and the note editor handle it", async ({
  page,
  localBook,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openLocalBook(page, localBook.id);
  const header = page.locator('[data-reader-header="desktop"]');
  const trigger = header.getByRole("button", {
    name: "Open reader tools",
    exact: true,
  });
  const sidebar = page.locator('aside[aria-label="Reader tools"]');
  const toolbar = sidebar.getByRole("navigation", { name: "Reader tools" });
  await header
    .getByRole("button", { name: "Dismiss reading status prompt" })
    .click();
  await trigger.click();
  await expect(sidebar).toHaveAttribute("aria-hidden", "false");

  // Focus inside the panel returns to the trigger, which keeps the header open.
  const contents = toolbar.getByRole("button", {
    name: "Contents",
    exact: true,
  });
  await contents.click();
  await expect(contents).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(sidebar).toHaveAttribute("aria-hidden", "true");
  await expect(trigger).toBeFocused();
  await expect(header).toHaveAttribute("aria-hidden", "false");

  await trigger.click();
  await toolbar.getByRole("button", { name: "Notebook", exact: true }).click();
  const compose = sidebar.getByRole("textbox", { name: "Write a note" });
  await compose.fill("Escape closes the editor first.");
  await sidebar.getByRole("button", { name: "Save note", exact: true }).click();
  const note = sidebar
    .getByRole("region", { name: "Book notebook" })
    .locator("article")
    .first();
  await expect(note).toContainText("Escape closes the editor first.");

  // An open menu closes alone.
  await note.click({ button: "right" });
  const edit = page.getByRole("menuitem", { name: "Edit", exact: true });
  await expect(edit).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(edit).toBeHidden();
  await expect(sidebar).toHaveAttribute("aria-hidden", "false");

  // The note editor cancels its edit and keeps the sidebar open.
  await note.dblclick();
  const editor = sidebar.getByRole("textbox", {
    name: "Edit note",
    exact: true,
  });
  await expect(editor).toBeFocused();
  await editor.press("Escape");
  await expect(editor).toHaveCount(0);
  await expect(sidebar).toHaveAttribute("aria-hidden", "false");

  // The composer closes the notebook with Escape, as before.
  await compose.press("Escape");
  await expect(sidebar).toHaveAttribute("aria-hidden", "true");
  await expect(trigger).toBeFocused();
});

test.describe("mobile chrome", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  test("a centre tap toggles the bars, and their controls work", async ({
    page,
    localBook,
  }) => {
    await openLocalBook(page, localBook.id);
    const header = page.locator('[data-reader-header="mobile"]');
    await expect(page.locator('[data-reader-header="desktop"]')).toHaveCount(0);
    await page.touchscreen.tap(195, 350);
    await expect(header).toBeInViewport();
    await page.touchscreen.tap(195, 350);
    await expect(header).not.toBeInViewport();
    await expect(page.locator("[data-reader-footer]")).toHaveCount(0);

    await page.touchscreen.tap(195, 350);
    await expect(header).toBeInViewport();
    await page.getByRole("button", { name: "Next chapter", exact: true }).tap();
    await expect(
      page.getByRole("button", {
        name: /^(Previous chapter|Start of current chapter)$/,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Back to library", exact: true })
      .tap();
    await expect(page).toHaveURL(/\/$/);
  });
});
