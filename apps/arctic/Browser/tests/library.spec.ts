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
  await page.route("**/api/extract", (route) =>
    route.fulfill({
      status: 422,
      json: { error: "The publisher could not be loaded." },
    }),
  );
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
      range.setEnd(node.firstChild!, 36);
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
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("navigation", { name: "Library folders" }),
  ).toBeVisible();
  await expect(page.locator(".article-card")).toHaveCount(3);
  await page.reload();
  await page
    .locator(".card-top")
    .filter({
      has: page.getByRole("heading", { name: "example.net", exact: true }),
    })
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
test("mobile layout exposes actions and toggles notes beside the article", async ({
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
  await page.getByRole("button", { name: "Show notes", exact: true }).click();
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
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await sort.click();
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(sort).toBeFocused();
});

test("reader centers the article and toggles a persistent sidebar without losing drafts", async ({
  page,
}) => {
  await prepare(page);
  await page.locator(".card-top").first().click();
  await expect(page.getByTestId("article-body")).toBeVisible();
  await expect(page.locator(".site-header")).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "Write a note" }),
  ).toBeHidden();
  const bounds = await page.locator(".article-body").boundingBox();
  expect(
    Math.abs(bounds!.x + bounds!.width / 2 - page.viewportSize()!.width / 2),
  ).toBeLessThan(2);
  await page.keyboard.press("Control+Shift+B");
  const sidebar = page.getByRole("complementary", {
    name: "Article annotations",
  });
  await expect(sidebar).toBeVisible();
  await sidebar
    .getByRole("textbox", { name: "Write a note" })
    .fill("Keep this draft");
  await page.keyboard.press("Meta+Shift+B");
  await expect(sidebar).toBeHidden();
  await page.getByRole("button", { name: "Show notes", exact: true }).click();
  await expect(sidebar.getByRole("textbox")).toHaveValue("Keep this draft");
  await sidebar
    .getByRole("button", { name: "Favourite article", exact: true })
    .click();
  await expect(
    sidebar.getByRole("button", { name: "Remove favourite" }),
  ).toBeVisible();
  await page.reload();
  await expect(sidebar).toBeVisible();
  await page.getByRole("button", { name: "Hide notes", exact: true }).click();
  await page.reload();
  await expect(sidebar).toBeHidden();
  await page
    .getByRole("link", { name: "Back to reading list", exact: true })
    .click();
  await expect(page.locator(".site-header")).toBeVisible();
});

test("selection pill copies, colors, edits, and removes highlights while retaining notes", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await prepare(page);
  await page.locator(".card-top").first().click();
  const paragraph = page.locator(".article-body p").first();
  await expect(paragraph).toBeVisible();
  await paragraph.evaluate((node) => {
    const range = document.createRange();
    range.setStart(node.firstChild!, 0);
    range.setEnd(node.firstChild!, 36);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
  });
  const toolbar = page.getByRole("toolbar", {
    name: "Selected passage actions",
  });
  await expect(toolbar).toBeVisible();
  const pill = await toolbar.boundingBox();
  const text = await paragraph.boundingBox();
  expect(pill!.y + pill!.height).toBeLessThan(text!.y);
  await toolbar.getByRole("button", { name: "Copy text" }).click();
  await expect(toolbar.getByRole("status")).toHaveText("Copied!");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "A good tool leaves room for the work",
  );
  await toolbar.getByRole("button", { name: "Highlight blue" }).click();
  const mark = page.locator(".article-highlight");
  await expect(mark).toHaveAttribute("data-color", "blue");
  await page.reload();
  await expect(mark).toHaveAttribute("data-color", "blue");
  await mark.click();
  await toolbar.getByRole("button", { name: "Change to green" }).click();
  await expect(mark).toHaveAttribute("data-color", "green");
  await mark.focus();
  await page.keyboard.press("Enter");
  await toolbar.getByRole("button", { name: "Add note" }).click();
  await page
    .getByRole("textbox", { name: "Edit note" })
    .fill("Keep this thought");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(mark).toHaveAttribute("data-color", "green");
  await mark.click();
  await page.keyboard.press("Escape");
  await expect(toolbar).toHaveCount(0);
  await mark.click();
  await toolbar.getByRole("button", { name: "Remove green highlight" }).click();
  await expect(mark).toHaveCount(0);
  await expect(page.locator(".annotation")).toContainText("Keep this thought");
  await page.reload();
  await expect(mark).toHaveCount(0);
  await expect(page.locator(".annotation")).toContainText("Keep this thought");
});

