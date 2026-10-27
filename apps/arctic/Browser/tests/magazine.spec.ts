import { expect, test, type Page } from "@playwright/test";
import { addText, article, identity, paragraphs, phone, signUp } from "./phone";
import { publisher } from "./publisher";

// The Magazine layout (docs/MAGAZINE.md) on an iPad: WebKit with touch.
test.use({ browserName: "webkit", hasTouch: true });

// Publisher images as sites serve them: an og:image, a square one, a site
// icon given as the og:image, and one that is gone.
const svg = (width: number, height: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#9ab"/></svg>`;
const image = (name: string) => `https://images.example/${name}`;

// Newest first. The lead and a tile; a run of six links without a picture
// (one fills the tile's row, four make a band of two rows, one is a site
// cover); then a square picture, a broken one, an icon and a wide one.
const links = [
  { title: "A floe at dawn", image: image("og/floe.jpg") },
  { title: "Harbour towns, revisited", image: image("og/harbour.jpg") },
  { title: "Notes on school lunches", subtitle: "What a canteen knows." },
  { title: "Quiet databases" },
  { title: "Paper maps" },
  { title: "The long walk" },
  { title: "Sea ice, again" },
  { title: "Cold storage", subtitle: "Why it matters more than ever." },
  { title: "A square picture", image: image("square/1.jpg") },
  { title: "A gone picture", image: image("gone/1.jpg") },
  { title: "An icon only", image: image("icon/1.png") },
  { title: "Tundra in winter", image: image("og/tundra.jpg") },
].map((link, index, all) =>
  article(`https://example.com/${index}`, {
    ...link,
    savedAt: Date.UTC(2026, 9, 1) + (all.length - index) * 60_000,
  }),
);
const [lead] = links;

test.beforeEach(async ({ context }, testInfo) => {
  await context.route("https://images.example/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith("/gone/")) return route.fulfill({ status: 404 });
    // A site's icon, as a PNG of 64 × 64.
    if (path.startsWith("/icon/"))
      return route.fulfill({ path: "public/icon-64.png" });
    const [width, height] = path.startsWith("/square/")
      ? [800, 800]
      : [1200, 630];
    return route.fulfill({
      contentType: "image/svg+xml",
      body: svg(width, height),
    });
  });
  await context.addInitScript(
    ({ id, chosen }) => {
      if (sessionStorage.getItem("seeded")) return;
      sessionStorage.setItem("seeded", "1");
      if (chosen)
        localStorage.setItem(
          "arctic:settings",
          JSON.stringify({ layout: "magazine" }),
        );
      // The reader left the lead 40% of the way through.
      localStorage.setItem(`arctic:position:${id}`, "0.4");
    },
    // The test of the default layout chooses none.
    { id: lead!.id, chosen: !testInfo.title.startsWith("The default") },
  );
  await signUp(context);
  await phone(context.request).push(links.flatMap((link) => link.records));
  await addText(context.request, lead!, paragraphs(12));
});

/** Each cell's kind and box, and the picture boxes, in the list's order. */
function layout(page: Page) {
  return page.evaluate(() => {
    const box = (element: Element) => {
      const { left, top, width, height } = element.getBoundingClientRect();
      return { left, top, width, height };
    };
    const grid = document.querySelector(".grid")!;
    return {
      columns: getComputedStyle(grid).gridTemplateColumns.split(" ").length,
      cells: [...grid.children].map((cell) => ({
        kind: cell.classList.contains("band")
          ? "band"
          : (cell as HTMLElement).dataset.kind,
        title: cell.querySelector(".card-title")?.textContent,
        site: !!cell.querySelector(".site-cover"),
        ...box(cell),
        cover:
          cell.querySelector(".cover") && box(cell.querySelector(".cover")!),
        headlines: [...cell.querySelectorAll(".card")].map(box),
      })),
    };
  });
}

