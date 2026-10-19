import type { Locator, Page } from "@playwright/test";
import { test, expect, openLocalBook } from "./helpers/fixtures";

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

/** The share of the screen a sheet covers. Lists rest at 55% of it. */
function screenShare(dialog: Locator) {
  return dialog.evaluate((element) => {
    const sheet = element.closest(".reader-sheet") as HTMLElement;
    return (innerHeight - sheet.getBoundingClientRect().top) / innerHeight;
  });
}

/** Waits until a sheet has entered and rests; React Aria marks entry. */
async function settled(dialog: Locator) {
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(() =>
      dialog.evaluate(
        (element) =>
          !element
            .closest(".reader-sheet-overlay")
            ?.hasAttribute("data-entering"),
      ),
    )
    .toBe(true);
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
  await settled(tools);
  // Reader tools fit their content instead of a fixed height.
  await expect.poll(() => visibleShare(tools)).toBeCloseTo(1, 1);
  const toolsTop = await tools.evaluate(
    (element) => element.getBoundingClientRect().top,
  );
  expect(toolsTop).toBeGreaterThan(844 / 2);

  // Contents stacks over the tools at the lists' medium detent.
  await tools.getByRole("button", { name: /Contents/ }).click();
  const contents = page.getByRole("dialog", { name: "Contents" });
  await settled(contents);
  await expect.poll(() => screenShare(contents)).toBeCloseTo(0.55, 1);
  await expect(tools).toBeAttached();

  // A swipe up takes it to full height; Back returns to the tools.
  await swipe(page, 700, -500);
  await expect.poll(() => visibleShare(contents)).toBeGreaterThan(0.98);
  await contents.getByRole("button", { name: "Back to reader tools" }).click();
  await expect(contents).toBeHidden();
  await expect(tools).toBeVisible();

  // Appearance takes the place of the tools, fits its tab, and does not dim.
  await tools.getByRole("button", { name: "Appearance", exact: true }).click();
  const settings = page.getByRole("dialog", {
    name: "Appearance",
    exact: true,
  });
  await settled(settings);
  await expect(tools).toBeHidden();
  await expect.poll(() => visibleShare(settings)).toBeCloseTo(1, 1);
  await expect(page.locator(".reader-sheet-backdrop")).toHaveCount(0);

  // A taller tab raises the sheet's top edge, and the page stays in view.
  const top = () =>
    settings.evaluate(
      (element) =>
        element.closest(".reader-sheet")!.getBoundingClientRect().top,
    );
  const typeTop = await top();
  expect(typeTop).toBeGreaterThan(844 / 4);
  await settings.getByRole("tab", { name: "Theme" }).click();
  await expect.poll(top).toBeLessThan(typeTop - 40);
  await expect.poll(() => visibleShare(settings)).toBeCloseTo(1, 1);
  await settings.getByRole("tab", { name: "Type" }).click();
  await expect.poll(top).toBeCloseTo(typeTop, 0);

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
  await settled(status);
  const finished = status.getByRole("button", { name: "Finished" });
  await finished.click();
  await expect(finished).toHaveAttribute("aria-pressed", "true");
});

test("With the trial on, the Reader opens Contents as a detent sheet", async ({
  page,
  localBook,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("reader-detent-sheets-v1", "true"),
  );
  await openLocalBook(page, localBook.id);
  await page.touchscreen.tap(195, 422);
  await page
    .getByRole("button", { name: "Open reader tools", exact: true })
    .click();
  const tools = page.getByRole("dialog", { name: "Reader tools" });
  await settled(tools);
  await tools.getByRole("button", { name: /Contents/ }).click();
  const contents = page.getByRole("dialog", { name: "Contents" });
  await settled(contents);
  await expect.poll(() => screenShare(contents)).toBeCloseTo(0.55, 1);

  // A chapter is a tap away at the detent; the book turns to it behind the
  // sheet, which stays open, as the shipped sheet does.
  const chapter = contents
    .getByRole("button")
    .filter({ hasText: /Pool of Tears/i })
    .first();
  await expect(chapter).not.toHaveAttribute("aria-current", "location");
  await chapter.click();
  await expect(chapter).toHaveAttribute("aria-current", "location");

  // A swipe up takes the list to full height; Back returns to the tools.
  await swipe(page, 700, -500);
  await expect.poll(() => visibleShare(contents)).toBeGreaterThan(0.98);
  await contents.getByRole("button", { name: "Back to reader tools" }).click();
  await expect(contents).toBeHidden();
  await expect(tools).toBeVisible();
});
