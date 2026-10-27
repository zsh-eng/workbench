import type { BrowserContext, Page } from "@playwright/test";
import { waitForSheet, waitForSheetToRest } from "../helpers/fixtures";

/**
 * agent-kit `--steps`, with `sample-book.ts`, for `--trace`: opens Reader
 * tools, drags the sheet down by its handle and lets go, then closes it.
 * `performance.mark`s name each part (`kit:open`, `kit:drag`), so
 * `kit frames` can compare the frames of the opening with those of the drag.
 */
export default async function sheetFrames({
  page,
  context,
}: {
  page: Page;
  context: BrowserContext;
}) {
  const button = page.getByRole("button", {
    name: "Open reader tools",
    exact: true,
  });
  const { width, height } = page.viewportSize()!;
  // Let the page settle first, so the marks hold only the sheet's work.
  await page.waitForTimeout(500);
  if (!(await button.isVisible()))
    await page.touchscreen.tap(width / 2, height / 2);
  await button.waitFor();

  // A click in the page, as `reader-tools.ts` does: the header's own
  // animation can move the button under a synthetic tap.
  await button.evaluate((element) => {
    performance.mark("kit:open:start");
    (element as HTMLElement).click();
  });
  const sheet = await waitForSheet(page, "Reader tools");
  await waitForSheetToRest(sheet);
  await page.evaluate(() => performance.mark("kit:open:end"));
  await page.waitForTimeout(300);

  // A finger on the handle drags the sheet down 160 px and lets go: the
  // browser scrolls, and the sheet goes back to rest.
  const handle = (await sheet.locator(".reader-sheet-handle").boundingBox())!;
  const cdp = await context.newCDPSession(page);
  await page.evaluate(() => performance.mark("kit:drag:start"));
  await cdp.send("Input.synthesizeScrollGesture", {
    x: handle.x + handle.width / 2,
    y: handle.y + handle.height / 2 + 4,
    yDistance: 160,
    speed: 400,
    gestureSourceType: "touch",
    preventFling: true,
  });
  await waitForSheetToRest(sheet);
  await page.evaluate(() => performance.mark("kit:drag:end"));

  await page.keyboard.press("Escape");
  await sheet.waitFor({ state: "hidden" });
}
