import type { Page } from "@playwright/test";
import {
  currentPages,
  expect,
  test,
  waitForReaderReady,
  waitForSheet,
  waitForSheetToRest,
} from "./helpers/fixtures";

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});

const STAGE = "[data-page-turn]";
const CURL = "[data-reader-page-curl]";
const CURRENT_SPREAD = '[data-reader-spread-layer="current"]';

async function openWithCurl(page: Page, bookId: string) {
  await page.goto(`/reader/${bookId}?turn=curl`);
  await waitForReaderReady(page);
  await expect(page.locator(STAGE)).toHaveAttribute("data-page-turn", "curl");
}

/**
 * Drags one finger across the page. With `hold`, the finger stays down
 * and the returned function lifts it.
 */
async function drag(
  page: Page,
  from: [number, number],
  to: [number, number],
  { steps = 8, stepMs = 16, hold = false } = {},
): Promise<() => Promise<void>> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: from[0], y: from[1] }],
  });
  for (let step = 1; step <= steps; step++) {
    await page.waitForTimeout(stepMs);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        {
          x: from[0] + ((to[0] - from[0]) * step) / steps,
          y: from[1] + ((to[1] - from[1]) * step) / steps,
        },
      ],
    });
  }
  const lift = async () => {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await cdp.detach();
  };
  if (!hold) await lift();
  return lift;
}

/** One finger on the glass, moved step by step. */
async function finger(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  let at: [number, number] = [0, 0];
  const send = (type: string, points: [number, number][]) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: points.map(([x, y]) => ({ x, y })),
    });
  return {
    down: async (x: number, y: number) => {
      at = [x, y];
      await send("touchStart", [at]);
    },
    move: async (x: number, y: number, { steps = 8, stepMs = 16 } = {}) => {
      const [fromX, fromY] = at;
      for (let step = 1; step <= steps; step++) {
        await page.waitForTimeout(stepMs);
        at = [
          fromX + ((x - fromX) * step) / steps,
          fromY + ((y - fromY) * step) / steps,
        ];
        await send("touchMove", [at]);
      }
    },
    up: async () => {
      await send("touchEnd", []);
      await cdp.detach();
    },
  };
}

/**
 * A quick flick, its events stamped with the times a finger would make
 * them, so the speed holds however slowly the browser takes them.
 */
async function flick(page: Page, from: number, to: number, y = 520) {
  const cdp = await page.context().newCDPSession(page);
  let clock = Date.now() / 1000;
  const send = (type: string, x?: number) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      timestamp: clock,
      touchPoints: x === undefined ? [] : [{ x, y }],
    });
  await send("touchStart", from);
  for (let step = 1; step <= 4; step++) {
    clock += 0.016;
    await send("touchMove", from + ((to - from) * step) / 4);
  }
  clock += 0.008;
  await send("touchEnd");
  await cdp.detach();
}

async function savedPlace(page: Page, bookId: string) {
  return page.evaluate(async (id) => {
    const modulePath = "/src/lib/db.ts";
    const checkpoint = await (
      await import(modulePath)
    ).getCurrentDeviceReadingCheckpoint(id);
    return checkpoint
      ? `${checkpoint.currentSpineIndex}:${checkpoint.scrollProgress}`
      : null;
  }, bookId);
}

test("a curl past the threshold turns the page, and a short one returns", async ({
  page,
  localBook,
}) => {
  await openWithCurl(page, localBook.id);
  const start = await currentPages(page);

  // A short, slow pull lifts the corner and lays it back down.
  await drag(page, [320, 520], [290, 520], { steps: 10, stepMs: 30 });
  await expect(page.locator(CURL)).toHaveCSS("visibility", "hidden");
  expect(await currentPages(page)).toEqual(start);

  // Held half way, the page is curled: the curl shows and the live page is
  // cut at the crease.
  const lift = await drag(page, [330, 520], [160, 500], { hold: true });
  await expect(page.locator(CURL)).toHaveCSS("visibility", "visible");
  await expect(page.locator(CURRENT_SPREAD)).toHaveCSS("clip-path", /polygon/);
  await lift();
  await expect.poll(() => currentPages(page)).not.toEqual(start);
  await waitForReaderReady(page);
  await expect(page.locator(CURL)).toHaveCSS("visibility", "hidden");
  await expect(page.locator(CURRENT_SPREAD)).toHaveCSS("clip-path", "none");
});

