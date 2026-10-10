import { test, expect, openLocalBook } from "./helpers/fixtures";

test("desktop chrome fades in place and hides all navigation controls together", async ({
  page,
  localBook,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 850 });
  await openLocalBook(page, localBook.id);
  const header = page.locator('[data-reader-header="desktop"]');
  const footer = page.locator("[data-reader-footer]");
  const leftButton = page.getByRole("button", {
    name: "Toggle sidebar",
    exact: true,
  });
  const accessory = page.locator("[data-reader-header-accessory]");
  await accessory
    .getByRole("button", { name: "Dismiss reading status prompt" })
    .click();
  await page.mouse.move(640, 400);
  await expect(header).toHaveCSS("opacity", "0");
  await expect(header).toHaveCSS("transform", "none");
  await expect(leftButton).toHaveCount(0);
  await expect(footer).toHaveCount(0);

  await page.locator('[data-reader-chrome-rail="top"]').hover();
  await expect(header).toHaveCSS("opacity", "1");
  await expect(footer).toHaveCSS("opacity", "1");
  await expect(header).toHaveCSS("transform", "none");
  await expect(footer).toHaveCSS("transform", "none");
  await expect(header).toHaveCSS("border-bottom-width", "0px");
  await expect(leftButton).toHaveCSS("border-width", "0px");
  const leftButtonShape = await leftButton.evaluate((button) => ({
    radius: parseFloat(getComputedStyle(button).borderTopLeftRadius),
    height: button.getBoundingClientRect().height,
  }));
  expect(leftButtonShape.radius).toBeGreaterThan(0);
  expect(leftButtonShape.radius).toBeLessThan(leftButtonShape.height / 2);
  const bookmark = page.getByRole("button", {
    name: "Add bookmark",
    exact: true,
  });
  const toolsButton = page.getByRole("button", {
    name: "Open reader tools",
    exact: true,
  });
  const bookmarkBounds = (await bookmark.boundingBox())!;
  const toolsBounds = (await toolsButton.boundingBox())!;
  expect(toolsBounds.x - bookmarkBounds.x - bookmarkBounds.width).toBe(4);
  expect(bookmarkBounds.y).toBe(toolsBounds.y);
  await expect(bookmark).toHaveCSS("clip-path", "none");
  await bookmark.click();
  await expect(
    page.getByRole("button", { name: "Remove bookmark", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({
    path: testInfo.outputPath("desktop-chrome-visible.png"),
  });

  // A focused control keeps chrome open even when the pointer leaves.
  await page
    .getByRole("button", { name: "Remove bookmark", exact: true })
    .evaluate((button) => button.blur());
  await page.mouse.move(640, 400);
  await expect(header).toHaveCSS("opacity", "0");
  await expect(header).toHaveCSS("transform", "none");
  await expect(footer).toHaveCount(0);
  await expect(leftButton).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Remove bookmark", exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("desktop-chrome-hidden.png"),
  });

  // Bottom-edge hover reveals the same controls and retains the bookmark state.
  await page.locator('[data-reader-chrome-rail="bottom"]').hover();
  await expect(header).toHaveCSS("opacity", "1");
  await expect(footer).toHaveCSS("opacity", "1");
  await expect(
    page.getByRole("button", { name: "Remove bookmark", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await leftButton.click();
  const sidebar = page.locator('[data-slot="sidebar"]');
  await expect(sidebar).toHaveAttribute("data-state", "expanded");
  await expect(
    sidebar.getByRole("button", { name: "Toggle sidebar", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(header).toHaveCSS("opacity", "0");
  await sidebar
    .getByRole("button", { name: "Toggle sidebar", exact: true })
    .click();
  await expect(sidebar).toHaveAttribute("data-state", "collapsed");
  await page.mouse.move(640, 400);
  await expect(header).toHaveCSS("opacity", "0");
  const modifier = await page.evaluate(() =>
    /Mac/i.test(navigator.platform) ? "Meta" : "Control",
  );
  await page.keyboard.press(`${modifier}+Backslash`);
  await expect(sidebar).toHaveAttribute("data-state", "expanded");
  await page.keyboard.press(`${modifier}+Backslash`);
  await expect(sidebar).toHaveAttribute("data-state", "collapsed");
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
  const highlights = toolbar.getByRole("button", {
    name: "Highlights",
    exact: true,
  });
  await highlights.click();
  await expect(highlights).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(sidebar).toHaveAttribute("aria-hidden", "true");
  await expect(trigger).toBeFocused();
  await expect(header).toHaveAttribute("aria-hidden", "false");

  await trigger.click();
  await toolbar.getByRole("button", { name: "Notes", exact: true }).click();
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

test.describe("mobile chrome remains unchanged", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  test("keeps the sliding bars and bookmark ribbon", async ({
    page,
    localBook,
  }, testInfo) => {
    await openLocalBook(page, localBook.id);
    const header = page.locator('[data-reader-header="mobile"]');
    await expect(page.locator('[data-reader-header="desktop"]')).toHaveCount(0);
    await page.touchscreen.tap(195, 350);
    await expect(header).toHaveCSS("transform", "none");
    const back = page.getByRole("button", {
      name: "Back to library",
      exact: true,
    });
    await expect(back).toBeVisible();
    await expect(back).toHaveCSS("border-width", "1px");
    await expect(
      header.locator('header > [class*="bg-border/70"]'),
    ).toHaveCount(1);
    const bookmark = page.getByRole("button", {
      name: "Add bookmark",
      exact: true,
    });
    await expect(bookmark).toHaveCSS("height", "52px");
    await expect(bookmark.locator("svg polygon")).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: "Toggle sidebar", exact: true }),
    ).toHaveCount(0);
    await bookmark.click();
    await page.touchscreen.tap(195, 350);
    await expect(header).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, -80)");
    await expect(page.locator("[data-reader-footer]")).not.toHaveCSS(
      "transform",
      "none",
    );
    await expect(
      page.getByRole("button", { name: "Remove bookmark", exact: true }),
    ).toBeInViewport();
    await page.screenshot({
      path: testInfo.outputPath("mobile-bookmark-ribbon.png"),
    });
  });
});