for (const size of [
  { width: 820, height: 1180, picture: 366 },
  { width: 1024, height: 1366, picture: 468 },
  { width: 1180, height: 820, picture: 426 },
  { width: 1366, height: 1024, picture: 519 },
])
  test(`At ${size.width}×${size.height}, two columns of og:images, a lead, and links without one as site covers and a band`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await page.goto("/");
    await expect(page.locator(".card[data-id]")).toHaveCount(links.length);
    // Pictures below the first screen load lazily.
    await page.locator(".card").last().scrollIntoViewIfNeeded();
    await expect(page.locator(".cover img[data-loaded]")).toHaveCount(4);
    await expect(page.locator(".site-cover")).toHaveCount(4);
    const { columns, cells } = await layout(page);
    expect(columns).toBe(2);
    expect(cells.map((cell) => cell.kind)).toEqual([
      "lead",
      "tile",
      "tile",
      "band",
      "tile",
      "tile",
      "tile",
      "tile",
      "tile",
    ]);

    // Pictures at the og:image's 1.91:1, larger than Cards' (273–364 px).
    const tile = cells[1]!;
    expect(tile.cover!.width).toBeCloseTo(size.picture, -1);
    expect(tile.cover!.width / tile.cover!.height).toBeCloseTo(1.91, 1);
    expect(cells[0]!.cover!.width).toBeGreaterThan(tile.cover!.width);

    // The link without a picture beside the tile fills its row as a cover
    // the same size, with the title set inside it.
    expect(cells[2]).toMatchObject({ site: true, top: tile.top });
    expect(cells[2]!.cover!.height).toBeCloseTo(tile.cover!.height, 0);
    await expect(
      page.getByRole("link", { name: /^Notes on school lunches/ }),
    ).toBeVisible();

    // The band: four headlines in whole rows, aligned across the columns.
    const band = cells[3]!;
    expect(band.left).toBeCloseTo(tile.left, 0);
    expect(band.headlines).toHaveLength(4);
    const [a, b, c, d] = band.headlines;
    expect(a!.top).toBe(b!.top);
    expect(c!.top).toBe(d!.top);
    expect(b!.left).toBeCloseTo(cells[2]!.left, 0);

    // The last link of the run is a site cover; a square picture shows
    // whole; a gone picture and a site icon become site covers.
    expect(cells.slice(4).map((cell) => [cell.title, cell.site])).toEqual([
      ["Cold storage", true],
      ["A square picture", false],
      ["A gone picture", true],
      ["An icon only", true],
      ["Tundra in winter", false],
    ]);
    await expect(
      page.locator(".card", { hasText: "A square picture" }).locator("img"),
    ).toHaveAttribute("data-shape", "upright");
    // No broken image is left in the page.
    await expect(page.locator(".cover img")).toHaveCount(4);

    // The lead shows how far this browser has read it.
    expect(
      await page
        .locator('.card[data-kind="lead"] .progress-line')
        .evaluate((line: HTMLElement) =>
          line.style.getPropertyValue("--progress"),
        ),
    ).toBe("0.4");
    // Nothing is wider than the screen.
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(size.width);
  });