test("a curl turn saves the same place as a plain turn", async ({
  page,
  localBook,
}) => {
  await openWithCurl(page, localBook.id);
  const start = await currentPages(page);
  const startPlace = await savedPlace(page, localBook.id);

  await drag(page, [330, 500], [110, 500]);
  await expect.poll(() => currentPages(page)).not.toEqual(start);
  await waitForReaderReady(page);
  const curled = await currentPages(page);
  await expect.poll(() => savedPlace(page, localBook.id)).not.toBe(startPlace);
  const curledPlace = await savedPlace(page, localBook.id);

  // Back with a curl the other way, then forward with a tap on the right.
  await drag(page, [60, 500], [290, 500]);
  await expect.poll(() => currentPages(page)).toEqual(start);
  await waitForReaderReady(page);
  await page.goto(`/reader/${localBook.id}`);
  await waitForReaderReady(page);
  await expect(page.locator(STAGE)).toHaveAttribute("data-page-turn", "slide");
  await page.touchscreen.tap(360, 420);
  await expect.poll(() => currentPages(page)).toEqual(curled);
  await expect.poll(() => savedPlace(page, localBook.id)).toBe(curledPlace);
});

test("a quick flick turns the page either way", async ({ page, localBook }) => {
  await openWithCurl(page, localBook.id);
  await page.touchscreen.tap(360, 420);
  await expect.poll(() => currentPages(page)).not.toEqual(["1"]);
  await waitForReaderReady(page);
  await expect(page.locator(CURL)).toHaveCSS("visibility", "hidden");
  const start = await currentPages(page);

  // Seventy pixels in a sixteenth of a second turns it on.
  await flick(page, 320, 250);
  await expect.poll(() => currentPages(page)).not.toEqual(start);
  await waitForReaderReady(page);
  await expect(page.locator(CURL)).toHaveCSS("visibility", "hidden");

  // And back.
  await flick(page, 60, 130);
  await expect.poll(() => currentPages(page)).toEqual(start);
});

test("a falling page can be caught and carried back", async ({
  page,
  localBook,
}) => {
  await openWithCurl(page, localBook.id);
  // Past the cover, onto a page of text.
  await page.touchscreen.tap(360, 420);
  await expect.poll(() => currentPages(page)).not.toEqual(["1"]);
  await waitForReaderReady(page);
  await expect(page.locator(CURL)).toHaveCSS("visibility", "hidden");
  const start = await currentPages(page);
  const startPlace = await savedPlace(page, localBook.id);

  // Let a page go past the hill, then catch it as it falls and bring it
  // back: it lies down again and nothing turns.
  const lift = await drag(page, [330, 480], [170, 480], {
    steps: 10,
    stepMs: 20,
    hold: true,
  });
  await page.waitForTimeout(120);
  const hand = await finger(page);
  await lift();
  await page.waitForTimeout(40);
  await hand.down(200, 520);
  await expect(page.locator(CURL)).toHaveCSS("visibility", "visible");
  await hand.move(380, 520, { steps: 12, stepMs: 24 });
  await page.waitForTimeout(150);
  await hand.up();
  await expect(page.locator(CURL)).toHaveCSS("visibility", "hidden");
  expect(await currentPages(page)).toEqual(start);
  expect(await savedPlace(page, localBook.id)).toBe(startPlace);
});

test("a page caught and carried on turns once and saves its place", async ({
  page,
  localBook,
}) => {
  await openWithCurl(page, localBook.id);
  await page.touchscreen.tap(360, 420);
  await expect.poll(() => currentPages(page)).not.toEqual(["1"]);
  await waitForReaderReady(page);
  await expect(page.locator(CURL)).toHaveCSS("visibility", "hidden");
  const start = await currentPages(page);
  const startPlace = await savedPlace(page, localBook.id);

  // A short pull, let go so it starts back, caught, and carried over.
  await drag(page, [330, 480], [270, 480], { steps: 6, stepMs: 20 });
  const hand = await finger(page);
  await hand.down(300, 500);
  await hand.move(80, 500, { steps: 10, stepMs: 20 });
  await hand.up();
  await expect.poll(() => currentPages(page)).not.toEqual(start);
  await waitForReaderReady(page);
  await expect(page.locator(CURL)).toHaveCSS("visibility", "hidden");
  await expect.poll(() => savedPlace(page, localBook.id)).not.toBe(startPlace);

  // One page on: a tap on the left brings back exactly the start.
  await page.touchscreen.tap(30 + 20, 420);
  await expect.poll(() => currentPages(page)).toEqual(start);
  await expect.poll(() => savedPlace(page, localBook.id)).toBe(startPlace);
});

/** Selects one whole run of text below the header. */
async function selectPassage(page: Page) {
  await page.evaluate((spread) => {
    const root = document.querySelector(spread)!;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      range.selectNodeContents(node);
      if ((node.textContent?.trim().length ?? 0) < 20) continue;
      if (range.getBoundingClientRect().top < 120) continue;
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(range);
      return;
    }
    throw new Error("No sample passage");
  }, CURRENT_SPREAD);
  await page.evaluate(() =>
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true })),
  );
  await expect(
    page.getByRole("group", { name: "Highlight colors" }),
  ).toBeVisible();
}

