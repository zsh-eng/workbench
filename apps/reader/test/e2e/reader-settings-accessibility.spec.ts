import {
  test,
  expect,
  openLocalBook,
  openReaderTools,
  waitForSheet,
} from "./helpers/fixtures";

test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});

test("mobile settings expose choices and apply themes when preference storage is denied", async ({
  page,
  localBook,
}) => {
  await page.addInitScript(() => {
    const get = Storage.prototype.getItem;
    const set = Storage.prototype.setItem;
    const preference = (key: string) =>
      key === "epub-reader-settings" || key === "epub-reader-appearance";
    Storage.prototype.getItem = function (key) {
      if (preference(key)) throw new DOMException("Denied", "SecurityError");
      return get.call(this, key);
    };
    Storage.prototype.setItem = function (key, value) {
      if (preference(key)) throw new DOMException("Denied", "SecurityError");
      return set.call(this, key, value);
    };
  });
  await openLocalBook(page, localBook.id);
  await page.touchscreen.tap(195, 422);
  const tools = await openReaderTools(page);
  await tools.getByRole("button", { name: "Appearance", exact: true }).click();
  await waitForSheet(page, "Appearance");
  await expect(
    page.getByRole("button", { name: "Lora", pressed: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "System", exact: true }).click();
  await expect(
    page.getByText("Appearance changes weren’t saved.", { exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "System", pressed: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Layout" }).click();
  for (const name of ["Left", "Center", "Right", "Justify"]) {
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  }
  await page.getByRole("button", { name: "Center", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Center", pressed: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Theme" }).click();
  await page.getByRole("button", { name: "Night", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Night", pressed: true }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveClass(/night/);
  await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
});
