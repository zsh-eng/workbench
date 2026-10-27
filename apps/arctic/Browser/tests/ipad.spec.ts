import { expect, test, type Locator, type Page } from "@playwright/test";
import { addText, article, paragraphs, phone, signUp } from "./phone";

// An iPad: WebKit with touch. Arctic shows sheets in a compact window,
// below 600 px (@workbench/elements/size-class), so an iPad shows them only
// in a narrow window beside another app, as phone sheets. From 600 px a
// control's popover or menu takes their place.
// WebKit's own user agent is Safari's, as an iPad's is; React Aria's iOS
// path depends on it (sheet-ipad.spec.ts in Reader runs with Chrome's).
test.use({ browserName: "webkit", hasTouch: true });

test.beforeEach(async ({ context }) => {
  // iPadOS Safari reports a Mac with touch points, and React Aria takes it
  // for iOS by them. WebKit under Playwright reports none.
  await context.addInitScript(() =>
    Object.defineProperty(Navigator.prototype, "maxTouchPoints", {
      get: () => 5,
    }),
  );
  await signUp(context);
  const floe = article("https://example.com/floe", { title: "A floe at dawn" });
  await phone(context.request).push(floe.records);
  await addText(context.request, floe, paragraphs(12));
});

/** The sheet's layout, where its box shows, and how far it floats. */
function measure(sheet: Locator) {
  return sheet.evaluate((element) => {
    const overlay = element.closest<HTMLElement>(".wb-sheet-overlay")!;
    const box = element.closest(".sheet")!.getBoundingClientRect();
    const style = getComputedStyle(
      overlay.querySelector("[data-sheet-scroll]")!,
    );
    return {
      inset: parseFloat(style.getPropertyValue("--wb-sheet-inset")),
      float: parseFloat(style.getPropertyValue("--wb-sheet-float")),
      layout: `${overlay.dataset.sheetLayout}${overlay.dataset.position === "center" ? " centred" : ""}`,
      left: box.left,
      top: box.top,
      width: box.width,
      height: box.height,
    };
  });
}

/** Opens a sheet and waits until it rests with focus inside. */
async function open(page: Page, trigger: Locator, name: string) {
  await trigger.click();
  const sheet = page.getByRole("dialog", { name });
  await expect(sheet).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          !!document.activeElement?.closest("[role=dialog]") &&
          !document.querySelector("[data-sheet-spring]"),
      ),
    )
    .toBe(true);
  return sheet;
}

/**
 * A swipe down. WebKit under Playwright replays no touch drag; a trackpad's
 * scroll moves the sheet the same way, as the browser's own scrolling.
 */
async function swipeDown(page: Page, sheet: Locator) {
  const box = (await sheet.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 30);
  for (let step = 0; step < 16; step++) await page.mouse.wheel(0, -90);
  await expect(sheet).toHaveCount(0);
}

const more = (page: Page) =>
  page.getByRole("button", { name: "More for A floe at dawn" });
const textAndTheme = (page: Page) =>
  page
    .getByRole("toolbar", { name: "Article" })
    .getByRole("button", { name: "Text and theme" });

test("In a 500 px window, sheets stay phone sheets, and a swipe down closes each", async ({
  page,
}) => {
  await page.setViewportSize({ width: 500, height: 1024 });
  await page.goto("/");
  const actions = await open(page, more(page), "Actions for A floe at dawn");
  const box = await measure(actions);
  expect(box.layout).toBe("phone");
  // Within its phone width, on the bottom edge.
  expect(box.width).toBeLessThan(500);
  await swipeDown(page, actions);

  // Text and theme rests at a detent, part of it below the screen.
  await page.locator(".card-title", { hasText: "A floe at dawn" }).click();
  await expect(page.locator(".prose")).toContainText("Paragraph 12.");
  const text = await open(page, textAndTheme(page), "Text and theme");
  expect((await measure(text)).layout).toBe("phone");
  await swipeDown(page, text);
});

for (const size of [
  { width: 678, height: 1024 },
  { width: 820, height: 1180 },
  { width: 1180, height: 820 },
])
  test(`An iPad window at ${size.width}×${size.height} gets the article menu by its button, not a sheet`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await page.goto("/");
    await more(page).click();
    await expect(page.getByRole("menu")).toBeVisible();
    await expect(page.locator(".sheet-overlay")).toHaveCount(0);
  });

// The sidebar needs an expanded width (840 px) and a window taller than a
// phone on its side (480 px); packages/elements/docs/SIZE_CLASSES.md.
for (const [width, height, sidebar] of [
  [820, 1180, false],
  [1024, 1366, true],
  [1008, 532, true],
  [844, 390, false],
] as const)
  test(`At ${width}×${height} the library ${sidebar ? "has" : "has no"} sidebar`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await expect(page.getByText("A floe at dawn")).toBeVisible();
    await expect(page.locator(".sidebar")).toHaveCount(sidebar ? 1 : 0);
  });
