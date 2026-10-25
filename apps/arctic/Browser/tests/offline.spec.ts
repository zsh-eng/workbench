import { expect, test } from "@playwright/test";
import { addText, article, paragraphs, phone, signUp } from "./phone";

// The production project: a build with its service worker.
test("downloads saved text for reading offline", async ({ page, context }) => {
  await signUp(context);
  const floe = article("https://example.com/floe", { title: "A floe at dawn" });
  const tundra = article("https://example.com/tundra", {
    title: "The tundra in winter",
  });
  await phone(context.request).push([...floe.records, ...tundra.records]);
  // Different texts, so two files.
  for (const item of [floe, tundra])
    await addText(
      context.request,
      item,
      `<h2>${item.url}</h2>${paragraphs(12)}`,
    );

  await page.goto("/settings");
  await page.getByRole("button", { name: "Download 2 texts" }).click();
  await expect(page.locator(".offline-status")).toContainText(
    "2 of 2 texts on this device",
  );
  await expect(
    page.getByRole("button", { name: "All text is on this device" }),
  ).toBeDisabled();

  // Neither article was opened before. The service worker keeps the app.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.goto("/");
  await page.locator(".card-title", { hasText: "The tundra" }).click();
  await expect(page.locator(".prose")).toContainText("Paragraph 12.");
});
