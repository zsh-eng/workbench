import { expect, test } from "@playwright/test";
import {
  addText,
  article,
  eventually,
  paragraphs,
  phone,
  signUp,
} from "./phone";

test.beforeEach(async ({ context }) => {
  await signUp(context);
  // Publisher images, as a site serves them: a 1200 × 630 picture.
  await context.route("https://images.example/**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><rect width="1200" height="630" fill="#9ab"/></svg>',
    }),
  );
});

test("shows the cover image once when the text starts with it", async ({
  page,
  context,
}) => {
  // The text has the cover through an image proxy, at another size.
  const floe = article("https://example.com/floe", {
    title: "A floe at dawn",
    image: "https://images.example/photos/floe-at-dawn-1200x630.jpg",
  });
  const tundra = article("https://example.com/tundra", {
    title: "The tundra in winter",
    image: "https://images.example/photos/tundra.jpg",
  });
  await phone(context.request).push([...floe.records, ...tundra.records]);
  await addText(
    context.request,
    floe,
    `<figure><img src="https://images.example/_next/image?url=%2Fphotos%2Ffloe-at-dawn.jpg&w=3840"><figcaption>The floe, from the ship.</figcaption></figure>${paragraphs(12)}`,
  );
  await addText(
    context.request,
    tundra,
    `<p><img src="https://images.example/photos/reindeer.jpg"></p>${paragraphs(12)}`,
  );

  await page.goto("/");
  // The cards show reading times once the text records arrive.
  await expect(page.locator(".card[data-copy]")).toHaveCount(2);
  const prose = page.locator(".prose");
  const open = async (title: string) => {
    await page.locator(".card-title", { hasText: title }).click();
    await expect(prose).toContainText("Paragraph 12.");
  };

  // The picture shows once. The page waits only a moment for its text; a
  // text that arrives later keeps the cover and drops its own copy.
  await open("A floe at dawn");
  await expect(page.locator(".hero img, .prose img")).toHaveCount(1);
  // With the text ready, its own image and caption take the cover's place.
  await page.goBack();
  await open("A floe at dawn");
  await expect(page.locator(".hero")).toHaveCount(0);
  await expect(prose.locator("img")).toHaveCount(1);
  await expect(prose.locator("figcaption")).toHaveText(
    "The floe, from the ship.",
  );

  // Another picture in the text shows with the cover.
  await page.goBack();
  await open("The tundra");
  await expect(page.locator(".hero img")).toHaveCount(1);
  await expect(prose.locator("img")).toHaveCount(1);
});

test("counts reading time as the phone does and syncs it in the phone's format", async ({
  page,
  context,
}) => {
  const ice = article("https://example.com/ice-time", {
    title: "How sea ice keeps time",
  });
  await phone(context.request).push(ice.records);
  await addText(context.request, ice, paragraphs(40));
  await page.clock.install();
  await page.goto("/");
  await page.locator(".card-title", { hasText: "sea ice" }).click();
  await expect(page.locator(".prose")).toContainText("Paragraph 40.");
  // Read offline: a jump of the clock would time out a sync in flight. The
  // time counts all the same and uploads when the network returns.
  await context.setOffline(true);

  // 50 s between two actions counts; a pause over 3 minutes counts for
  // nothing.
  let x = 100;
  const act = () => page.mouse.move((x += 10), 300);
  await act();
  await page.clock.runFor(50_000);
  await act();
  await page.clock.runFor(240_000);
  await act();
  await page.clock.runFor(20_000);
  await act();
  await expect(page.locator(".byline")).toContainText("Read for 1 min");

  // Leaving the article ends the visit. Back online, it uploads: 70 s and
  // the moments around the actions, without the pause.
  await page.keyboard.press("Escape");
  await expect(page.locator(".card")).toHaveCount(1);
  await context.setOffline(false);
  const reading = phone(context.request, "arctic-reading");
  await eventually(
    async () =>
      [...(await reading.records()).values()].map(
        (record) => JSON.parse(record.value).seconds,
      )[0],
  ).toBeGreaterThanOrEqual(70);
  expect(
    JSON.parse([...(await reading.records()).values()][0]!.value).seconds,
  ).toBeLessThan(80);
  const [[key, record]] = [...(await reading.records())];
  expect(key).toMatch(/^session\/[0-9A-F-]{36}$/);
  const value = JSON.parse(record.value);
  expect(Object.keys(value)).toEqual([
    "articleURL",
    "id",
    "seconds",
    "startedAt",
    "updatedAt",
  ]);
  expect(value).toMatchObject({ articleURL: ice.url, id: key.slice(8) });
  // Swift reference dates: seconds since 2001.
  expect(value.startedAt).toBeGreaterThan(8e8);

  await page.goto("/reading");
  await expect(page.locator(".week-total")).toHaveText("1 min");
  await expect(page.locator(".read-rows li")).toHaveText([
    /How sea ice keeps time\s*1 min/,
  ]);
});

