import type { BrowserContext, Page } from "@playwright/test";
import { waitForSheet, waitForSheetToRest } from "../helpers/fixtures";

/**
 * agent-kit `--steps` for `--trace`, on `/debug/sheet-lab` with Debug on
 * (`--storage reader-debug-enabled-v1=true`). It works on a production
 * build too (`vite preview`), which times what a phone runs. It opens "Long
 * list" at its medium detent, drags the sheet down by its handle and lets go,
 * then closes it. `performance.mark`s name each part (`kit:open`,
 * `kit:drag`), so `kit frames` can compare the frames of the opening with
 * those of the drag.
 */
export default async function sheetLabFrames({
  page,
  context,
}: {
  page: Page;
  context: BrowserContext;
}) {
  const scenario = page.locator('[data-lab-scenario="long"]');
  await scenario.waitFor({ timeout: 30_000 });
  // Let the page settle first, so the marks hold only the sheet's work.
  await page.waitForTimeout(500);

  await scenario.evaluate((element) => {
    performance.mark("kit:open:start");
    (element as HTMLElement).click();
  });
  const sheet = await waitForSheet(page, "Long list");
  await waitForSheetToRest(sheet);
  await page.evaluate(() => performance.mark("kit:open:end"));
  await page.waitForTimeout(300);

  // A finger on the handle drags the sheet down 120 px and lets go: the
  // browser scrolls, and the sheet goes back to its detent.
  const handle = (await sheet.locator(".reader-sheet-handle").boundingBox())!;
  const cdp = await context.newCDPSession(page);
  await page.evaluate(() => performance.mark("kit:drag:start"));
  await cdp.send("Input.synthesizeScrollGesture", {
    x: handle.x + handle.width / 2,
    y: handle.y + handle.height / 2 + 4,
    yDistance: 120,
    speed: 400,
    gestureSourceType: "touch",
    preventFling: true,
  });
  await waitForSheetToRest(sheet);
  await page.evaluate(() => performance.mark("kit:drag:end"));

  await page.keyboard.press("Escape");
  await sheet.waitFor({ state: "hidden" });
}
