import {
  test,
  expect,
  openAccountMenu,
  openLocalBook,
} from "./helpers/fixtures";

for (const mobile of [false, true]) {
  test.describe(
    mobile ? "mobile debug settings" : "desktop debug settings",
    () => {
      test.use({
        viewport: mobile
          ? { width: 390, height: 844 }
          : { width: 1280, height: 900 },
        isMobile: mobile,
        hasTouch: mobile,
      });

      test("persists the switch and gates navigation, Reader tools, and diagnostic routes", async ({
        page,
        localBook,
      }) => {
        await page.goto("/settings");
        const toggle = page.getByRole("switch", { name: "Debug mode" });
        await expect(toggle).toBeChecked();
        await toggle.uncheck();
        await page.reload();
        await expect(toggle).not.toBeChecked();
        expect(
          await page.evaluate(() =>
            localStorage.getItem("reader-debug-enabled-v1"),
          ),
        ).toBe("false");
        await page.screenshot({
          path: `test-results/settings-${mobile ? "mobile" : "desktop"}.png`,
        });

        await page.goto("/");
        let menu = await openAccountMenu(page);
        await expect(
          menu.getByRole("menuitem", { name: "Debug tools" }),
        ).toHaveCount(0);
        await menu.getByRole("menuitem", { name: "Settings" }).click();
        await expect(toggle).not.toBeChecked();

        for (const path of [
          "/debug",
          "/reader-traces",
          `/debug/reader/${localBook.id}`,
          "/diagnostics/reader",
        ]) {
          await page.goto(path);
          await expect(
            page.getByRole("heading", { name: "Debug mode is off" }),
          ).toBeVisible();
          await page.getByRole("link", { name: "Open settings" }).click();
          await expect(toggle).not.toBeChecked();
        }

        await openLocalBook(page, localBook.id);
        if (mobile) {
          await page.touchscreen.tap(195, 422);
        } else {
          await page.mouse.move(600, 20);
        }
        await page
          .getByRole("button", { name: "Open reader tools", exact: true })
          .click();
        await expect(
          page.getByRole("button", { name: /copy debug dump/i }),
        ).toHaveCount(0);

        await page.goto("/settings");
        await toggle.check();
        await page.reload();
        await expect(toggle).toBeChecked();
        await page.goto("/");
        menu = await openAccountMenu(page);
        await menu.getByRole("menuitem", { name: "Debug tools" }).click();
        await page.getByRole("link", { name: /^Performance/ }).click();
        await expect(
          page.getByRole("switch", { name: "Record reader traces" }),
        ).toBeVisible();

        await openLocalBook(page, localBook.id);
        if (mobile) {
          await page.touchscreen.tap(195, 422);
        } else {
          await page.mouse.move(600, 20);
        }
        await page
          .getByRole("button", { name: "Open reader tools", exact: true })
          .click();
        await expect(
          page.getByRole("button", { name: /copy debug dump/i }),
        ).toBeVisible();
      });
    },
  );
}
