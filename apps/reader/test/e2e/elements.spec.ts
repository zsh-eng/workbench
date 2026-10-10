import { test, expect } from "./helpers/fixtures";

test.use({
  viewport: { width: 1440, height: 900 },
  isMobile: false,
  hasTouch: false,
});

test("Elements shows a specimen on desktop and phone and changes it in place", async ({
  page,
}) => {
  await page.goto("/debug/elements");
  const section = page.locator("#chrome");
  await section.scrollIntoViewIfNeeded();
  const frames = {
    desktop: section.locator('iframe[title$="desktop"]'),
    phone: section.locator('iframe[title$="phone"]'),
  };
  const desktop = frames.desktop.contentFrame();
  const phone = frames.phone.contentFrame();
  await expect(
    desktop.getByRole("button", { name: "Mark as reading", exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  // The phone frame has the phone layout: the prompt floats at the top edge.
  await expect(
    phone
      .locator("[data-reader-top-prompt]")
      .getByRole("button", { name: "Mark as reading", exact: true }),
  ).toBeVisible();

  // A state change reaches both frames without a reload.
  const desktopWindow = (await frames.desktop.elementHandle())!;
  await desktopWindow.evaluate((frame: HTMLIFrameElement) => {
    (frame.contentWindow as Window & { kept?: boolean }).kept = true;
  });
  await section
    .getByRole("button", { name: "Newer position", exact: true })
    .click();
  for (const frame of [desktop, phone])
    await expect(
      frame.getByRole("button", { name: /^Continue at p\. 86 from iPad/ }),
    ).toBeVisible();
  expect(
    await desktopWindow.evaluate(
      (frame: HTMLIFrameElement) =>
        (frame.contentWindow as Window & { kept?: boolean }).kept,
    ),
  ).toBe(true);

  // The frame theme is a preview; the page keeps the saved theme.
  await page.getByLabel("Frame theme").selectOption("night");
  await expect(desktop.locator("html")).toHaveClass(/\bnight\b/);
  await expect(page.locator("html")).not.toHaveClass(/\bnight\b/);
});
