import { test, expect, type Page } from "@playwright/test";
const source = "https://example.com/essay?edition=1&ref=reading#chapter-two";
const seed = {
  version: 1,
  annotations: [],
  articles: [
    {
      id: "one",
      title: "The shape of a good idea",
      description: "How tools leave room for the work.",
      author: "Ada Reader",
      tags: [
        "Design",
        "Artificial intelligence",
        "Software",
        "Culture",
        "Life & ideas",
        "Science",
      ],
      url: source,
      savedAt: 2,
      saved: true,
      archived: false,
      favourite: false,
      bodyPath: "/seed/bodies/one.html",
      minutes: 3,
    },
    {
      id: "two",
      title: "The patient city",
      description: "A place to walk and think.",
      author: "Ben Writer",
      tags: ["Cities"],
      url: "https://example.org/city",
      savedAt: 1,
      saved: true,
      archived: false,
      favourite: false,
    },
  ],
};
const body =
  '<p>A good tool leaves room for the work. A few quiet minutes become enough to read and keep a thought for another day.</p><h2>A wider perspective</h2><figure><img alt="A landscape" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII="><figcaption>A small illustration.</figcaption></figure><p>Reading gives ideas the space they need.</p><script>window.__unsafe = true</script><img src="x" onerror="window.__unsafe = true"><a href="javascript:alert(1)">Unsafe link</a>';
