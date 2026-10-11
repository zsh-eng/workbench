import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test, expect, openLocalBook } from "./helpers/fixtures";

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
        await page
          .getByRole("button", { name: "Open reader tools", exact: true })
          .click();
        await page.getByRole("button", { name: /Book status/ }).click();
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
      await expect(page.locator('[data-slot="dialog-overlay"]')).toBeVisible();
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
      await page.evaluate(() => {
        const state = window as unknown as {
          backdropSamples: number[];
          backdropDone: Promise<void>;
        };
        state.backdropSamples = [];
        state.backdropDone = new Promise<void>((resolve) => {
          function sample() {
            const backdrop = document.querySelector(
              '[data-slot="dialog-overlay"]',
            );
            state.backdropSamples.push(
              backdrop ? Number(getComputedStyle(backdrop).opacity) : 0,
            );
            if (!backdrop) {
              resolve();
              return;
            }
            requestAnimationFrame(sample);
          }
          requestAnimationFrame(sample);
        });
      });
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      const samples = await page.evaluate(async () => {
        const state = window as unknown as {
          backdropSamples: number[];
          backdropDone: Promise<void>;
        };
        await state.backdropDone;
        return state.backdropSamples;
      });
      await writeFile(
        resolve(folder, `${mobile ? "mobile" : "desktop"}-backdrop.json`),
        JSON.stringify(samples),
      );
      const opacityIncreases = samples
        .slice(1)
        .filter((value, i) => value > samples[i] + 0.05);
      expect(
        opacityIncreases,
        "The closing backdrop must never flash darker again",
      ).toEqual([]);
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
