import type { Page } from "@playwright/test";
import {
  expect,
  openLocalBook,
  openReaderTools,
  test,
  waitForSheet,
  waitForSheetToRest,
} from "./helpers/fixtures";

// Chrome on Android: Chromium as a mobile browser with touch. Sheets on an
// iPad's engine: sheet-ipad.spec.ts.
test.use({ isMobile: true, hasTouch: true });

/** A fast finger swipe down from `y`, as Chrome replays a touch drag. */
async function swipeDown(page: Page, y: number) {
  const { width, height } = page.viewportSize()!;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.synthesizeScrollGesture", {
    x: width / 2,
    y,
    yDistance: Math.round(height * 0.4),
    gestureSourceType: "touch",
    speed: 3000,
  });
  await cdp.detach();
}

// React Aria closes a sheet once its IntersectionObserver has reported some
// of it on screen and then none of it. A sheet that rests at a partial
// detent, part of it below the screen, is reported once as it arrives; that
// report has to count (sheet-motion.ts, and the patch to React Aria's Sheet
// in patches/).
test("A fast swipe closes Contents over Reader tools", async ({
  page,
  localBook,
}) => {
  await page.setViewportSize({ width: 560, height: 700 });
  await openLocalBook(page, localBook.id);
  await page.touchscreen.tap(280, 350);
  const tools = await openReaderTools(page);
  await waitForSheetToRest(tools);
  await tools.getByRole("button", { name: /Contents/ }).click();
  const contents = await waitForSheet(page, "Contents");
  await waitForSheetToRest(contents);
  await swipeDown(page, 560);
  await expect(contents).toBeHidden();
  await expect(tools).toBeVisible();
});

test("A fast swipe closes a form sheet docked on the bottom edge", async ({
  page,
}) => {
  await page.setViewportSize({ width: 678, height: 1180 });
  await page.goto("/debug/sheet-lab");
  await page.locator('[data-lab-scenario="fixed"]').click();
  const sheet = await waitForSheet(page, "Fixed detent", { timeout: 30_000 });
  await waitForSheetToRest(sheet);
  await expect(page.locator("[data-lab-readout]")).toHaveAttribute(
    "data-layout",
    "form",
  );
  await swipeDown(page, 900);
  await expect(sheet).toBeHidden();
});
