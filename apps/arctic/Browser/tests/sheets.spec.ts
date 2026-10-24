import { expect, test } from "@playwright/test";
import { addText, article, paragraphs, phone, signUp } from "./phone";

// A phone, where the sheets' code loads on its own.
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

test.beforeEach(async ({ context }) => {
  await signUp(context);
});

test("a sheet whose code failed to load opens on the next tap", async ({
  page,
  context,
}) => {
  const floe = article("https://example.com/floe", { title: "A floe at dawn" });
  await phone(context.request).push(floe.records);
  await addText(context.request, floe, paragraphs(12));
  // No connection for the sheet's code: its preload and the first tap fail.
  let offline = true;
  await page.route("**/src/sheet.tsx*", (route) =>
    offline ? route.abort("internetdisconnected") : route.continue(),
  );
  await page.goto("/");
  await page.locator(".card-title", { hasText: "A floe at dawn" }).click();
  await expect(page.locator(".prose")).toContainText("Paragraph 12.");
  const text = page
    .getByRole("toolbar", { name: "Article" })
    .getByRole("button", { name: "Text and theme" });
  await text.click();
  await expect(page.locator(".toast")).toContainText("could not open");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  offline = false;
  await text.click();
  await expect(
    page.getByRole("dialog", { name: "Text and theme" }),
  ).toBeVisible();
});
