import type { Locator, Page } from "@playwright/test";
import { test, expect, openLocalBook } from "./helpers/fixtures";

/**
 * Counts the pixel rows and columns where taps reach a control, through its
 * centre lines, by browser hit testing. The count includes a pseudo-element
 * target and excludes any covering element. Hit testing rounds the pixel
 * centre probes, so a 44 px target counts as 44 or 45.
 */
async function hitArea(control: Locator) {
  return control.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const x = Math.floor(box.x + box.width / 2) + 0.5;
    const y = Math.floor(box.y + box.height / 2) + 0.5;
    const hits = (px: number, py: number) =>
      element.contains(document.elementFromPoint(px, py));
    const reach = (dx: number, dy: number) => {
      let pixels = 0;
      while (
        pixels < innerWidth &&
        hits(x + dx * (pixels + 1), y + dy * (pixels + 1))
      )
        pixels += 1;
      return pixels;
    };
    return {
      width: reach(-1, 0) + 1 + reach(1, 0),
      height: reach(0, -1) + 1 + reach(0, 1),
    };
  });
}

/** Returns the button at a point, by accessible name. */
async function buttonAt(page: Page, x: number, y: number) {
  return page.evaluate(
    ([x, y]) =>
      document
        .elementFromPoint(x, y)
        ?.closest("button")
        ?.getAttribute("aria-label") ?? null,
    [x, y],
  );
}

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
  // Bookmarks are not stored yet, so the header has no bookmark control. One
  // control on each side keeps the title centred.
  await expect(header.getByRole("button", { name: /bookmark/i })).toHaveCount(
    0,
  );
  const toolsButton = header.getByRole("button", {
    name: "Open reader tools",
    exact: true,
  });
  const leftBounds = (await leftButton.boundingBox())!;
  const toolsBounds = (await toolsButton.boundingBox())!;
  const titleBounds = (await header
    .locator("[data-reader-header-title]")
    .boundingBox())!;
  expect(toolsBounds.y).toBe(leftBounds.y);
  expect(1280 - toolsBounds.x - toolsBounds.width).toBeCloseTo(leftBounds.x, 0);
  expect(titleBounds.x + titleBounds.width / 2).toBeCloseTo(640, 0);
  await page.screenshot({
    path: testInfo.outputPath("desktop-chrome-visible.png"),
  });

  await page.mouse.move(640, 400);
  await expect(header).toHaveCSS("opacity", "0");
  await expect(header).toHaveCSS("transform", "none");
  await expect(footer).toHaveCount(0);
  await expect(leftButton).toHaveCount(0);
  await expect(toolsButton).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("desktop-chrome-hidden.png"),
  });

  // Bottom-edge hover reveals the same controls.
  await page.locator('[data-reader-chrome-rail="bottom"]').hover();
  await expect(header).toHaveCSS("opacity", "1");
  await expect(footer).toHaveCSS("opacity", "1");
  await expect(toolsButton).toBeVisible();
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

test.describe("mobile chrome", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  test("slides both bars away and shows no bookmark ribbon", async ({
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
      header.locator(':scope > [class*="bg-border/70"]'),
    ).toHaveCount(1);
    await expect(page.getByRole("button", { name: /bookmark/i })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("button", { name: "Toggle sidebar", exact: true }),
    ).toHaveCount(0);
    // Back and Tools sit at matching insets, so the title stays centred.
    const backBounds = (await back.boundingBox())!;
    const toolsBounds = (await page
      .getByRole("button", { name: "Open reader tools", exact: true })
      .boundingBox())!;
    expect(toolsBounds.y).toBe(backBounds.y);
    expect(390 - toolsBounds.x - toolsBounds.width).toBe(backBounds.x);
    await page.screenshot({
      path: testInfo.outputPath("mobile-chrome-visible.png"),
    });
    await page.touchscreen.tap(195, 350);
    await expect(header).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, -56)");
    await expect(page.locator("[data-reader-footer]")).not.toHaveCSS(
      "transform",
      "none",
    );
    await expect(header).not.toBeInViewport();
  });

  test("gives the chrome controls 44 px touch targets at their visual size", async ({
    page,
    localBook,
  }) => {
    await openLocalBook(page, localBook.id);
    await page.touchscreen.tap(195, 350);
    await expect(page.locator('[data-reader-header="mobile"]')).toHaveCSS(
      "transform",
      "none",
    );
    await expect(page.locator("[data-reader-footer]")).toHaveCSS(
      "transform",
      "none",
    );
    const back = page.getByRole("button", {
      name: "Back to library",
      exact: true,
    });
    const tools = page.getByRole("button", {
      name: "Open reader tools",
      exact: true,
    });
    const next = page.getByRole("button", {
      name: "Next chapter",
      exact: true,
    });

    // A tap above the visible Next chapter control still moves on a chapter.
    const nextBounds = (await next.boundingBox())!;
    expect(
      await buttonAt(
        page,
        nextBounds.x + nextBounds.width / 2,
        nextBounds.y - 12,
      ),
    ).toBe("Next chapter");
    await page.touchscreen.tap(
      nextBounds.x + nextBounds.width / 2,
      nextBounds.y - 12,
    );
    const previous = page.getByRole("button", {
      name: /^(Previous chapter|Start of current chapter)$/,
    });
    await expect(previous).toBeVisible();
    // Let the press scale settle before measuring.
    await expect(next).toHaveCSS("scale", "none");
    const title = page.getByRole("button", {
      name: "Open table of contents",
      exact: true,
    });

    for (const control of [back, tools]) {
      expect(await control.boundingBox()).toMatchObject({
        width: 32,
        height: 32,
      });
      const area = await hitArea(control);
      expect(area.width).toBeGreaterThanOrEqual(44);
      expect(area.height).toBeGreaterThanOrEqual(44);
    }
    const scrubber = (await page
      .locator("[data-reader-footer] canvas")
      .boundingBox())!;
    for (const control of [previous, next, title]) {
      const visual = (await control.boundingBox())!;
      expect(visual.height).toBe(control === title ? 32 : 22);
      const area = await hitArea(control);
      // Neighbouring targets do not cover any visible part of the control.
      expect(area.width).toBeGreaterThanOrEqual(Math.max(44, visual.width));
      expect(area.height).toBeGreaterThanOrEqual(44);
      // The scrubber keeps its full height under each control.
      expect(
        await page.evaluate(
          ([x, y]) => document.elementFromPoint(x, y)?.tagName,
          [visual.x + visual.width / 2, scrubber.y + 1],
        ),
      ).toBe("CANVAS");
    }

    // A tap beside the visible Back control still leaves the book.
    const backBounds = (await back.boundingBox())!;
    await page.touchscreen.tap(
      backBounds.x - 5,
      backBounds.y + backBounds.height / 2,
    );
    await expect(page).toHaveURL(/\/$/);
  });
});
