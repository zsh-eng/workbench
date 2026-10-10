import { test, expect, openLocalBook } from "./helpers/fixtures";

test("focused Reader controls stay available after the pointer leaves", async ({
  page,
  localBook,
}) => {
  await openLocalBook(page, localBook.id);
  const header = page.locator('[data-reader-header="desktop"]');
  await header
    .getByRole("button", { name: "Dismiss reading status prompt" })
    .click();
  await expect(header.locator("[data-reader-header-accessory]")).toHaveCount(0);
  const viewport = page.viewportSize()!;
  await page.mouse.move(viewport.width / 2, viewport.height / 2);
  await expect(header).toHaveAttribute("aria-hidden", "true");
  await page.locator('[data-reader-chrome-rail="top"]').hover();
  const tools = header.getByRole("button", {
    name: "Open reader tools",
    exact: true,
  });
  await tools.focus();
  await page.clock.install();
  await page.mouse.move(viewport.width / 2, viewport.height / 2);
  await page.clock.fastForward(300);
  await expect(header).toHaveAttribute("aria-hidden", "false");
  await expect(tools).toBeFocused();
  await page.keyboard.press("Enter");
  const sidebar = page.locator('aside[aria-label="Reader tools"]');
  await expect(sidebar).toHaveAttribute("aria-hidden", "false");
  // Escape returns focus to the trigger, which keeps the header open.
  await page.keyboard.press("Escape");
  await expect(sidebar).toHaveAttribute("aria-hidden", "true");
  await expect(tools).toBeFocused();
  await page.clock.fastForward(300);
  await expect(header).toHaveAttribute("aria-hidden", "false");

  await tools.evaluate((button) => button.blur());
  await page.clock.fastForward(300);
  await expect(header).toHaveAttribute("aria-hidden", "true");
});

test("library supports skip navigation and keyboard book opening", async ({
  page,
  localBook,
}) => {
  await expect(page.getByRole("main")).toHaveCount(1);
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
  const book = page.getByRole("link", { name: /Open Alice/ });
  await book.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/reader/${localBook.id}`));
});

test("reading progress supports native keyboard navigation", async ({
  page,
  localBook,
}) => {
  await openLocalBook(page, localBook.id);
  await page.locator('[data-reader-header="desktop"]').hover();
  const progress = page.getByRole("slider", { name: "Reading page" });
  await expect(progress).toBeAttached();
  await progress.focus();
  const before = Number(await progress.inputValue());
  await page.keyboard.press("ArrowRight");
  await expect(progress).toHaveValue(
    String(before + Number(await progress.getAttribute("step"))),
  );
});