test("slash focuses search but leaves URL and note typing alone", async ({
  page,
}) => {
  await prepare(page);
  await page.keyboard.press("/");
  const search = page.getByRole("textbox", { name: "Search articles" });
  await expect(search).toBeFocused();
  await expect(search).toHaveValue("");
  await page.keyboard.type("/");
  await expect(search).toHaveValue("/");
  await page.getByRole("button", { name: "Clear search" }).click();
  await page.getByRole("button", { name: "Add article", exact: true }).click();
  const url = page.getByRole("textbox", { name: "Article URL" });
  await url.fill("https:");
  await page.keyboard.type("//example.net/path");
  await expect(url).toHaveValue("https://example.net/path");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Add article", exact: true }),
  ).toBeFocused();
  await page.locator(".card-top").first().click();
  await page.getByRole("button", { name: "Show notes", exact: true }).click();
  const draft = page.getByRole("textbox", { name: "Write a note" });
  await draft.fill("and");
  await page.keyboard.type("/or");
  await expect(draft).toHaveValue("and/or");
  await page.getByRole("button", { name: "Hide notes", exact: true }).click();
  await page.keyboard.press("/");
  await expect(search).toBeFocused();
});

test("inline paste preview distinguishes Open from Save and dismisses without saving", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await prepare(page);
  await page.evaluate(() =>
    navigator.clipboard.writeText("https://example.net/open?edition=2#section"),
  );
  await page.getByRole("button", { name: "Add article", exact: true }).click();
  await page.getByRole("button", { name: "Paste link", exact: true }).click();
  await expect(page.locator(".add-link-preview")).toContainText("example.net");
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page).toHaveURL(
    `/read/${encodeURIComponent("https://example.net/open?edition=2#section")}`,
  );
  await page.getByRole("button", { name: "Show notes", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Save article", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Back to reading list", exact: true })
    .click();
  await expect(page.locator(".article-card")).toHaveCount(2);
  await page.getByRole("button", { name: "All articles", exact: true }).click();
  await expect(page.locator(".article-card")).toHaveCount(3);
  await page.evaluate((url) => {
    const data = new DataTransfer();
    data.setData("text/plain", url);
    document.body.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, source);
  await expect(page.locator(".add-link-preview")).toContainText(
    "The shape of a good idea",
  );
  await expect(
    page
      .locator(".add-link-preview")
      .getByRole("button", { name: "Save", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("textbox", { name: "Article URL" }).fill("not a link");
  await page.keyboard.press("Enter");
  await expect(page.locator(".add-article-panel [role=alert]")).toBeVisible();
  await page
    .getByRole("textbox", { name: "Article URL" })
    .fill("https://example.net/dismiss");
  await page.getByRole("button", { name: "Dismiss add article" }).click();
  await page.reload();
  await expect(page.locator(".article-card")).toHaveCount(3);
});

test("highlight toolbar appears immediately and fades only on exit", async ({
  page,
}) => {
  await prepare(page);
  await page.locator(".card-top").first().click();
  const paragraph = page.locator(".article-body p").first();
  await expect(paragraph).toBeVisible();
  await paragraph.evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
  });
  const toolbar = page.getByRole("toolbar");
  await expect(toolbar).toBeVisible();
  expect(
    await toolbar.evaluate((node) => ({
      opacity: getComputedStyle(node).opacity,
      animations: node.getAnimations().length,
    })),
  ).toEqual({ opacity: "1", animations: 0 });
  const exit = await page.evaluate(async () => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    const node = document.querySelector<HTMLElement>(
      "[data-highlight-toolbar]",
    );
    if (!node) return null;
    // Sample the real exit transition at its midpoint without racing frame timing.
    void getComputedStyle(node).opacity;
    const animation = node.getAnimations()[0];
    if (animation) {
      animation.pause();
      animation.currentTime = 75;
    }
    return {
      inert: node.inert,
      opacity: Number(getComputedStyle(node).opacity),
    };
  });
  expect(exit?.inert).toBe(true);
  expect(exit?.opacity).toBeLessThan(1);
  await expect(page.locator("[data-highlight-toolbar]")).toHaveCount(0);
});

