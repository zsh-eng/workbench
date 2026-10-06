import { expect, test, type Page } from "@playwright/test";
import { POSTS } from "./fixture";

const cardLink = (page: Page, postId: string) => page.locator(`.card[data-post="${postId}"] .card-link`);
const postPath = (page: Page) => new URL(page.url()).pathname;

test("keyboard: search, grid arrows, open, step and close back to the card", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".card")).toHaveCount(11);
  await page.keyboard.press("/");
  await expect(page.getByRole("searchbox")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(cardLink(page, POSTS.photo)).toBeFocused();

  await page.keyboard.press("ArrowRight");
  await expect(cardLink(page, POSTS.photo)).not.toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(cardLink(page, POSTS.photo)).toBeFocused();

  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  expect(postPath(page)).toBe(`/post/${POSTS.photo}`);
  await expect(dialog).toContainText("1 of 11");

  await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(new RegExp(`/post/${POSTS.carousel}`));
  await expect(dialog).toContainText("2 of 11");

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/);
  await expect(cardLink(page, POSTS.carousel)).toBeFocused();
});

test("Back closes the detail, Forward reopens it, and a deep link reloads into it", async ({ page }) => {
  await page.goto("/?topic=Engineering");
  await expect(page.locator(".card")).toHaveCount(3);
  await cardLink(page, POSTS.video).click();
  await expect(page.getByRole("dialog")).toBeVisible();

  await page.goBack();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(/\/\?topic=Engineering$/);

  await page.goForward();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.reload();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("#detail-title")).toHaveText("Maker 3");
  await expect(dialog.locator(".detail-position")).toHaveText(/of 3$/);
  await expect(page.getByRole("checkbox", { name: /^Engineering/ })).toHaveAttribute("aria-checked", "true");
});

test("video loads only after intent; a GIF loops muted", async ({ page }) => {
  await page.goto(`/post/${POSTS.video}`);
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator(".stage-img").last()).toBeVisible();
  await expect(page.locator("video")).toHaveCount(0);

  await page.getByRole("button", { name: "Play video" }).click();
  const video = page.locator("video");
  await expect(video).toHaveAttribute("preload", "metadata");
  await expect(video.locator("track[kind=captions]")).toHaveCount(1);
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(0);
  // Escape still closes after Play moved focus.
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("video")).toHaveCount(0);

  await page.goto(`/post/${POSTS.gif}`);
  const gif = page.locator("video");
  await expect(gif).toHaveJSProperty("muted", true);
  await expect(gif).toHaveJSProperty("loop", true);
  await expect.poll(() => gif.evaluate((v: HTMLVideoElement) => !v.paused)).toBe(true);
});

async function transformAnimations(page: Page) {
  return page.evaluate(() =>
    document
      .getAnimations()
      .filter((a) => (a.effect as KeyframeEffect).getKeyframes().some((k) => k.transform && k.transform !== "none"))
      .map((a) => Number((a.effect as KeyframeEffect).getTiming().duration)),
  );
}

test("the card travels into the detail, and reduced motion removes that travel", async ({ browser }) => {
  for (const reducedMotion of ["no-preference", "reduce"] as const) {
    const context = await browser.newContext({ reducedMotion, viewport: { width: 1280, height: 860 } });
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.locator(".card img.is-shown").first()).toBeVisible();
    await cardLink(page, POSTS.photo).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    const travelling = await transformAnimations(page);
    if (reducedMotion === "reduce") expect(travelling).toEqual([]);
    else expect(travelling.length).toBeGreaterThan(0);
    await context.close();
  }
});

test("hovering a video card previews it muted, one card at a time", async ({ page }) => {
  await page.goto("/");
  const video = page.locator(`.card[data-post="${POSTS.video}"]`);
  const gif = page.locator(`.card[data-post="${POSTS.gif}"]`);
  await video.hover();
  await expect(video.locator("video.card-preview.is-playing")).toHaveCount(1);
  await expect(video.locator("video.card-preview")).toHaveJSProperty("muted", true);
  await gif.hover();
  await expect(gif.locator("video.card-preview")).toHaveCount(1);
  await expect(page.locator("video.card-preview")).toHaveCount(1);
  await page.mouse.move(2, 2);
  await expect(page.locator("video.card-preview")).toHaveCount(0);
});