test("A link saved on an iPad leads at once in its picture's place, which its og:image then fills", async ({
  page,
}) => {
  const site = await publisher({ delayMs: 1500 });
  try {
    await page.setViewportSize({ width: 820, height: 1180 });
    await page.goto("/");
    await expect(page.locator(".card[data-id]")).toHaveCount(links.length);
    const id = identity(site.story);
    // Each state of the new card: its kind, and whether its picture's
    // place holds a picture, and that picture is decoded.
    await page.evaluate((id) => {
      const states: string[] = [];
      (window as unknown as { states: string[] }).states = states;
      new MutationObserver(() => {
        const card = document.querySelector<HTMLElement>(`.card[data-id="${id}"]`);
        if (!card) return;
        const image = card.querySelector<HTMLImageElement>(".cover img");
        const state = `${card.dataset.kind} ${card.querySelector(".cover") ? "cover" : "none"} ${image ? (image.complete && image.naturalWidth ? "decoded" : "loading") : "empty"}`;
        if (states.at(-1) !== state) states.push(state);
      }).observe(document.body, { subtree: true, childList: true, attributes: true });
    }, id);
    await page.getByRole("button", { name: "Save a link" }).click();
    await page.getByPlaceholder("Paste a link").fill(site.story);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    const lead = page.locator(`.card[data-id="${id}"]`);
    await expect(lead).toHaveAttribute("data-kind", "lead");
    await expect(lead.locator(".card-title")).toHaveText("How sea ice keeps time");
    await page.waitForTimeout(500);
    const before = await layout(page);
    await expect(lead.locator(".card-title")).toHaveText("The quiet clock of sea ice");
    await page.waitForTimeout(500);
    const after = await layout(page);
    // One change: the empty place, then the decoded picture in it.
    expect(
      await page.evaluate(() => (window as unknown as { states: string[] }).states),
    ).toEqual(["lead cover empty", "lead cover decoded"]);
    // The picture's place keeps its size and position; the grid keeps its
    // cells (the old lead is now a tile).
    expect(after.cells[0]!.cover).toEqual(before.cells[0]!.cover);
    expect(after.cells.map((cell) => cell.kind)).toEqual(
      before.cells.map((cell) => cell.kind),
    );
    expect(after.cells[1]).toMatchObject({ kind: "tile", title: "A floe at dawn" });
  } finally {
    await site.close();
  }
});

test("A tap on a picture or a site cover opens the article", async ({
  page,
}) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.goto("/");
  await page.locator('.card[data-kind="lead"] .cover').tap();
  await expect(page.locator(".prose")).toContainText("Paragraph 12.");
  await page.goBack();
  await page.getByRole("link", { name: /^Notes on school lunches/ }).tap();
  await expect(page).toHaveURL(new RegExp(`/read/${links[2]!.id}$`));
});

test("In Split View, Magazine keeps two columns to 600 px, then one", async ({
  page,
}) => {
  for (const [width, columns] of [
    [678, 2],
    [504, 1],
    [375, 1],
  ] as const) {
    await page.setViewportSize({ width, height: 1024 });
    await page.goto("/");
    await expect(page.locator(".card[data-id]")).toHaveCount(links.length);
    expect((await layout(page)).columns).toBe(columns);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
  }
});

test("In a wide window, three columns, and the lead's picture takes exactly two", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1680, height: 1000 });
  await page.goto("/");
  await expect(page.locator(".card[data-id]")).toHaveCount(links.length);
  const { columns, cells } = await layout(page);
  expect(columns).toBe(3);
  const tiles = cells.filter((cell) => cell.kind === "tile");
  expect(cells[0]!.cover!.left).toBeCloseTo(tiles[0]!.left, 0);
  // Two columns and the gap between them: from the first column's left
  // edge to the second's right edge.
  expect(cells[0]!.cover!.left + cells[0]!.cover!.width).toBeCloseTo(
    tiles[1]!.left + tiles[1]!.width,
    0,
  );
});

test("The layout switch offers Magazine, Cards and List", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.goto("/");
  const grid = page.locator("main.grid");
  await expect(grid).toHaveAttribute("data-layout", "magazine");
  const choice = page.getByRole("radiogroup", { name: "Layout" });
  await choice.getByRole("radio", { name: "Cards" }).check({ force: true });
  await expect(grid).toHaveAttribute("data-layout", "cards");
  await expect(page.locator(".band, .site-cover")).toHaveCount(0);
  await choice.getByRole("radio", { name: "Magazine" }).check({ force: true });
  await expect(grid).toHaveAttribute("data-layout", "magazine");
});

test("The default is Magazine on a touch screen wider than a phone, List on a phone-sized one", async ({
  page,
}) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.goto("/");
  await expect(page.locator("main.grid")).toHaveAttribute(
    "data-layout",
    "magazine",
  );
  await page.evaluate(() => localStorage.removeItem("arctic:settings"));
  await page.setViewportSize({ width: 375, height: 812 });
  await page.reload();
  await expect(page.locator("main.grid")).toHaveAttribute(
    "data-layout",
    "list",
  );
});
