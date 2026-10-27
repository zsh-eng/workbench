import type { Locator, Page } from "@playwright/test";
import {
  expect,
  test,
  waitForSheet,
  waitForSheetToRest,
} from "./helpers/fixtures";

// An iPad: WebKit with touch. Sheets take UIKit's form layout there
// (sheetPlacement in @workbench/elements): centred without detents, on the
// bottom edge at a form sheet's width with them. Reader's own sheets in a
// window beside another app: reader-sheets.spec.ts.
test.use({ browserName: "webkit", hasTouch: true });

// iPadOS Safari reports a Mac with touch points, and React Aria takes it for
// iOS by them. Playwright's WebKit reports none.
test.beforeEach(async ({ context, hasTouch }) => {
  if (hasTouch)
    await context.addInitScript(() =>
      Object.defineProperty(Navigator.prototype, "maxTouchPoints", {
        get: () => 5,
      }),
    );
});

const IPADS = [
  { width: 820, height: 1180 },
  { width: 1180, height: 820 },
  { width: 1024, height: 1366 },
  { width: 1366, height: 1024 },
];

/** The bar at the top of the lab that reads the topmost sheet. */
const readout = (page: Page) => page.locator("[data-lab-readout]");

async function openLab(page: Page) {
  await page.goto("/debug/sheet-lab");
  await expect(page.getByRole("heading", { name: "Sheet Lab" })).toBeVisible({
    timeout: 30_000,
  });
}

async function openCase(page: Page, id: string, title: string) {
  await page.locator(`[data-lab-scenario="${id}"]`).click();
  const sheet = await waitForSheet(page, title);
  await waitForSheetToRest(sheet);
  return sheet;
}

/**
 * Where the sheet shows (its dialog: the sheet's box runs on below the
 * screen on a phone), and how the page under it is dimmed.
 */
function measure(sheet: Locator) {
  return sheet.evaluate((element) => {
    const overlay = element.closest<HTMLElement>(".wb-sheet-overlay")!;
    const box = element.getBoundingClientRect();
    const backdrop = overlay.querySelector(".reader-sheet-backdrop");
    const scroller = overlay.querySelector("[data-sheet-scroll]")!;
    const style = getComputedStyle(scroller);
    return {
      left: box.left,
      top: box.top,
      width: box.width,
      height: box.height,
      innerWidth,
      innerHeight,
      inset: parseFloat(style.getPropertyValue("--wb-sheet-inset")),
      float: parseFloat(style.getPropertyValue("--wb-sheet-float")),
      dim: backdrop ? Number(getComputedStyle(backdrop).opacity) : 0,
    };
  });
}

for (const size of IPADS)
  test(`At ${size.width}×${size.height} a sheet without detents is a centred form sheet, and one with detents rests on the bottom edge at its width`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await openLab(page);

    const form = await openCase(page, "fit", "Fitting sheet");
    await expect(readout(page)).toHaveAttribute("data-layout", "form centred");
    const centred = await measure(form);
    expect(centred.width).toBeCloseTo(580, 0);
    expect(centred.left).toBeCloseTo((size.width - 580) / 2, 0);
    expect(
      Math.abs(centred.top - (size.height - centred.height) / 2),
    ).toBeLessThan(2);
    // The page under it is dimmed.
    expect(centred.dim).toBe(1);
    await page.keyboard.press("Escape");
    await expect(form).toBeHidden();

    const docked = await openCase(page, "fixed", "Fixed detent");
    await expect(readout(page)).toHaveAttribute("data-layout", "form");
    await expect(readout(page)).toHaveAttribute("data-detent", "detent 1");
    const low = await measure(docked);
    expect(low.width).toBeCloseTo(580, 0);
    expect(low.left).toBeCloseTo((size.width - 580) / 2, 0);
    // Lifted 20 px from the bottom edge, and it floats at every height.
    expect(low).toMatchObject({ inset: 20, float: 1 });
    expect(low.top).toBeCloseTo(size.height * 0.45, -1);
    await page.keyboard.press("Escape");
    await expect(docked).toBeHidden();

    // A long list at full height: its top is 32 px down, as a page sheet's.
    const long = await openCase(page, "long", "Long list");
    await long.getByRole("button", { name: "Full height" }).click();
    await expect(readout(page)).toHaveAttribute("data-detent", "full");
    await waitForSheetToRest(long);
    const full = await measure(long);
    expect(full.top).toBeCloseTo(32, 0);
    expect(full.float).toBe(1);
  });