test("highlights and notes passages in the phone's format, and shows the phone's", async ({
  page,
  context,
}) => {
  const floe = article("https://example.com/floe-notes", {
    title: "Notes on a floe",
  });
  await phone(context.request).push(floe.records);
  await addText(context.request, floe, paragraphs(12));
  await page.goto("/");
  await expect(page.locator(".card[data-copy]")).toHaveCount(1);
  await page.locator(".card-title", { hasText: "Notes on a floe" }).click();
  await expect(page.locator(".prose")).toContainText("Paragraph 12.");

  // Select the start of the third paragraph, as a reader would.
  await page.evaluate(() => {
    const text = document.querySelectorAll(".prose p")[2]!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, "Paragraph 3. Sea ice forms".length);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
  });
  await page.getByRole("button", { name: "Highlight sage" }).click();
  await eventually(() =>
    page.evaluate(() => CSS.highlights.has("arctic-sage")),
  ).toBe(true);

  const annotations = phone(context.request, "arctic-annotations");
  await eventually(async () => (await annotations.records()).size).toBe(1);
  const [[key, record]] = [...(await annotations.records())];
  expect(key).toMatch(/^annotation\/[0-9A-F-]{36}$/);
  const value = JSON.parse(record.value);
  expect(Object.keys(value)).toEqual([
    "articleURL",
    "colour",
    "createdAt",
    "id",
    "isHighlighted",
    "note",
    "quote",
    "updatedAt",
  ]);
  expect(value).toMatchObject({
    articleURL: floe.url,
    colour: "sage",
    isHighlighted: true,
    note: "",
    quote: { exact: "Paragraph 3. Sea ice forms" },
  });
  expect(Object.keys(value.quote)).toEqual([
    "exact",
    "prefix",
    "start",
    "suffix",
  ]);
  expect(value.quote.prefix).toMatch(/goes\.$/);

  // Select the highlight, and write a note on it.
  const box = await page.evaluate(() => {
    const range = [...CSS.highlights.get("arctic-sage")!][0] as Range;
    const rect = range.getBoundingClientRect();
    return { x: rect.left + 20, y: rect.top + rect.height / 2 };
  });
  await page.mouse.click(box.x, box.y);
  await page.getByRole("button", { name: "Note", exact: true }).click();
  await page.getByPlaceholder("Add a note").fill("Floes keep a calendar.");
  await eventually(
    async () =>
      JSON.parse([...(await annotations.records()).values()][0]!.value).note,
  ).toBe("Floes keep a calendar.");

  // The phone's passage finds its place by text, though its offset differs.
  await annotations.push([
    {
      key: "annotation/6F1C2C1E-9A4B-4C55-8E61-1D2B3C4D5E6F",
      value: JSON.stringify({
        articleURL: floe.url,
        colour: "rose",
        createdAt: 800_000_000,
        id: "6F1C2C1E-9A4B-4C55-8E61-1D2B3C4D5E6F",
        isHighlighted: true,
        note: "",
        quote: {
          exact: "Paragraph 7.",
          prefix: "where it goes.",
          start: 9999,
          suffix: " Sea ice",
        },
        updatedAt: 800_000_000,
      }),
    },
  ]);
  await page.keyboard.press("Escape");
  await page.reload();
  await eventually(() =>
    page.evaluate(() => CSS.highlights.has("arctic-rose")),
  ).toBe(true);
  await page.getByRole("button", { name: "Notes" }).click();
  await expect(page.locator(".notes-panel .passage")).toHaveText([
    /Paragraph 3\. Sea ice formsFloes keep a calendar\./,
    /Paragraph 7\./,
  ]);
  await page.keyboard.press("Escape");

  // The Highlights page opens a passage in its article.
  await page.goto("/highlights");
  await expect(page.locator(".highlight-list h2")).toHaveText([
    "Notes on a floe",
  ]);
  await page
    .locator(".highlight-list blockquote", { hasText: "Paragraph 7." })
    .click();
  await eventually(() =>
    page.evaluate(() => CSS.highlights.has("arctic-focus")),
  ).toBe(true);

  // Remove leaves a tombstone, as on the phone.
  const rose = await page.evaluate(() => {
    const range = [...CSS.highlights.get("arctic-rose")!][0] as Range;
    const rect = range.getBoundingClientRect();
    return { x: rect.left + 10, y: rect.top + rect.height / 2 };
  });
  await page.mouse.click(rose.x, rose.y);
  await page.getByRole("button", { name: "Remove" }).click();
  await eventually(
    async () =>
      JSON.parse(
        (await annotations.records()).get(
          "annotation/6F1C2C1E-9A4B-4C55-8E61-1D2B3C4D5E6F",
        )!.value,
      ).deletedAt,
  ).toBeGreaterThan(800_000_000);
  expect(await page.evaluate(() => CSS.highlights.has("arctic-rose"))).toBe(
    false,
  );
});
