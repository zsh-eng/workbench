import { expect, test } from "@playwright/test";
import { addText, article, paragraphs, phone, signUp } from "./phone";

test.beforeEach(async ({ context }) => {
  await signUp(context);
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
  await page.locator(".card-title", { hasText: "A floe at dawn" }).click();
  await expect(page.locator(".prose")).toContainText("Paragraph 12.");
  // The text's own image, with its caption, takes the cover's place.
  await expect(page.locator(".hero")).toHaveCount(0);
  await expect(page.locator(".prose img")).toHaveCount(1);
  await expect(page.locator(".prose figcaption")).toHaveText(
    "The floe, from the ship.",
  );

  await page.goBack();
  await page.locator(".card-title", { hasText: "The tundra" }).click();
  await expect(page.locator(".prose")).toContainText("Paragraph 12.");
  await expect(page.locator(".hero img")).toHaveCount(1);
  await expect(page.locator(".prose img")).toHaveCount(1);
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

  // 50 s between two actions counts; a 3-minute pause counts for nothing.
  let x = 100;
  const act = () => page.mouse.move((x += 10), 300);
  await act();
  await page.clock.runFor(50_000);
  await act();
  await page.clock.runFor(180_000);
  await act();
  await page.clock.runFor(20_000);
  await act();
  await expect(page.locator(".byline")).toContainText("Read for 1 min");

  // Leaving the article ends the visit; its upload follows a moment later.
  await page.keyboard.press("Escape");
  await expect(page.locator(".card")).toHaveCount(1);
  await page.clock.runFor(5_000);
  const reading = phone(context.request, "arctic-reading");
  // A checkpoint during the long pause uploaded 50 s; leaving uploads the
  // rest: 70 s and the moments around the actions, without the pause.
  await expect
    .poll(
      async () =>
        [...(await reading.records()).values()].map(
          (record) => JSON.parse(record.value).seconds,
        )[0],
      { timeout: 15_000 },
    )
    .toBeGreaterThanOrEqual(70);
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
