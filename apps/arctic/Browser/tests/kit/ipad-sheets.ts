import type { BrowserContext, Page } from "@playwright/test";
import type { KitContext } from "../../../../../packages/agent-kit/kit";

/** Waits until an open sheet rests, with focus inside. */
async function rested(page: Page) {
  await page.waitForFunction(
    () =>
      !!document.activeElement?.closest("[role=dialog]") &&
      !document.querySelector("[data-sheet-spring]"),
  );
}

/**
 * Swipes a sheet away: a wheel, as a trackpad scrolls it, or with
 * `KIT_SWIPE=touch` (Chromium) a fast finger swipe.
 */
async function swipeAway(page: Page, context: BrowserContext, name: string) {
  const sheet = page.getByRole("dialog", { name });
  const box = (await sheet.boundingBox())!;
  if (process.env.KIT_SWIPE === "touch") {
    const { height } = page.viewportSize()!;
    const cdp = await context.newCDPSession(page);
    await cdp.send("Input.synthesizeScrollGesture", {
      x: box.x + box.width / 2,
      y: Math.min(box.y + 40, height - 10),
      yDistance: Math.round(height * 0.4),
      gestureSourceType: "touch",
      speed: 3000,
      // A finger lets go with speed; without it the snap takes a short
      // sheet back.
      preventFling: false,
    });
    await cdp.detach();
    await sheet.waitFor({ state: "hidden" });
    return;
  }
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
 * swipes that away. A window narrower than 600 px shows them as sheets.
 */
export default async function ipadSheets({ page, context }: KitContext) {
  await page.locator(".card").first().waitFor();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "More for A floe at dawn" }).click();
  await rested(page);
  await page.waitForTimeout(500);
  await swipeAway(page, context, "Actions for A floe at dawn");
  await page.locator(".card-title", { hasText: "A floe at dawn" }).click();
  await page.locator(".prose").getByText("Paragraph 12.").waitFor();
  await page
    .getByRole("toolbar", { name: "Article" })
    .getByRole("button", { name: "Text and theme" })
    .click();
  await rested(page);
  await page.waitForTimeout(500);
  await swipeAway(page, context, "Text and theme");
}
