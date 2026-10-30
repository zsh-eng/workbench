import { test, expect } from "./helpers/fixtures";

// Installed Safari bar sampling needs a device. Every theme takes the same
// path to the browser's tint; dark is the one that once kept a white bar.
test("restores the dark browser appearance on launch", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "epub-reader-settings",
      JSON.stringify({ theme: "dark" }),
    );
    localStorage.setItem("epub-reader-appearance", "dark");
  });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Choose EPUB files", exact: true }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
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
  expect(appearance.tint).toBe("#0a0a0a");
  expect(appearance.canvas).toBe(appearance.body);
});

// Chrome on Android may not read oklch() or hsl() in theme-color and then
// keeps the manifest's white, so each theme's page colour goes in as hex:
// from index.html's startup script, then from the app.
test("each theme gives the browser bar its page colour in hex", async ({
  page,
}) => {
  const themes = {
    light: "#ffffff",
    dark: "#0a0a0a",
    night: "#000000",
    "flexoki-light": "#fffcf0",
    "flexoki-dark": "#100f0f",
  };
  const tint = page.locator('meta[name="theme-color"]');
  for (const [theme, hex] of Object.entries(themes)) {
    await page.goto("/");
    await page.evaluate((theme) => {
      localStorage.setItem("epub-reader-settings", JSON.stringify({ theme }));
      localStorage.removeItem("epub-reader-appearance");
    }, theme);

    // The startup script alone, before the app runs.
    await page.route("**/src/main.tsx", (route) => route.abort());
    await page.goto("/");
    await expect(tint).toHaveAttribute("content", hex);
    await page.unroute("**/src/main.tsx");

    await page.reload();
    await expect(
      page.getByRole("button", { name: "Choose EPUB files", exact: true }),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveClass(
      new RegExp(`(^|\\s)${theme}(\\s|$)`),
    );
    await expect(tint).toHaveAttribute("content", hex);
  }
});

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
