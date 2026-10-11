import type { Locator, Page } from "@playwright/test";
import { test, expect } from "./helpers/fixtures";

test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});

const FRAME = "/debug/elements/frame/sheets";

/** The share of a sheet on screen. Overscroll padding is not the sheet. */
function visibleShare(dialog: Locator) {
  return dialog.evaluate((element) => {
    const sheet = element.closest(".reader-sheet") as HTMLElement;
    const box = sheet.getBoundingClientRect();
    const padding = parseFloat(getComputedStyle(sheet).paddingBottom);
    const height = box.height - padding;
    return Math.min(1, (innerHeight - box.top) / height);
  });
}

/** A finger drag in the middle of the screen; negative moves content up. */
async function swipe(page: Page, y: number, distance: number) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.synthesizeScrollGesture", {
    x: 195,
    y,
    yDistance: distance,
    gestureSourceType: "touch",
    speed: 1200,
  });
  await cdp.detach();
}

test("Reader sheets rest on detents and stack over Reader tools", async ({
  page,
}) => {
  await page.goto(`${FRAME}?state=tools&variant=detents`);
  const tools = page.getByRole("dialog", { name: "Reader tools" });
  await expect(tools).toBeVisible({ timeout: 30_000 });
  // Reader tools fit their content instead of a fixed height.
  await expect.poll(() => visibleShare(tools)).toBeCloseTo(1, 1);
  const toolsTop = await tools.evaluate(
    (element) => element.getBoundingClientRect().top,
  );
  expect(toolsTop).toBeGreaterThan(844 / 2);

  // Contents stacks over the tools at its first detent.
  await tools.getByRole("button", { name: /Contents/ }).click();
  const contents = page.getByRole("dialog", { name: "Contents" });
  await expect(contents).toBeVisible();
  await expect.poll(() => visibleShare(contents)).toBeCloseTo(0.6, 1);
  await expect(tools).toBeAttached();

  // A swipe up takes it to full height; Back returns to the tools.
  await swipe(page, 700, -500);
  await expect.poll(() => visibleShare(contents)).toBeGreaterThan(0.98);
  await contents.getByRole("button", { name: "Back to reader tools" }).click();
  await expect(contents).toBeHidden();
  await expect(tools).toBeVisible();

  // Appearance takes the place of the tools, low and without dimming.
  await tools.getByRole("button", { name: "Themes & settings" }).click();
  const settings = page.getByRole("dialog", { name: "Reading settings" });
  await expect(settings).toBeVisible();
  await expect(tools).toBeHidden();
  await expect.poll(() => visibleShare(settings)).toBeLessThan(0.6);
  await expect(page.locator(".reader-sheet-backdrop")).toHaveCount(0);

  // Changes apply to the page behind the sheet.
  const page17 = page.getByText("Curiouser and curiouser!", { exact: false });
  const before = await page17.evaluate((p) => getComputedStyle(p).fontFamily);
  await settings.getByRole("button", { name: /Garamond/i }).click();
  await expect
    .poll(() => page17.evaluate((p) => getComputedStyle(p).fontFamily))
    .not.toBe(before);
});

test("A page tapped while Reader tools still opens takes taps", async ({
  page,
}) => {
  // Reader tools hide everything outside them once they have entered. A
  // page that opened before then stayed inert until React Aria's top layer
  // kept it visible.
  await page.goto(`${FRAME}?state=tools&variant=detents`);
  const tools = page.getByRole("dialog", { name: "Reader tools" });
  await expect(tools).toBeVisible({ timeout: 30_000 });
  await tools
    .getByRole("button", { name: /Book status/ })
    .dispatchEvent("click");
  const status = page.getByRole("dialog", { name: "Reading status" });
  await expect(status).toBeVisible();
  await expect.poll(() => visibleShare(status)).toBeCloseTo(1, 1);
  const finished = status.getByRole("button", { name: "Finished" });
  await finished.click();
  await expect(finished).toHaveAttribute("aria-pressed", "true");
});
