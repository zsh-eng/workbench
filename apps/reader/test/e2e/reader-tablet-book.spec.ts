import type { Page } from "@playwright/test";
import {
  currentPages,
  expect,
  nextSpread,
  openLocalBook,
  test,
  waitForReaderReady,
} from "./helpers/fixtures";

// The OPPO Pad Mini at density 2.5 as an installed app: Chrome on Android
// with touch, its 1008 × 672 screen less the status bar.
test.use({
  isMobile: true,
  hasTouch: true,
  viewport: { width: 1008, height: 640 },
  contextOptions: { screen: { width: 1008, height: 672 } },
  deviceScaleFactor: 2.5,
});

const CURRENT_SPREAD = '[data-reader-spread-layer="current"]';

const spreadText = (page: Page) =>
  page
    .locator(CURRENT_SPREAD)
    .evaluate((element) =>
      (element.textContent ?? "").replace(/\s+/g, " ").trim(),
    );

/**
 * The reader keeps their place: the new view starts inside the old one, or
 * holds its start. In two pages the place can be on either page.
 */
async function expectPlaceKept(page: Page, before: string) {
  await waitForReaderReady(page);
  const after = await spreadText(page);
  const kept =
    before.includes(after.slice(0, 40)) || after.includes(before.slice(0, 40));
  expect(kept, `${before.slice(0, 80)} → ${after.slice(0, 80)}`).toBe(true);
}

/** Appearance → Layout in the tools sidebar; the chrome shows on a tap. */
async function openLayout(page: Page) {
  const sidebar = page.locator('aside[aria-label="Reader tools"]');
  if ((await sidebar.getAttribute("aria-hidden")) !== "false") {
    const tools = page.getByRole("button", {
      name: "Open reader tools",
      exact: true,
    });
    const { width, height } = page.viewportSize()!;
    if (!(await tools.isVisible()) || (await tools.boundingBox())!.y < 0)
      await page.touchscreen.tap(width / 2, height / 2);
    await expect(tools).toBeInViewport();
    await tools.tap();
  }
  await expect(sidebar).toHaveAttribute("aria-hidden", "false");
  const row = sidebar.locator("[data-pages-row]");
  if (!(await row.isVisible()))
    await sidebar
      .getByRole("button", { name: "Reading appearance", exact: true })
      .tap();
  if (!(await row.isVisible()))
    await sidebar.getByRole("tab", { name: "Layout", exact: true }).tap();
  await expect(row).toBeVisible();
  return sidebar;
}

async function choosePages(page: Page, pages: "Auto" | "One" | "Two") {
  const row = (await openLayout(page)).locator("[data-pages-row]");
  await row.getByRole("button", { name: pages, exact: true }).tap();
  await expect(row).toHaveAttribute("data-pages-row", pages.toLowerCase());
  return row;
}

test("A landscape tablet reads two pages and keeps its place through Pages and a turn", async ({
  page,
  localBook,
}) => {
  await openLocalBook(page, localBook.id);
  for (let turn = 0; turn < 6; turn++) await nextSpread(page);
  await expect.poll(() => currentPages(page)).toHaveLength(2);
  const pageWidth = await page
    .locator(`${CURRENT_SPREAD} [data-reader-page-content]`)
    .first()
    .evaluate((element) => Math.round(element.getBoundingClientRect().width));
  expect(pageWidth).toBeGreaterThanOrEqual(400);

  // Each page's first line starts below the header while it shows.
  const header = page.locator('[data-reader-header="desktop"]');
  await expect
    .poll(async () => {
      if ((await header.getAttribute("aria-hidden")) === "false") return true;
      // The middle of the spread; its sides turn pages.
      await page.touchscreen.tap(504, 320);
      return false;
    })
    .toBe(true);
  await expect(header).toHaveCSS("opacity", "1");
  const headerBox = (await header.boundingBox())!;
  const headerBottom = headerBox.y + headerBox.height;
  const firstLineTops = await page
    .locator(`${CURRENT_SPREAD} [data-reader-page-content]`)
    .evaluateAll((pages) =>
      pages.map((content) => {
        const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
        let text = walker.nextNode();
        while (text && !text.textContent?.trim()) text = walker.nextNode();
        const range = document.createRange();
        range.selectNodeContents(text!);
        return range.getClientRects()[0].top;
      }),
    );
  expect(firstLineTops).toHaveLength(2);
  for (const top of firstLineTops)
    expect(top).toBeGreaterThanOrEqual(headerBottom);

  let before = await spreadText(page);
  // A browser tab cannot hide the system bars: no Full screen switch.
  await expect(
    (await openLayout(page)).getByText("Full screen while reading"),
  ).toHaveCount(0);
  await choosePages(page, "One");
  await expect.poll(() => currentPages(page)).toHaveLength(1);
  await expectPlaceKept(page, before);

  before = await spreadText(page);
  const row = await choosePages(page, "Two");
  await expect.poll(() => currentPages(page)).toHaveLength(2);
  await expectPlaceKept(page, before);

  // Two on a portrait tablet cannot fit, and the row says why.
  before = await spreadText(page);
  await page.setViewportSize({ width: 672, height: 976 });
  await expect.poll(() => currentPages(page)).toHaveLength(1);
  await expect(row).toContainText("too narrow");
  await expectPlaceKept(page, before);

  before = await spreadText(page);
  await page.setViewportSize({ width: 1008, height: 640 });
  await expect.poll(() => currentPages(page)).toHaveLength(2);
  await expectPlaceKept(page, before);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("reader-pages-v1")))
    .toBe("two");
});

