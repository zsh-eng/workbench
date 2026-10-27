import { expect, test, type Locator, type Page } from "@playwright/test";
import { addText, article, paragraphs, phone, signUp } from "./phone";

// Chrome on Android: Chromium as a mobile browser with touch, at the OPPO
// Pad Mini's size at density 3 (560 × 840, a phone to the size classes:
// packages/elements/docs/SIZE_CLASSES.md). Its browser bars take the rest.
test.use({
  browserName: "chromium",
  isMobile: true,
  hasTouch: true,
  viewport: { width: 560, height: 700 },
  // Playwright Test has no `screen` option of its own.
  contextOptions: { screen: { width: 560, height: 840 } },
  deviceScaleFactor: 3,
});

test.beforeEach(async ({ context }) => {
  await signUp(context);
  const floe = article("https://example.com/floe", { title: "A floe at dawn" });
  await phone(context.request).push(floe.records);
  await addText(context.request, floe, paragraphs(12));
});

/** Opens a sheet and waits until it rests. */
async function open(page: Page, trigger: Locator, name: string) {
  await trigger.click();
  const sheet = page.getByRole("dialog", { name });
  await expect(sheet).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => !document.querySelector("[data-sheet-spring]")),
    )
    .toBe(true);
  return sheet;
}

/** A finger's fast swipe down from the sheet's top, as Chrome replays it. */
async function swipeDown(page: Page, sheet: Locator) {
  const box = (await sheet.boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.synthesizeScrollGesture", {
    x: box.x + box.width / 2,
    y: box.y + 40,
    yDistance: 280,
    gestureSourceType: "touch",
    speed: 3000,
    // A finger lets go with speed.
    preventFling: false,
  });
  await cdp.detach();
  await expect(sheet).toHaveCount(0);
}

// Text and theme rests at a partial detent, part of it below the screen,
// and arrives touching the screen's edge. React Aria counts a sheet as
// entered once its observer reports some of it in view; the patch in
// patches/ lets it report that.
test("A fast swipe closes the article menu and Text and theme", async ({
  page,
}) => {
  await page.goto("/");
  const menu = await open(
    page,
    page.getByRole("button", { name: "More for A floe at dawn" }),
    "Actions for A floe at dawn",
  );
  await swipeDown(page, menu);

  await page.locator(".card-title", { hasText: "A floe at dawn" }).click();
  await expect(page.locator(".prose")).toContainText("Paragraph 12.");
  const text = await open(
    page,
    page
      .getByRole("toolbar", { name: "Article" })
      .getByRole("button", { name: "Text and theme" }),
    "Text and theme",
  );
  await swipeDown(page, text);
});