test("card delete removes local article and notes; undo restores both", async ({
  page,
}) => {
  await prepare(page);
  await page.locator(".card-top").first().click();
  await page.getByRole("button", { name: "Show notes", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Write a note" })
    .fill("Keep this annotation");
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(page.locator(".annotation")).toContainText(
    "Keep this annotation",
  );
  await page
    .getByRole("link", { name: "Back to reading list", exact: true })
    .click();
  const card = page
    .locator(".article-card")
    .filter({ hasText: "The shape of a good idea" });
  await card.getByRole("button", { name: "Delete article" }).focus();
  await page.keyboard.press("Enter");
  await expect(card).toHaveCount(0);
  await expect(page.locator(".article-card")).toHaveCount(1);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(card).toHaveCount(1);
  await card.locator(".card-top").click();
  await expect(page.locator(".annotation")).toContainText(
    "Keep this annotation",
  );
  await page
    .getByRole("link", { name: "Back to reading list", exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  const remove = card.getByRole("button", { name: "Delete article" });
  await expect(remove).toBeVisible();
  const cardBox = await card.boundingBox();
  const actionBox = await remove.boundingBox();
  expect(actionBox!.x + actionBox!.width).toBeLessThanOrEqual(
    cardBox!.x + cardBox!.width,
  );
  await remove.click();
  await expect(card).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "All articles", exact: true }).click();
  await expect(page.locator(".article-card")).toHaveCount(1);
  await expect(page.locator(".article-card h2")).toHaveText("The patient city");
  await page.getByRole("button", { name: "Add article", exact: true }).click();
  await page.getByRole("textbox", { name: "Article URL" }).fill(source);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(
    page.getByRole("complementary", { name: "Article annotations" }),
  ).toBeVisible();
  await expect(page.locator(".annotation")).toHaveCount(0);
});

test("local reads stay quiet before the delay and retain slow-load and retry feedback", async ({
  page,
}) => {
  await page.clock.install();
  let releaseSeed!: () => void;
  const seedGate = new Promise<void>((resolve) => {
    releaseSeed = resolve;
  });
  await page.route("**/seed/index.json", async (route) => {
    await seedGate;
    await route.fulfill({ json: seed });
  });
  let releaseBody!: () => void;
  const bodyGate = new Promise<void>((resolve) => {
    releaseBody = resolve;
  });
  let failed = false;
  await page.route("**/seed/bodies/one.html", async (route) => {
    if (!failed) {
      await bodyGate;
      failed = true;
      await route.fulfill({ status: 503, body: "Unavailable" });
    } else await route.fulfill({ contentType: "text/html", body });
  });
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Arctic home" })).toBeVisible();
  await page.clock.runFor(250);
  await expect(
    page.getByText("Opening your reading list…", { exact: true }),
  ).toHaveCount(0);
  await page.clock.runFor(400);
  await expect(page.getByRole("status")).toHaveText(
    "Opening your reading list…",
  );
  releaseSeed();
  await expect(
    page.getByRole("navigation", { name: "Library folders" }),
  ).toBeVisible();
  await expect(
    page.getByText("Opening your reading list…", { exact: true }),
  ).toHaveCount(0);
  await page.locator(".card-top").first().click();
  await page.clock.runFor(250);
  await expect(
    page.getByText("Opening the article…", { exact: true }),
  ).toHaveCount(0);
  await page.clock.runFor(400);
  await expect(page.getByRole("status")).toHaveText("Opening the article…");
  releaseBody();
  await expect(page.getByRole("alert")).toContainText("could not be loaded");
  await expect(page.getByRole("status")).toHaveCount(0);
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByTestId("article-body")).toContainText("A good tool");
  await page.clock.runFor(500);
  await expect(page.getByRole("status")).toHaveCount(0);
});