async function prepare(page: Page) {
  await page.route("**/seed/index.json", (route) =>
    route.fulfill({ json: seed }),
  );
  await page.route("**/seed/bodies/one.html", (route) =>
    route.fulfill({ contentType: "text/html", body }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("navigation", { name: "Library folders" }),
  ).toBeVisible();
}
test("search, tag filters, hover actions, and durable archive/save state", async ({
  page,
}) => {
  await prepare(page);
  await page.getByRole("textbox", { name: "Search articles" }).fill("Ada");
  await expect(page.locator(".article-card")).toHaveCount(1);
  await page.getByRole("button", { name: "Clear search" }).click();
  await page
    .locator(".tag-sidebar")
    .getByRole("button", { name: /Cities/ })
    .click();
  await expect(page.locator(".article-card")).toHaveCount(1);
  await expect(page.locator(".article-card h2")).toHaveText("The patient city");
  await page.getByRole("button", { name: "Clear “Cities”" }).click();
  await expect(page.locator(".article-card")).toHaveCount(2);
  const card = page.locator(".article-card").first();
  await card.hover();
  await card
    .getByRole("button", { name: "Favourite article", exact: true })
    .click();
  await card
    .getByRole("button", { name: "Archive article", exact: true })
    .click();
  await expect(page.locator(".article-card")).toHaveCount(1);
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(page.locator(".article-card h2")).toHaveText(
    "The shape of a good idea",
  );
  await page.reload();
  await expect(page.locator(".article-card h2")).toHaveText(
    "The shape of a good idea",
  );
  await page.locator(".article-card").hover();
  await page.getByRole("button", { name: "Restore article" }).click();
  await page.getByRole("button", { name: "Favourites", exact: true }).click();
  await expect(page.locator(".article-card")).toHaveCount(1);
  await page.locator(".article-card").hover();
  await page.getByRole("button", { name: "Unsave article" }).click();
  await expect(page.locator(".article-card")).toHaveCount(0);
  await page.getByRole("button", { name: "All articles", exact: true }).click();
  await page.locator(".article-card").first().hover();
  await page.getByRole("button", { name: "Save article", exact: true }).click();
  await page.getByRole("button", { name: "Reading list", exact: true }).click();
  await expect(page.locator(".article-card")).toHaveCount(2);
});
test("article URL survives reload; quote annotation, edit, delete, and safe HTML", async ({
  page,
}) => {
  await prepare(page);
  await page
    .getByRole("link")
    .filter({
      has: page.getByRole("heading", { name: "The shape of a good idea" }),
    })
    .click();
  await expect(page).toHaveURL(`/read/${encodeURIComponent(source)}`);
  await expect(page.getByTestId("article-body")).toContainText("A good tool");
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "The shape of a good idea",
  );
  await expect(page.getByTestId("article-body")).toContainText("A good tool");
  const bodyWidth = await page
    .locator(".article-body")
    .evaluate((node) => node.getBoundingClientRect().width);
  const figureWidth = await page
    .locator(".article-body figure")
    .evaluate((node) => node.getBoundingClientRect().width);
  expect(figureWidth).toBeGreaterThan(bodyWidth);
  expect(await page.evaluate(() => (window as any).__unsafe)).toBeUndefined();
  await expect(page.locator(".article-body script")).toHaveCount(0);
  await expect(
    page.locator(".article-body a").filter({ hasText: "Unsafe link" }),
  ).not.toHaveAttribute("href");
  await page
    .locator(".article-body p")
    .first()
    .evaluate((node) => {
      const range = document.createRange();
      range.setStart(node.firstChild!, 0);
      range.setEnd(node.firstChild!, 35);
      window.getSelection()!.removeAllRanges();
      window.getSelection()!.addRange(range);
    });
  await page.getByRole("button", { name: "Add note", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Write a note" })
    .fill("Keep room for thought.");
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(page.locator(".annotation")).toContainText(
    "Keep room for thought.",
  );
  await expect(page.locator(".article-highlight")).toHaveCount(1);
  await page.reload();
  await expect(page.locator(".article-highlight")).toHaveCount(1);
  await page.getByRole("button", { name: "Edit annotation" }).click();
  await page
    .getByRole("textbox", { name: "Edit note" })
    .fill("An updated thought.");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator(".annotation")).toContainText(
    "An updated thought.",
  );
  await page.getByRole("button", { name: "Delete annotation" }).click();
  await expect(page.locator(".annotation")).toHaveCount(0);
  await expect(page.locator(".article-highlight")).toHaveCount(0);
  await page.goBack();
  await expect(
    page.getByRole("navigation", { name: "Library folders" }),
  ).toBeVisible();
});
test("tag editing and add link use real persistent state", async ({ page }) => {
  await prepare(page);
  await page.locator(".article-card").first().hover();
  await page
    .locator(".article-card")
    .first()
    .getByRole("button", { name: "Edit tags" })
    .click();
  await page
    .getByRole("textbox", { name: "Tags, separated by commas" })
    .fill("Design, Keep, Keep");
  await page.getByRole("button", { name: "Save tags" }).click();
  await expect(page.locator(".tag-sidebar")).toContainText("Keep");
  await page.getByRole("button", { name: "Add article" }).click();
  await page
    .getByRole("textbox", { name: "Article URL" })
    .fill("https://example.net/new?x=one&y=two#part");
  await page
    .getByRole("button", { name: "Save article", exact: true })
    .last()
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "example.net",
  );
  await expect(
    page.getByRole("link", { name: "Open original", exact: true }).last(),
  ).toHaveAttribute("href", "https://example.net/new?x=one&y=two#part");
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "example.net",
  );
});
test("mobile layout exposes actions and places notes after the article", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepare(page);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await expect(
    page
      .locator(".article-card")
      .first()
      .getByRole("button", { name: "Archive article" }),
  ).toBeVisible();
  await page.locator(".card-top").first().click();
  await expect(page.getByTestId("article-body")).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page
    .getByRole("textbox", { name: "Write a note" })
    .fill("A mobile note");
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(page.locator(".annotation")).toContainText("A mobile note");
});

test("sort select updates article order and supports keyboard dismissal", async ({
  page,
}) => {
  await prepare(page);
  const sort = page.getByRole("combobox", { name: "Sort articles" });
  await sort.click();
  await page.getByRole("option", { name: "Title A–Z" }).click();
  await expect(page.locator(".article-card h2").first()).toHaveText(
    "The patient city",
  );
  await expect(page).toHaveURL(/sort=title/);
  await page.reload();
  await expect(sort).toHaveText("Title A–Z");
  await sort.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(sort).toHaveText("Newest first");
  await expect(page.locator(".article-card h2").first()).toHaveText(
    "The shape of a good idea",
  );
  await sort.click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(sort).toBeFocused();
});
