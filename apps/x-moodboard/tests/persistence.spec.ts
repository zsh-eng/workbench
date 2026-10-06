import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { POSTS, runImport, SOURCE, writeDataset } from "./fixture";

const card = (page: Page, postId: string) => page.locator(`.card[data-post="${postId}"]`);

test("favourites and topic edits persist through reload", async ({ page }) => {
  await page.goto(`/post/${POSTS.link}`);
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Add to favourites" }).click();
  await expect(dialog.getByRole("button", { name: "Favourite", exact: true })).toHaveAttribute("aria-pressed", "true");

  await dialog.getByRole("button", { name: "Edit" }).click();
  await dialog.getByRole("checkbox", { name: "Design inspiration" }).check();
  await dialog.getByRole("button", { name: "Save topics" }).click();
  await expect(dialog.locator(".topic-list")).toContainText("Design inspiration");
  await expect(dialog).toContainText("Topics · edited by you");
  await expect(dialog).toContainText("Archive suggested: Ideas & culture.");

  await page.reload();
  await expect(dialog.getByRole("button", { name: "Favourite", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.locator(".topic-list")).toContainText("Design inspiration");

  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Favourites/ }).click();
  await expect(page.locator(".card")).toHaveCount(1);
  await expect(card(page, POSTS.link)).toHaveClass(/is-favourite/);
  // Edited topics take part in filtering.
  await page.getByRole("button", { name: /^All saved posts/ }).click();
  await page.getByRole("checkbox", { name: /^Design inspiration/ }).click();
  await expect(card(page, POSTS.link)).toBeVisible();
});

test("a failed save is undone, explained, and can be retried", async ({ page }) => {
  await page.route("**/api/user-state/favourites/**", (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Disk is full (test)" }) }),
  );
  await page.goto(`/post/${POSTS.photo}`);
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Add to favourites" }).click();
  const toast = page.locator(".toast--error");
  await expect(toast).toContainText("Could not save the favourite: Disk is full (test)");
  await expect(dialog.getByRole("button", { name: "Add to favourites" })).toHaveAttribute("aria-pressed", "false");

  await page.unroute("**/api/user-state/favourites/**");
  await toast.getByRole("button", { name: "Try again" }).click();
  await expect(dialog.getByRole("button", { name: "Favourite", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Favourite", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("a validated re-import updates the open library in place and keeps favourites", async ({ page }) => {
  await page.goto("/");
  await expect(card(page, POSTS.photo)).toHaveClass(/is-favourite/);

  const dataset = JSON.parse(readFileSync(join(SOURCE, "dataset.json"), "utf8")) as { items: { post_id: string; text: string }[] };
  const target = dataset.items.find((i) => i.post_id === POSTS.photo)!;
  target.text = `${target.text} Revised after enrichment.`;
  writeDataset(dataset.items);
  runImport();

  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator(".toast")).toContainText("Library updated: 1 post new or changed");
  await expect(card(page, POSTS.photo)).toContainText("Revised after enrichment.");
  await expect(card(page, POSTS.photo)).toHaveClass(/is-favourite/);
});

test("narrow screens keep everything reachable without sideways scrolling", async ({ page }) => {
  for (const [width, height] of [
    [320, 640],
    [720, 450], // 1440 × 900 at 200 % zoom
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await expect(page.locator(".card").first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `overflow at ${width}px`).toBeLessThanOrEqual(0);
  }
  await page.setViewportSize({ width: 320, height: 640 });
  await page.getByRole("button", { name: "Filters" }).click();
  const sheet = page.getByRole("dialog", { name: "Filters" });
  await sheet.getByRole("checkbox", { name: /^Videos/ }).click();
  await sheet.getByRole("button", { name: "Show 2" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.locator(".result-count")).toHaveText("2 of 11");
  await expect(page.getByRole("button", { name: "Filters, 1 active" })).toBeVisible();
});