test("selection still works after a curl turn", async ({ page, localBook }) => {
  await openWithCurl(page, localBook.id);
  const cover = await currentPages(page);
  await drag(page, [330, 500], [110, 500]);
  await expect.poll(() => currentPages(page)).not.toEqual(cover);
  // Taps on the right turn with the curl too; go past the front matter.
  // A tap on a page still in the air only catches it, so each waits.
  for (let turn = 0; turn < 6; turn++) {
    await expect(page.locator(CURL)).toHaveCSS("visibility", "hidden");
    const before = await currentPages(page);
    await page.touchscreen.tap(360, 420);
    await expect.poll(() => currentPages(page)).not.toEqual(before);
    await waitForReaderReady(page);
  }
  await expect(page.locator(CURL)).toHaveCSS("visibility", "hidden");
  const start = await currentPages(page);
  await selectPassage(page);

  // A selection owns the finger: a drag does not turn or curl the page.
  await drag(page, [330, 600], [120, 600]);
  await expect(page.locator(CURL)).toHaveCSS("visibility", "hidden");
  expect(await currentPages(page)).toEqual(start);

  // The touch let the selection go; select again and highlight it.
  await selectPassage(page);
  await page.getByRole("button", { name: "Highlight with yellow" }).click();
  await expect(
    page.locator(`${CURRENT_SPREAD} mark[data-highlight-id]`),
  ).not.toHaveCount(0);
});

test("the WebGL ink stands in for the text and keeps selection", async ({
  page,
  localBook,
}) => {
  await page.goto(`/reader/${localBook.id}?turn=curl&paper=fine&ink=gl`);
  await waitForReaderReady(page);
  for (let turn = 0; turn < 6; turn++) {
    await expect(page.locator(CURL)).toHaveCSS("visibility", "hidden");
    const before = await currentPages(page);
    await page.touchscreen.tap(360, 420);
    await expect.poll(() => currentPages(page)).not.toEqual(before);
    await waitForReaderReady(page);
  }
  const ink = page.locator(`${CURRENT_SPREAD} .reader-ink-canvas`);
  await expect(ink).toHaveAttribute("data-ready", "");
  await expect(
    page.locator(`${CURRENT_SPREAD} [data-reader-page-slice]`).first(),
  ).toHaveCSS("-webkit-text-fill-color", "rgba(0, 0, 0, 0)");

  await selectPassage(page);
  await page.getByRole("button", { name: "Highlight with yellow" }).click();
  await expect(
    page.locator(`${CURRENT_SPREAD} mark[data-highlight-id]`),
  ).not.toHaveCount(0);

  // The next page gets its own ink.
  const before = await currentPages(page);
  await page.touchscreen.tap(360, 420);
  await expect.poll(() => currentPages(page)).not.toEqual(before);
  await waitForReaderReady(page);
  await expect(ink).toHaveAttribute("data-ready", "");
});

test("reduced motion keeps the plain turn", async ({ page, localBook }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`/reader/${localBook.id}?turn=curl`);
  await waitForReaderReady(page);
  await expect(page.locator(STAGE)).toHaveAttribute("data-page-turn", "slide");
  await expect(page.locator(CURL)).toHaveCount(0);
  const start = await currentPages(page);
  await drag(page, [330, 500], [110, 500]);
  await expect.poll(() => currentPages(page)).not.toEqual(start);
});

test("Appearance turns the curl on for this device", async ({
  page,
  localBook,
}) => {
  await page.goto(`/reader/${localBook.id}`);
  await waitForReaderReady(page);
  await expect(page.locator(STAGE)).toHaveAttribute("data-page-turn", "slide");
  await page.touchscreen.tap(195, 420);
  await page
    .getByRole("button", { name: "Open reader tools", exact: true })
    .tap();
  const tools = await waitForSheet(page, "Reader tools");
  await tools.getByRole("button", { name: "Appearance", exact: true }).tap();
  const appearance = await waitForSheet(page, "Appearance");
  await appearance.getByRole("tab", { name: "Layout", exact: true }).tap();
  // The sheet grows to fit the tab on its spring; tap once it rests.
  await waitForSheetToRest(appearance);
  await appearance
    .getByRole("group", { name: "Page turn" })
    .getByRole("button", { name: "Curl", exact: true })
    .tap();
  await page.reload();
  await waitForReaderReady(page);
  await expect(page.locator(STAGE)).toHaveAttribute("data-page-turn", "curl");
});
