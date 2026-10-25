import { expect, test } from "@playwright/test";
import { addText, article, paragraphs, phone, signUp } from "./phone";

const floe = article("https://example.com/floe", { title: "A floe at dawn" });
const tundra = article("https://example.com/tundra", {
  title: "The tundra in winter",
});

test.beforeEach(async ({ context }) => {
  await signUp(context);
  await phone(context.request).push([...floe.records, ...tundra.records]);
  for (const item of [floe, tundra])
    await addText(
      context.request,
      item,
      `<h2>${item.url}</h2>${paragraphs(12)}`,
    );
});

test("theme, reading type and layout stay with this browser", async ({
  page,
}) => {
  await page.goto("/settings");
  await page.getByRole("radio", { name: "Dark" }).check({ force: true });
  await page.getByRole("radio", { name: "Flexoki" }).check({ force: true });
  await page.getByRole("radio", { name: "Book" }).check({ force: true });
  await page.getByRole("button", { name: "Larger text" }).click();
  await page.getByRole("radio", { name: "List" }).check({ force: true });

  // public/appearance.js sets the theme before the app runs.
  await page.goto("/");
  const root = page.locator("html");
  await expect(root).toHaveAttribute("data-theme", "flexoki");
  await expect(root).toHaveAttribute("data-mode", "dark");
  await expect(page.locator(".grid")).toHaveAttribute("data-layout", "list");
  expect(
    await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
  ).toBe("rgb(16, 15, 15)");

  await page.locator(".card-title", { hasText: "A floe at dawn" }).click();
  const prose = page.locator(".prose");
  await expect(prose).toHaveCSS("font-size", "21px");
  await expect(prose).toHaveCSS("font-family", /Iowan Old Style/);
  // The reader's own shortcut makes the text larger again.
  await page.keyboard.press("=");
  await expect(prose).toHaveCSS("font-size", "22px");
});