test.describe("Full screen while reading, installed on Android", () => {
  const isFullscreen = (page: Page) =>
    page.evaluate(() => document.fullscreenElement !== null);

  test.beforeEach(async ({ page }) => {
    // Chromium has no display-mode emulation: the page sees an installed app.
    await page.addInitScript(() => {
      const matchMedia = window.matchMedia.bind(window);
      window.matchMedia = (query: string) =>
        matchMedia(
          query.replace("(display-mode: standalone)", "(min-width: 0px)"),
        );
    });
  });

  test("Opening a book enters full screen; leaving it stays in the book; the Library shows the bars", async ({
    page,
    localBook,
  }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /^Open / }).first().click();
    await expect(page).toHaveURL(new RegExp(`/reader/${localBook.id}`));
    await waitForReaderReady(page);
    await expect.poll(() => isFullscreen(page)).toBe(true);
    const url = page.url();

    // Android's back gesture leaves full screen as exitFullscreen does.
    await page.evaluate(() => document.exitFullscreen());
    await expect.poll(() => isFullscreen(page)).toBe(false);
    await nextSpread(page);
    expect(page.url()).toBe(url);
    expect(await isFullscreen(page)).toBe(false);

    // The switch takes effect in its own tap.
    const toggle = (await openLayout(page)).getByRole("switch", {
      name: "Full screen while reading",
    });
    await expect(toggle).toBeChecked();
    await toggle.tap();
    await expect(toggle).not.toBeChecked();
    await toggle.tap();
    await expect.poll(() => isFullscreen(page)).toBe(true);

    // A tap on the page shows the header with its Library button.
    const library = page.getByRole("button", { name: "Library", exact: true });
    await expect
      .poll(async () => {
        if (await library.isVisible()) return true;
        // The middle of the spread; its sides turn pages.
        await page.touchscreen.tap(504, 320);
        return false;
      })
      .toBe(true);
    await library.click();
    await expect(page).toHaveURL(/\/$/);
    await expect.poll(() => isFullscreen(page)).toBe(false);
  });

  /** Android stops the app: the page hides, and the exit reports either side. */
  const leaveTheApp = (page: Page, exitReportsFirst: boolean) =>
    page.evaluate(async (exitFirst) => {
      const setHidden = (hidden: boolean) => {
        Object.defineProperty(document, "hidden", {
          configurable: true,
          get: () => hidden,
        });
        document.dispatchEvent(new Event("visibilitychange"));
      };
      const exited = new Promise((resolve) =>
        document.addEventListener("fullscreenchange", resolve, { once: true }),
      );
      if (!exitFirst) setHidden(true);
      await document.exitFullscreen();
      await exited;
      if (exitFirst) setHidden(true);
      setHidden(false);
    }, exitReportsFirst);

  const openBookInFullscreen = async (page: Page, id: string) => {
    await page.goto("/");
    await page.getByRole("link", { name: /^Open / }).first().click();
    await expect(page).toHaveURL(new RegExp(`/reader/${id}`));
    await waitForReaderReady(page);
    await expect.poll(() => isFullscreen(page)).toBe(true);
  };

  for (const exitReportsFirst of [false, true]) {
    test(`Full screen comes back on the next tap after leaving the app (the exit reports ${exitReportsFirst ? "first" : "last"})`, async ({
      page,
      localBook,
    }) => {
      await openBookInFullscreen(page, localBook.id);
      await leaveTheApp(page, exitReportsFirst);
      expect(await isFullscreen(page)).toBe(false);

      // A tap on the side of the page: it goes back and still turns the page.
      const before = await currentPages(page);
      await page.touchscreen.tap(900, 320);
      await expect.poll(() => isFullscreen(page)).toBe(true);
      await expect.poll(() => currentPages(page)).not.toEqual(before);
    });
  }

  test("A swipe goes back to full screen when its page lands", async ({
    page,
    localBook,
  }) => {
    await openBookInFullscreen(page, localBook.id);
    await leaveTheApp(page, false);
    const before = await currentPages(page);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: 800, y: 320 }],
    });
    for (const x of [760, 700, 620, 520, 420])
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x, y: 320 }],
      });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await cdp.detach();
    await expect.poll(() => currentPages(page)).not.toEqual(before);
    await expect.poll(() => isFullscreen(page)).toBe(true);
  });

  test("Leaving on purpose keeps the bars until the header's button", async ({
    page,
    localBook,
  }) => {
    await openBookInFullscreen(page, localBook.id);
    await page.evaluate(() => document.exitFullscreen());
    await expect.poll(() => isFullscreen(page)).toBe(false);

    // The middle of the spread shows the chrome; a tap does not go back.
    const enter = page.getByRole("button", {
      name: "Enter full screen",
      exact: true,
    });
    await expect
      .poll(async () => {
        if (await enter.isVisible()) return true;
        await page.touchscreen.tap(504, 320);
        return false;
      })
      .toBe(true);
    expect(await isFullscreen(page)).toBe(false);

    await enter.tap();
    await expect.poll(() => isFullscreen(page)).toBe(true);
    await expect(enter).toHaveCount(0);
  });

  test("A refused request opens the book with the bars", async ({
    page,
    localBook,
  }) => {
    await page.addInitScript(() => {
      Element.prototype.requestFullscreen = () =>
        Promise.reject(new TypeError("Permissions check failed"));
    });
    const errors: Error[] = [];
    page.on("pageerror", (error) => errors.push(error));
    await page.goto("/");
    await page.getByRole("link", { name: /^Open / }).first().click();
    await expect(page).toHaveURL(new RegExp(`/reader/${localBook.id}`));
    await waitForReaderReady(page);
    expect(await isFullscreen(page)).toBe(false);
    expect(errors).toEqual([]);
  });
});
