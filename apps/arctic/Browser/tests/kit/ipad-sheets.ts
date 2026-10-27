import type { Page } from "@playwright/test";
import type { KitContext } from "../../../../../packages/agent-kit/kit";

/** Waits until an open sheet rests, with focus inside. */
async function rested(page: Page) {
  await page.waitForFunction(
    () =>
      !!document.activeElement?.closest("[role=dialog]") &&
      !document.querySelector("[data-sheet-spring]"),
  );
}

/** Swipes a sheet away: a wheel, as a trackpad scrolls it. */
async function swipeAway(page: Page, name: string) {
  const sheet = page.getByRole("dialog", { name });
  const box = (await sheet.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 30);
  for (let step = 0; step < 14; step++) {
    await page.mouse.wheel(0, -90);
    await page.waitForTimeout(16);
  }
  await sheet.waitFor({ state: "hidden" });
}

/**
 * agent-kit `--steps`, after `account.ts`: opens the article's menu and
 * swipes it away, then opens the article and its Text and theme sheet, and
 * swipes that away. A window up to 720 px wide shows them as sheets.
 */
export default async function ipadSheets({ page }: KitContext) {
  await page.locator(".card").first().waitFor();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "More for A floe at dawn" }).click();
  await rested(page);
  await page.waitForTimeout(500);
  await swipeAway(page, "Actions for A floe at dawn");
  await page.locator(".card-title", { hasText: "A floe at dawn" }).click();
  await page.locator(".prose").getByText("Paragraph 12.").waitFor();
  await page
    .getByRole("toolbar", { name: "Article" })
    .getByRole("button", { name: "Text and theme" })
    .click();
  await rested(page);
  await page.waitForTimeout(500);
  await swipeAway(page, "Text and theme");
}
