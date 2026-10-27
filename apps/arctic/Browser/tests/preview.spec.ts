import { expect, test, type Page } from "@playwright/test";
import { article, eventually, identity, phone, signUp } from "./phone";
import { publisher } from "./publisher";

/**
 * A link saved here is saved at once, with a title from its address; its
 * page's title, description, image and icon follow from the shared API's
 * preview route, which fetches a publisher on this machine.
 */
let site: Awaited<ReturnType<typeof publisher>>;
test.beforeAll(async () => {
  // A slow publisher: the save must not wait for it.
  site = await publisher({ delayMs: 1500 });
});
test.afterAll(async () => {
  await site.close();
});
test.beforeEach(async ({ context }) => {
  await signUp(context);
});

async function save(page: Page, url: string) {
  await page.getByRole("button", { name: "Save a link" }).click();
  await page.getByPlaceholder("Paste a link").fill(url);
  await page.getByRole("button", { name: "Save", exact: true }).click();
}

/**
 * Notes, in the page, each state of the new card: whether it keeps a
 * picture's place, and whether that place holds a picture already decoded.
 */
const watchCard = (page: Page, id: string) =>
  page.evaluate((id) => {
    const states: string[] = [];
    (window as unknown as { states: string[] }).states = states;
    new MutationObserver(() => {
      const card = document.querySelector<HTMLElement>(`.card[data-id="${id}"]`);
      if (!card) return;
      const image = card.querySelector<HTMLImageElement>(".cover img");
      const state = `${card.querySelector(".cover") ? "cover" : "none"} ${image ? (image.complete && image.naturalWidth ? "decoded" : "loading") : "empty"}`;
      if (states.at(-1) !== state) states.push(state);
    }).observe(document.body, { subtree: true, childList: true, attributes: true });
  }, id);
const states = (page: Page) =>
  page.evaluate(() => (window as unknown as { states: string[] }).states);

test("a link is saved at once, and its page's title, picture, description and icon follow", async ({
  page,
  context,
}) => {
  const older = article("https://example.com/floe", { title: "A floe at dawn" });
  await phone(context.request).push(older.records);
  await page.goto("/");
  await expect(page.locator(".card")).toHaveCount(1);
  const id = identity(site.story);
  await watchCard(page, id);

  await save(page, site.story);
  const card = page.locator(`.card[data-id="${id}"]`);
  // At once: the title from the address, and the picture's place kept
  // empty while the page loads.
  await expect(card.locator(".card-title")).toHaveText("How sea ice keeps time");
  await expect(page.locator(".toast")).toContainText("Saved");
  await expect(card.locator(".cover")).toBeVisible();
  expect(site.hits).not.toContain("/cover.svg");

  // Then the page's own: the picture fills its place, decoded, in one change.
  await expect(card.locator(".card-title")).toHaveText(
    "The quiet clock of sea ice",
  );
  await expect(card).toHaveAttribute("data-image", "");
  await expect(card.locator(".cover img")).toHaveAttribute(
    "src",
    `${site.origin}/cover.svg`,
  );
  await expect(card.locator("img.favicon")).toHaveAttribute(
    "src",
    `${site.origin}/icon.svg`,
  );
  expect(await states(page)).toEqual(["cover empty", "cover decoded"]);

  // The phone receives the preview in its own fields; the other records
  // stay the web's new link.
  const arctic = phone(context.request);
  await eventually(
    async () =>
      (await arctic.records()).get(`article/${id}`)?.value.includes("imageURL"),
  ).toBe(true);
  expect(JSON.parse((await arctic.records()).get(`article/${id}`)!.value)).toEqual({
    faviconURL: `${site.origin}/icon.svg`,
    imageURL: `${site.origin}/cover.svg`,
    subtitle: "Each winter’s ice keeps a record of the season that made it.",
    title: "The quiet clock of sea ice",
    url: site.story,
  });
});

test("in List, the links below do not move when a new link's picture arrives", async ({
  page,
  context,
}) => {
  await context.addInitScript(() =>
    localStorage.setItem("arctic:settings", JSON.stringify({ layout: "list" })),
  );
  await phone(context.request).push(
    ["A floe at dawn", "Harbour towns, revisited", "Paper maps"].flatMap(
      (title, index) =>
        article(`https://example.com/${index}`, {
          title,
          savedAt: Date.UTC(2026, 9, 1) - index * 60_000,
        }).records,
    ),
  );
  await page.goto("/");
  await expect(page.locator(".card")).toHaveCount(3);
  const id = identity(site.story);
  await save(page, site.story);
  const card = page.locator(`.card[data-id="${id}"]`);
  await expect(card.locator(".card-title")).toHaveText("How sea ice keeps time");
  const boxes = () =>
    page
      .locator(".card")
      .evaluateAll((cards) =>
        cards.map((card) => {
          const { top, height } = card.getBoundingClientRect();
          return { top: Math.round(top), height: Math.round(height) };
        }),
      );
  // Once the toast and the insert's motion have settled.
  await page.waitForTimeout(600);
  const before = await boxes();
  await expect(card).toHaveAttribute("data-image", "");
  await page.waitForTimeout(600);
  expect(await boxes()).toEqual(before);
});
