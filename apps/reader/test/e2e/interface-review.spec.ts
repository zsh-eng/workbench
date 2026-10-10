import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import { test, expect, openLocalBook, nextSpread } from "./helpers/fixtures";

// The same fixture, viewport and sequence generate both sides of the review.
const stage = process.env.INTERFACE_REVIEW_STAGE ?? "after";
const directory = resolve("diagnostics/interface-review", stage);
async function capture(page: Page, name: string) {
  await mkdir(directory, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: resolve(directory, `${name}.png`),
    animations: "disabled",
  });
}
async function selectPassage(page: Page) {
  for (let i = 0; i < 8; i++) await nextSpread(page);
  await page.evaluate(() => {
    const root = document.querySelector(
      '[data-reader-spread-layer="current"]',
    )!;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && (node.textContent?.trim().length ?? 0) < 40)
      node = walker.nextNode();
    if (!node) throw new Error("No sample passage");
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, 40);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
  });
  await page.evaluate(() =>
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true })),
  );
  await expect(
    page.getByRole("button", { name: "Highlight with yellow" }),
  ).toBeVisible();
}

test("review desktop library and empty highlights", async ({
  page,
  localBook,
}) => {
  await page.setViewportSize({ width: 1280, height: 850 });
  await expect(page.getByRole("heading", { name: /Alice/ })).toBeVisible();
  await capture(page, "library");
  await page.getByRole("heading", { name: /Alice/ }).click({ button: "right" });
  await expect(page.getByRole("menu")).toBeVisible();
  await capture(page, "book-menu");
  await page.keyboard.press("Escape");
  await page.goto("/highlights");
  await expect(
    page.getByText("No highlights yet", { exact: true }),
  ).toBeVisible();
  await capture(page, "highlights-empty");
  expect(localBook.id).toBeTruthy();
});

test("review dark highlight contrast", async ({ page, localBook }) => {
  await page.setViewportSize({ width: 1280, height: 850 });
  await page.evaluate(() => {
    localStorage.setItem(
      "epub-reader-settings",
      JSON.stringify({
        fontSize: 16,
        lineHeight: 1.5,
        fontFamily: "lora",
        theme: "dark",
        textAlign: "left",
        contentWidth: "narrow",
        publisherBookStylingEnabled: false,
        matchPublisherBodyTextSize: false,
        pageAnimationsEnabled: false,
        showPageNumbers: true,
      }),
    );
  });
  await openLocalBook(page, localBook.id);
  await selectPassage(page);
  await capture(page, "desktop-picker");
  await page.getByRole("button", { name: "Highlight with yellow" }).click();
  await expect(
    page.locator('[data-reader-spread-layer="current"] mark').first(),
  ).toBeVisible();
  await capture(page, "dark-highlight");
});

test.describe("review mobile", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  test("review selection, notes and settings", async ({ page, localBook }) => {
    await openLocalBook(page, localBook.id);
    await selectPassage(page);
    await capture(page, "mobile-picker");
    await page.getByRole("button", { name: "Highlight with yellow" }).click();
    await page.touchscreen.tap(195, 350);
    await page
      .getByRole("button", { name: "Open reader tools", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await capture(page, "mobile-tools");
    await page.getByRole("button", { name: "Notebook", exact: true }).click();
    const input = page.getByRole("textbox", { name: "Write a note" });
    await expect(input).toBeVisible();
    await input.fill("A useful thought from this passage.");
    await capture(page, "note-composer");
    await page.getByRole("button", { name: "Back to reader tools" }).click();
    await page.getByRole("button", { name: "Themes & settings" }).click();
    await page.getByRole("tab", { name: "Type", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText(
      /Font family|Font family/,
    );
    await capture(page, "mobile-settings");
  });
});