test("A centred form sheet moves to the middle of the space above the keyboard", async ({
  page,
}) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  await openLab(page);
  const sheet = await openCase(page, "fit", "Fitting sheet");
  // A desktop browser shows no keyboard. React Aria measures one as the
  // visual viewport's height on the overlay; a 400 px keyboard leaves 780.
  await sheet.evaluate((element) =>
    element
      .closest<HTMLElement>(".wb-sheet-overlay")!
      .style.setProperty("--visual-viewport-height", "780px"),
  );
  // Its middle, 390 px down, within a few pixels.
  await expect
    .poll(async () => {
      const box = await measure(sheet);
      return Math.round((box.top + box.height / 2 - 390) / 4);
    })
    .toBe(0);
  const box = await measure(sheet);
  expect(box.top).toBeGreaterThanOrEqual(32);
});

test("A phone keeps the bottom sheet in either orientation", async ({
  page,
}) => {
  for (const size of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(size);
    await openLab(page);
    const sheet = await openCase(page, "fit", "Fitting sheet");
    await expect(readout(page)).toHaveAttribute("data-layout", "phone");
    const box = await measure(sheet);
    // On the bottom edge: its box runs to the bottom of the screen.
    expect(box.top + box.height).toBeCloseTo(size.height, 0);
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
  }
});

test.describe("without touch", () => {
  test.use({ hasTouch: false, viewport: { width: 1280, height: 800 } });

  test("A desktop window keeps the bottom sheet", async ({ page }) => {
    await openLab(page);
    await openCase(page, "fit", "Fitting sheet");
    await expect(readout(page)).toHaveAttribute("data-layout", "phone");
  });
});

test("Turning the iPad keeps each open sheet where it rests", async ({
  page,
}) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  await openLab(page);
  const form = await openCase(page, "fit", "Fitting sheet");
  for (const size of [
    { width: 1180, height: 820 },
    { width: 820, height: 1180 },
  ]) {
    await page.setViewportSize(size);
    await waitForSheetToRest(form);
    await expect(readout(page)).toHaveAttribute("data-detent", "full");
    const box = await measure(form);
    expect(box.left).toBeCloseTo((size.width - 580) / 2, 0);
    expect(Math.abs(box.top - (size.height - box.height) / 2)).toBeLessThan(2);
  }
  await page.keyboard.press("Escape");
  await expect(form).toBeHidden();

  const docked = await openCase(page, "fixed", "Fixed detent");
  for (const size of [
    { width: 1180, height: 820 },
    { width: 820, height: 1180 },
  ]) {
    await page.setViewportSize(size);
    await waitForSheetToRest(docked);
    await expect(readout(page)).toHaveAttribute("data-detent", "detent 1");
    expect((await measure(docked)).top).toBeCloseTo(size.height * 0.45, -1);
  }
});

test("A window resized beside another app turns a form sheet into a phone sheet and back, still open", async ({
  page,
}) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  await openLab(page);
  const form = await openCase(page, "fit", "Fitting sheet");
  for (const [width, layout] of [
    [500, "phone"],
    [678, "form centred"],
    [500, "phone"],
    [820, "form centred"],
  ] as const) {
    await page.setViewportSize({ width, height: 1180 });
    await expect(readout(page)).toHaveAttribute("data-layout", layout);
    await waitForSheetToRest(form);
    await expect(readout(page)).toHaveAttribute("data-detent", "full");
    const box = await measure(form);
    if (layout === "phone") expect(box.top + box.height).toBeCloseTo(1180, 0);
    else expect(Math.abs(box.top - (1180 - box.height) / 2)).toBeLessThan(2);
  }

  await page.keyboard.press("Escape");
  await expect(form).toBeHidden();
  const docked = await openCase(page, "fixed", "Fixed detent");
  for (const [width, layout] of [
    [500, "phone"],
    [820, "form"],
  ] as const) {
    await page.setViewportSize({ width, height: 1180 });
    await expect(readout(page)).toHaveAttribute("data-layout", layout);
    await waitForSheetToRest(docked);
    await expect(readout(page)).toHaveAttribute("data-detent", "detent 1");
  }
});

test("A swipe down dismisses a form sheet, centred or docked", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  await openLab(page);
  for (const [id, title] of [
    ["fit", "Fitting sheet"],
    ["fixed", "Fixed detent"],
  ]) {
    const sheet = await openCase(page, id, title);
    // WebKit under Playwright replays no touch drag; a trackpad's scroll
    // moves the sheet the same way, as the browser's own scrolling.
    const box = (await sheet.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 40);
    for (let step = 0; step < 14; step++) await page.mouse.wheel(0, -90);
    await expect(sheet).toBeHidden();
    await expect(readout(page)).toHaveAttribute("data-detent", "none");
  }
});
