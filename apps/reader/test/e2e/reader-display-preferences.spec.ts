import {
  test,
  expect,
  openLocalBook,
  waitForReaderReady,
} from "./helpers/fixtures";

for (const mobile of [true, false]) {
  test.describe(
    mobile ? "mobile display preferences" : "desktop display preferences",
    () => {
      test.use({
        viewport: mobile
          ? { width: 390, height: 844 }
          : { width: 1440, height: 1000 },
        isMobile: mobile,
        hasTouch: mobile,
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
          if (!bounds || bounds.y < 0) {
            if (mobile) await page.touchscreen.tap(195, 350);
            else await page.locator('[data-reader-chrome-rail="top"]').hover();
          }
          await expect(tools).toBeInViewport();
          await page
            .getByRole("button", { name: "Open reader tools", exact: true })
            .click();
          if (mobile) {
            await page
              .getByRole("button", { name: /Themes & settings$/ })
              .click();
            await page.getByRole("tab", { name: "Layout" }).click();
          } else {
            await page
              .getByRole("button", { name: "Reading appearance", exact: true })
              .click();
          }
        };
        await openSettings();
        for (const name of ["Page animations", "Page numbers"]) {
          const toggle = page.getByRole("switch", { name, exact: true });
          if (mobile) await toggle.tap();
          else await toggle.click();
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
        if (mobile) await page.touchscreen.tap(195, 350);
        else await page.locator('[data-reader-chrome-rail="bottom"]').hover();
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
        await expect(
          page.getByRole("switch", { name: "Page numbers", exact: true }),
        ).not.toBeChecked();
        const pageNumbers = page.getByRole("switch", {
          name: "Page numbers",
          exact: true,
        });
        if (mobile) await pageNumbers.tap();
        else await pageNumbers.click();
        await expect(pageNumbers).toBeChecked();
        await page.reload();
        await waitForReaderReady(page);
        // The footer carries the page numbers; show it before checking them.
        if (mobile) await page.touchscreen.tap(195, 350);
        else await page.locator('[data-reader-chrome-rail="bottom"]').hover();
        await expect(page.getByTestId("reader-page-indicator")).toHaveCount(1);
      });
    },
  );
}

test.describe("reading status prompt", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  test("keeps the status prompt in place as the chrome toggles and saves locally", async ({
    page,
    localBook,
  }) => {
    await openLocalBook(page, localBook.id);
    const action = page
      .locator("[data-reader-top-prompt]")
      .getByRole("button", { name: "Mark as reading", exact: true });
    await expect(action).toBeVisible();
    const before = await action.boundingBox();
    expect(before!.y).toBeLessThan(64);
    const note = page.getByRole("button", { name: "Jot a note" });
    for (let toggle = 0; toggle < 2; toggle++) {
      const chromeShown = await note.isVisible();
      await page.touchscreen.tap(195, 350);
      await expect(note).toBeVisible({ visible: !chromeShown });
      expect(await action.boundingBox()).toEqual(before);
    }
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
});
