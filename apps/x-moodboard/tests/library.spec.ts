import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import type { LibraryItem, LibraryProjection } from "../shared/schema";
import { POSTS } from "./fixture";

async function library(request: APIRequestContext) {
  const projection = (await (await request.get("/api/library")).json()) as LibraryProjection;
  const byPost = Object.fromEntries(projection.items.map((i) => [i.postId, i])) as Record<string, LibraryItem>;
  return { projection, byPost };
}

const card = (page: Page, postId: string) => page.locator(`.card[data-post="${postId}"]`);

test("imports X bookmarks only and keeps Telegram provenance out of the app", async ({ request }) => {
  const { projection, byPost } = await library(request);
  expect(projection.items).toHaveLength(11);
  expect(byPost[POSTS.telegramOnly]).toBeUndefined();
  expect(byPost[POSTS.overlap]).toBeDefined();

  const detail = await (await request.get(`/api/items/${byPost[POSTS.overlap].id}`)).text();
  const served = JSON.stringify(projection) + detail;
  expect(served).not.toContain("SECRET-TG");
  expect(served.toLowerCase()).not.toContain("telegram");

  expect(byPost[POSTS.truncated].textState).toBe("truncated");
  expect(byPost[POSTS.article].textState).toBe("article");
  expect(byPost[POSTS.poster].formats).toEqual(["video-preview"]);
  expect(byPost[POSTS.missing].states).toEqual(["missing-media", "topic-review"]);
  expect(byPost[POSTS.gone].states).toContain("missing-media");
  const gif = byPost[POSTS.gif].media[0];
  expect(gif.kind === "video" && gif.video?.gif && gif.poster?.derivedFrame).toBe(true);
});

test("the data boundary serves allowlisted media with byte ranges and refuses the rest", async ({ request }) => {
  const { byPost } = await library(request);
  const clip = byPost[POSTS.video].media.find((m) => m.kind === "video");
  if (clip?.kind !== "video" || !clip.video) throw new Error("fixture video missing");

  const ranged = await request.get(`/media/${clip.video.path}?v=${clip.video.rev}`, { headers: { range: "bytes=0-99" } });
  expect(ranged.status()).toBe(206);
  expect((await ranged.body()).length).toBe(100);
  expect(ranged.headers()["cache-control"]).toContain("immutable");

  expect((await request.get("/media/dataset.json")).status()).toBe(404);
  // Encoded separators survive URL normalisation; the allowlist still refuses them.
  expect((await request.get("/media/assets%2F..%2F..%2Fdataset.json")).status()).toBe(404);
  expect((await request.get("/derived/..%2Fuser-state.json")).status()).toBe(404);
  const write = await request.put(`/api/user-state/favourites/${POSTS.photo}`, { headers: { origin: "https://elsewhere.example" } });
  expect(write.status()).toBe(403);
});

test("search and filters combine: topics as a union, formats as an intersection", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".card")).toHaveCount(11);
  const count = page.locator(".result-count");

  await page.getByRole("checkbox", { name: /^Design inspiration/ }).click();
  await expect(count).toHaveText("3 of 11");
  await page.getByRole("checkbox", { name: /^Engineering/ }).click();
  await expect(count).toHaveText("5 of 11");
  // Facet counts show what each format would add within the current topics.
  await expect(page.getByRole("checkbox", { name: /^Videos/ })).toContainText("1");
  await page.getByRole("checkbox", { name: /^Videos/ }).click();
  await expect(count).toHaveText("1 of 11");
  await expect(card(page, POSTS.video)).toBeVisible();
  await expect(page).toHaveURL(/topic=Design\+inspiration&topic=Engineering&format=video/);

  await page.getByRole("button", { name: "Clear all" }).click();
  await expect(count).toHaveText("11 saved posts");

  await page.getByRole("searchbox").fill("bindery");
  await expect(count).toHaveText("1 of 11");
  await expect(card(page, POSTS.carousel)).toBeVisible();
  await page.getByRole("searchbox").fill("@maker7");
  await expect(card(page, POSTS.truncated)).toBeVisible();
  await expect(count).toHaveText("1 of 11");

  await page.getByRole("searchbox").fill("no such words anywhere");
  await expect(page.getByRole("heading", { name: /Nothing matches/ })).toBeVisible();
  await page.locator(".empty").getByRole("button", { name: "Clear search" }).click();
  await expect(count).toHaveText("11 saved posts");
});

test("cards and the detail view say what is partial or missing", async ({ page }) => {
  await page.goto("/");
  await expect(card(page, POSTS.poster)).toContainText("Video preview — open original");
  await expect(card(page, POSTS.truncated)).toContainText("Text cut short");
  await expect(card(page, POSTS.article)).toContainText("Preview only");
  await expect(card(page, POSTS.gone)).toContainText("Media not saved");
  await expect(card(page, POSTS.video)).toContainText("0:02");
  await expect(card(page, POSTS.gif)).toContainText("GIF");

  await page.goto(`/post/${POSTS.missing}`);
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("This photo was not saved locally.");
  await expect(dialog).toContainText("Topics · suggested, needs review");

  await page.goto(`/post/${POSTS.article}`);
  await expect(dialog).toContainText("Only the preview of this X article was saved.");
  await expect(dialog.getByRole("heading", { name: "On Craft and Patience" })).toBeVisible();

  await page.goto(`/post/${POSTS.carousel}`);
  await expect(dialog.locator(".stage-thumb")).toHaveCount(3);
  await page.keyboard.press("]");
  await page.keyboard.press("]");
  await expect(dialog.locator(".stage-caption")).toContainText("3 of 3 · Photo · 800×600 · from the quoted post by @quoted_author");
});
