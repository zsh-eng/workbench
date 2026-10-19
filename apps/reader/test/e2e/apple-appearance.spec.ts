import { test, expect } from "./helpers/fixtures";

// CSS/browser integration checks; installed Safari bar sampling needs a device.
// Every theme takes the same path; dark is the one that once kept a white bar.
for (const theme of ["light", "dark"]) {
  test(`restores ${theme} browser appearance on launch`, async ({ page }) => {
    await page.addInitScript((theme) => {
      localStorage.setItem("epub-reader-settings", JSON.stringify({ theme }));
      localStorage.setItem("epub-reader-appearance", theme);
    }, theme);
    await page.goto("/");
    // A test's first page can also load Vite's cold application module graph.
    await expect(
      page.getByRole("button", { name: "Choose EPUB files", exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("html")).toHaveCSS("color-scheme", theme);
    const appearance = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      return {
        tint: document
          .querySelector('meta[name="theme-color"]')
          ?.getAttribute("content"),
        token: root.getPropertyValue("--background").trim(),
        canvas: root.backgroundColor,
        body: getComputedStyle(document.body).backgroundColor,
      };
    });
    expect(appearance.tint).toBe(appearance.token);
    expect(appearance.canvas).toBe(appearance.body);
  });
}

test("system appearance follows changes and survives a mobile reload", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.addInitScript(() => {
    if (!localStorage.getItem("epub-reader-appearance")) {
      localStorage.setItem("epub-reader-appearance", "system");
    }
  });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Choose EPUB files", exact: true }),
  ).toBeVisible();
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
  await expect
    .poll(() =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem("epub-reader-settings")!).theme,
      ),
    )
    .toBe("dark");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Choose EPUB files", exact: true }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveCSS("color-scheme", "light");
});

test("serves the declared Apple touch icon as a 180px image", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const href = await page
    .locator('link[rel="apple-touch-icon"]')
    .getAttribute("href");
  expect(href).toBeTruthy();
  const response = await request.get(href!);
  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"]).toContain("image/png");
  const size = await page.evaluate(async (href) => {
    const icon = new Image();
    icon.src = href!;
    await icon.decode();
    return [icon.naturalWidth, icon.naturalHeight];
  }, href);
  expect(size).toEqual([180, 180]);
});
