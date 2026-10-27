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
test.describe("OPPO Pad Mini at density 3, portrait: a compact window", () => {
  test.use({
    viewport: { width: 560, height: 700 },
    // Playwright Test has no `screen` option of its own.
    contextOptions: { screen: { width: 560, height: 840 } },
    deviceScaleFactor: 3,
  });

  test("A fast swipe closes Contents over Reader tools", async ({
    page,
    localBook,
  }) => {
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
});

/**
 * The OPPO Pad Mini: a 2520 × 1680 screen, at three of Android's densities,
 * and what each gets (packages/elements/docs/SIZE_CLASSES.md). Chrome shows
 * the screen less its own and the system's bars; 140 dp of them is a guess,
 * and only the height class reads it.
 */
const OPPO_PAD_MINI = [
  [2.5, 672, 1008, "medium", "medium", "tablet", "form"],
  [2.5, 1008, 672, "expanded", "medium", "tablet", "form"],
  [2.625, 640, 960, "medium", "medium", "tablet", "form"],
  [2.625, 960, 640, "expanded", "medium", "tablet", "form"],
  [3, 560, 840, "compact", "medium", "phone", "phone"],
  [3, 840, 560, "expanded", "compact", "phone", "phone"],
] as const;

for (const [
  density,
  width,
  height,
  widthClass,
  heightClass,
  device,
  sheets,
] of OPPO_PAD_MINI) {
  const turned = width > height ? "landscape" : "portrait";
  const shown = height - 140;
  test.describe(`OPPO Pad Mini at density ${density}, ${turned}`, () => {
    test.use({
      viewport: { width, height: shown },
      contextOptions: { screen: { width, height } },
      deviceScaleFactor: density,
    });

    test(`${width} px wide is ${widthClass}, sheets take the ${sheets} layout, and a fast swipe closes one with detents`, async ({
      page,
    }) => {
      await page.goto("/debug/sheet-lab");
      const line = page.locator("[data-lab-window]");
      await expect(line).toHaveAttribute("data-screen", `${width}×${height}`, {
        timeout: 30_000,
      });
      await expect(line).toHaveAttribute("data-width-class", widthClass);
      await expect(line).toHaveAttribute("data-height-class", heightClass);
      await expect(line).toHaveAttribute("data-device", device);
      await expect(line).toHaveAttribute("data-sheets", sheets);
      await expect(line).toHaveAttribute("data-density", String(density));

      await page.locator('[data-lab-scenario="fixed"]').click();
      const sheet = await waitForSheet(page, "Fixed detent");
      await waitForSheetToRest(sheet);
      await expect(page.locator("[data-lab-readout]")).toHaveAttribute(
        "data-layout",
        sheets,
      );
      await swipeDown(page, shown * 0.8);
      await expect(sheet).toBeHidden();
    });
  });
}

// UIKit shows a form sheet full screen in a compact height; here a tablet's
// window under 480 px tall keeps phone sheets.
test.describe("OPPO Pad Mini at density 2.625, on its side, with taller bars", () => {
  test.use({
    viewport: { width: 960, height: 470 },
    contextOptions: { screen: { width: 960, height: 640 } },
    deviceScaleFactor: 2.625,
  });

  test("A window under 480 px tall gets phone sheets", async ({ page }) => {
    await page.goto("/debug/sheet-lab");
    const line = page.locator("[data-lab-window]");
    await expect(line).toHaveAttribute("data-height-class", "compact", {
      timeout: 30_000,
    });
    await expect(line).toHaveAttribute("data-device", "tablet");
    await expect(line).toHaveAttribute("data-sheets", "phone");
  });
});
