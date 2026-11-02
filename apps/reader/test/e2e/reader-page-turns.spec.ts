import type { CDPSession, Page } from "@playwright/test";
import {
  currentPages,
  expect,
  nextSpread,
  openLocalBook,
  test,
  waitForReaderReady,
} from "./helpers/fixtures";

// A tablet in landscape: the widest page there is to move.
test.use({
  isMobile: true,
  hasTouch: true,
  viewport: { width: 1008, height: 640 },
  contextOptions: { screen: { width: 1008, height: 672 } },
  deviceScaleFactor: 2.5,
});

/** Records each frame's page layers until `stop` is called. */
async function recordFrames(page: Page) {
  await page.evaluate(() => {
    const frames: { x: number[]; opacity: number[] }[] = [];
    const recorder = { frames, stop: false };
    (window as unknown as { recorder: typeof recorder }).recorder = recorder;
    const loop = () => {
      const spreads = [
        ...document.querySelectorAll<HTMLElement>(
          '[data-reader-spread-layer="current"], [data-reader-spread-layer="current"] > div',
        ),
      ].map((element) => getComputedStyle(element));
      frames.push({
        x: spreads.map((style) => new DOMMatrix(style.transform).m41),
        opacity: spreads.map((style) => Number(style.opacity)),
      });
      if (!recorder.stop) requestAnimationFrame(loop);
    };
    loop();
  });
  return () =>
    page.evaluate(() => {
      const { recorder } = window as unknown as {
        recorder: {
          frames: { x: number[]; opacity: number[] }[];
          stop: boolean;
        };
      };
      recorder.stop = true;
      return recorder.frames;
    });
}

async function touch(cdp: CDPSession, type: string, x?: number) {
  await cdp.send("Input.dispatchTouchEvent", {
    type,
    touchPoints: x === undefined ? [] : [{ x, y: 320 }],
  });
}

const nextLayerX = (page: Page) =>
  page
    .locator('[data-reader-spread-layer="next"]')
    .evaluate(
      (layer) => new DOMMatrix(getComputedStyle(layer).transform).m41,
    );

test.beforeEach(async ({ page, localBook }) => {
  await openLocalBook(page, localBook.id);
  // Past the cover, into pages of text.
  for (let turn = 0; turn < 4; turn++) await nextSpread(page);
});

test("A tap turns the page with a short cross-fade and moves nothing", async ({
  page,
}) => {
  const before = await currentPages(page);
  const stop = await recordFrames(page);
  await page.touchscreen.tap(900, 320);
  await expect.poll(() => currentPages(page)).not.toEqual(before);
  await waitForReaderReady(page);
  const frames = await stop();

  const fading = frames.filter(({ opacity }) =>
    opacity.some((value) => value > 0.02 && value < 0.98),
  );
  expect(fading.length).toBeGreaterThan(0);
  // At 60 Hz a 150 ms fade is about 9 frames; the old slide took 28.
  expect(fading.length).toBeLessThan(16);
  expect(frames.flatMap(({ x }) => x).every((x) => x === 0)).toBe(true);
});

test("A swipe follows the finger, and the page lands", async ({ page }) => {
  const before = await currentPages(page);
  const start = await nextLayerX(page);
  const cdp = await page.context().newCDPSession(page);
  await touch(cdp, "touchStart", 800);
  for (const x of [770, 730, 700]) await touch(cdp, "touchMove", x);
  await expect.poll(() => nextLayerX(page)).toBe(start - 100);

  const stop = await recordFrames(page);
  await touch(cdp, "touchMove", 500);
  await touch(cdp, "touchEnd");
  await cdp.detach();
  await expect.poll(() => currentPages(page)).not.toEqual(before);
  await waitForReaderReady(page);
  await stop();
  await expect(page.locator('[data-reader-spread-layer="current"]')).toHaveCSS(
    "transform",
    /^(none|matrix\(1, 0, 0, 1, 0, 0\))$/,
  );
});

test("With reduced motion a tap still fades, and a swipe lands at once", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await waitForReaderReady(page);

  let before = await currentPages(page);
  const stop = await recordFrames(page);
  await page.touchscreen.tap(900, 320);
  await expect.poll(() => currentPages(page)).not.toEqual(before);
  await waitForReaderReady(page);
  const frames = await stop();
  expect(frames.flatMap(({ x }) => x).every((x) => x === 0)).toBe(true);
  expect(
    frames.some(({ opacity }) => opacity.some((value) => value < 0.98)),
  ).toBe(true);

  before = await currentPages(page);
  const cdp = await page.context().newCDPSession(page);
  await touch(cdp, "touchStart", 800);
  for (const x of [770, 700, 600, 500]) await touch(cdp, "touchMove", x);
  await touch(cdp, "touchEnd");
  await cdp.detach();
  await expect.poll(() => currentPages(page)).not.toEqual(before);
  await expect(page.locator('[data-reader-spread-layer="current"]')).toHaveCSS(
    "transform",
    /^(none|matrix\(1, 0, 0, 1, 0, 0\))$/,
  );
});
