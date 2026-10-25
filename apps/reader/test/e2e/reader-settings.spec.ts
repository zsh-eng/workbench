import {
  test,
  expect,
  openLocalBook,
  openReaderTool,
  waitForReaderReady,
  waitForSheetToRest,
} from "./helpers/fixtures";

// The phone is the primary device; the desktop panel saves the same settings.
test.describe("Reader settings on a phone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  test("persist choices and keep page navigation working without animation", async ({
    page,
    localBook,
  }) => {
    await openLocalBook(page, localBook.id);
    const openSettings = async () => {
      // This fixture has no reading status. Its contextual action mounts
      // only after the Reader accepts chrome interactions.
      await expect(
        page.getByRole("button", { name: "Mark as reading", exact: true }),
      ).toBeVisible();
      const tools = page.getByRole("button", {
        name: "Open reader tools",
        exact: true,
      });
      const bounds = await tools.boundingBox();
      if (!bounds || bounds.y < 0) await page.touchscreen.tap(195, 350);
      await expect(tools).toBeInViewport();
      const settings = await openReaderTool(page, "Appearance", "Appearance");
      await settings.getByRole("tab", { name: "Layout" }).click();
      // The sheet grows to fit the tab on its spring; tap once it rests.
      await waitForSheetToRest(settings);
    };
    await openSettings();
    for (const name of ["Page animations", "Page numbers"]) {
      const toggle = page.getByRole("switch", { name, exact: true });
      await toggle.tap();
      await expect(toggle).not.toBeChecked();
    }
    await expect
      .poll(async () =>
        page.evaluate(() =>
          JSON.parse(localStorage.getItem("epub-reader-settings") || "{}"),
        ),
      )
      .toMatchObject({
        pageAnimationsEnabled: false,
        showPageNumbers: false,
      });
    await page.reload();
    await waitForReaderReady(page);
    // The footer carries the page numbers; show it before checking them.
    await page.touchscreen.tap(195, 350);
    await expect(page.getByTestId("reader-page-indicator")).toHaveCount(0);
    const current = page
      .locator(
        '[data-reader-spread-layer="current"] [data-reader-current-page]',
      )
      .first();
    const before = await current.getAttribute("data-reader-current-page");
    await page.keyboard.press("ArrowRight");
    await expect(current).not.toHaveAttribute(
      "data-reader-current-page",
      before!,
    );
    await waitForReaderReady(page);
    await openSettings();
    await expect(
      page.getByRole("switch", { name: "Page animations", exact: true }),
    ).not.toBeChecked();
    const pageNumbers = page.getByRole("switch", {
      name: "Page numbers",
      exact: true,
    });
    await expect(pageNumbers).not.toBeChecked();
    await pageNumbers.tap();
    await expect(pageNumbers).toBeChecked();
    await page.reload();
    await waitForReaderReady(page);
    await page.touchscreen.tap(195, 350);
    await expect(page.getByTestId("reader-page-indicator")).toHaveCount(1);
  });

  test("the status prompt saves the status locally and then leaves", async ({
    page,
    localBook,
  }) => {
    await openLocalBook(page, localBook.id);
    const action = page
      .locator("[data-reader-top-prompt]")
      .getByRole("button", { name: "Mark as reading", exact: true });
    await expect(action).toBeVisible();
    await action.click();
    await expect(action).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(async (bookId) => {
          const modulePath = "/src/lib/db.ts";
          const { getReadingStatus } = await import(modulePath);
          return getReadingStatus(bookId);
        }, localBook.id),
      )
      .toBe("reading");
    await page.reload();
    await waitForReaderReady(page);
    await expect(action).toHaveCount(0);
  });

  test("mobile settings apply choices and themes when preference storage is denied", async ({
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
    const settings = await openReaderTool(page, "Appearance", "Appearance");
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
    // The sheet grows to fit the tab on its spring; tap once it rests.
    await waitForSheetToRest(settings);
    await page.getByRole("button", { name: "Center", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Center", pressed: true }),
    ).toBeVisible();
    await page.getByRole("tab", { name: "Theme" }).click();
    await waitForSheetToRest(settings);
    await page.getByRole("button", { name: "Night", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Night", pressed: true }),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveClass(/night/);
    await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
  });
});
