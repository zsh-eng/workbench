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
