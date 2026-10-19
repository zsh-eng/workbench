import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import {
  test,
  expect,
  openLocalBook,
  openReaderTools,
  waitForSheet,
} from "./helpers/fixtures";

for (const mobile of [false, true]) {
  test.describe(mobile ? "mobile removal" : "desktop removal", () => {
    test.use({
      viewport: mobile
        ? { width: 390, height: 844 }
        : { width: 1280, height: 850 },
      isMobile: mobile,
      hasTouch: mobile,
    });
    test("cancel preserves the book and confirm removes it", async ({
      page,
      localBook,
    }) => {
      if (mobile) {
        await openLocalBook(page, localBook.id);
        await page.touchscreen.tap(195, 350);
        const tools = await openReaderTools(page);
        await tools.getByRole("button", { name: /Book status/ }).click();
        await waitForSheet(page, "Reading status");
      }
      const openConfirmation = async () => {
        if (!mobile) {
          await page
            .getByRole("heading", { name: /Alice/ })
            .click({ button: "right" });
          await page.getByRole("menuitem", { name: "Remove book…" }).click();
        } else
          await page
            .getByRole("button", { name: "Remove book", exact: true })
            .click();
      };
      await openConfirmation();
      const dialog = page.getByRole("dialog", {
        name: "Remove book?",
        exact: true,
      });
      await expect(dialog).toBeVisible();
      await expect(
        dialog.getByRole("button", { name: "Cancel", exact: true }),
      ).toBeFocused();
      const folder = resolve(
        "diagnostics/interface-review",
        process.env.INTERFACE_REVIEW_STAGE ?? "after",
      );
      await mkdir(folder, { recursive: true });
      await page.screenshot({
        path: resolve(folder, `${mobile ? "mobile" : "desktop"}-remove.png`),
        animations: "disabled",
      });
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(dialog).not.toBeVisible();
      const exists = () =>
        page.evaluate(async (id) => {
          const path = "/src/lib/db.ts";
          return Boolean(await (await import(path)).getBook(id));
        }, localBook.id);
      expect(await exists()).toBe(true);
      await openConfirmation();
      await dialog
        .getByRole("button", { name: "Remove book", exact: true })
        .click();
      await expect.poll(exists).toBe(false);
      await expect(page).toHaveURL(/\/$/);
    });
  });
}
