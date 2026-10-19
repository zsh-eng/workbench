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
  test("a centre tap toggles the bars, whose controls have 44 px touch targets", async ({
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
    // Let both bars finish sliding in before measuring.
    await expect(header).toHaveCSS("transform", "none");
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
      const area = await hitArea(control);
      expect(area.width).toBeGreaterThanOrEqual(44);
      expect(area.height).toBeGreaterThanOrEqual(44);
    }
    const scrubber = (await page
      .locator("[data-reader-footer] canvas")
      .boundingBox())!;
    for (const control of [previous, next, title]) {
      const visual = (await control.boundingBox())!;
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
