import { expect, test, type Locator } from "@playwright/test";
import {
  addText,
  article,
  eventually,
  paragraphs,
  phone,
  signUp,
} from "./phone";

// A phone: sheets, and the bottom bar under the toasts.
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

test.beforeEach(async ({ context }) => {
  await signUp(context);
});

test("a sheet whose code failed to load opens on the next tap", async ({
  page,
  context,
}) => {
  const floe = article("https://example.com/floe", { title: "A floe at dawn" });
  await phone(context.request).push(floe.records);
  await addText(context.request, floe, paragraphs(12));
  // No connection for the sheet's code: its preload and the first tap fail.
  let offline = true;
  await page.route("**/src/sheet.tsx*", (route) =>
    offline ? route.abort("internetdisconnected") : route.continue(),
  );
  await page.goto("/");
  await page.locator(".card-title", { hasText: "A floe at dawn" }).click();
  await expect(page.locator(".prose")).toContainText("Paragraph 12.");
  const text = page
    .getByRole("toolbar", { name: "Article" })
    .getByRole("button", { name: "Text and theme" });
  await text.click();
  await expect(page.locator(".toast")).toContainText("could not open");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  offline = false;
  await text.click();
  await expect(
    page.getByRole("dialog", { name: "Text and theme" }),
  ).toBeVisible();
});

test("Undo takes archives back, from the toast, with ⌘Z, and several at once", async ({
  page,
  context,
}) => {
  await phone(context.request).push([
    ...article("https://example.com/polynya", {
      title: "A polynya in winter",
      savedAt: Date.UTC(2026, 9, 2),
    }).records,
    ...article("https://example.com/brash-ice", {
      title: "Brash ice",
      savedAt: Date.UTC(2026, 9, 1),
    }).records,
  ]);
  await page.goto("/");
  await expect(page.locator(".card")).toHaveCount(2);

  const archive = async (title: string) => {
    await page.getByRole("button", { name: `More for ${title}` }).click();
    const sheet = page.getByRole("dialog", { name: `Actions for ${title}` });
    // It takes focus once it rests.
    await eventually(() =>
      page.evaluate(() => !!document.activeElement?.closest("[role=dialog]")),
    ).toBe(true);
    await sheet.getByRole("button", { name: "Archive" }).click();
    await expect(page.locator(".card-title", { hasText: title })).toHaveCount(
      0,
    );
  };

  await archive("A polynya in winter");
  const toast = page.getByRole("status", { name: "Notifications" });
  await expect(toast).toContainText("Archived");
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".card")).toHaveCount(2);

  // ⌘Z or Ctrl+Z undoes while Undo is on offer.
  await archive("Brash ice");
  await expect(toast).toContainText("Archived");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator(".card")).toHaveCount(2);
  await expect(toast).toContainText("Back in Saved");

  // Two archives share one toast, which counts them. Its Undo takes both
  // back, and the same toast says so before it leaves.
  await archive("A polynya in winter");
  await expect(toast).toContainText("Archived");
  const one = toast.locator(".toast");
  await one.evaluate((element) => element.setAttribute("data-probe", ""));
  await archive("Brash ice");
  const same = toast.locator(".toast[data-probe]");
  await expect(same).toContainText("2 archived");
  await same.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".card")).toHaveCount(2);
  await expect(same).toContainText("Back in Saved");
  await expect(same.getByRole("button", { name: "Undo" })).toHaveCount(0);
  await expect(toast.locator(".toast")).toHaveCount(0);
});

// A sheet that leaves on its spring rests a pixel below the screen, short of
// the start of its scroll range. Its exit took that for a sheet still in view
// and sent it out again, without end: More, closed by Escape or a tap
// outside, threw "Maximum call stack size exceeded".
test("a sheet closes every way, from each place it rests, without an error", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
  const floe = article("https://example.com/floe", {
    title: "A floe at dawn",
    savedAt: Date.UTC(2026, 9, 2),
  });
  await phone(context.request).push([
    ...floe.records,
    ...article("https://example.com/brash-ice", {
      title: "Brash ice",
      savedAt: Date.UTC(2026, 9, 1),
    }).records,
  ]);
  await addText(context.request, floe, paragraphs(12));
  const cdp = await context.newCDPSession(page);

  // A sheet takes focus once it rests.
  const rested = () =>
    eventually(() =>
      page.evaluate(
        () =>
          !!document.activeElement?.closest("[role=dialog]") &&
          !document.querySelector("[data-sheet-spring]"),
      ),
    ).toBe(true);
  const open = async (trigger: Locator, name: string) => {
    await trigger.click();
    await rested();
    return page.getByRole("dialog", { name });
  };
  /** A finger on the sheet's handle that drags it down, or up if negative. */
  const drag = async (sheet: Locator, yDistance: number) => {
    const handle = (await sheet.locator(".sheet-handle").boundingBox())!;
    await cdp.send("Input.synthesizeScrollGesture", {
      x: handle.x + handle.width / 2,
      y: handle.y + handle.height / 2,
      yDistance,
      speed: 3000,
      gestureSourceType: "touch",
    });
  };
  const ways: Record<string, (sheet: Locator) => Promise<void>> = {
    Escape: () => page.keyboard.press("Escape"),
    // Above the sheet, even at full height.
    "a tap outside": () => page.touchscreen.tap(195, 6),
    "a swipe down": (sheet) => drag(sheet, 800),
  };
  const close = async (sheet: Locator, way: string, from = "") => {
    await ways[way]!(sheet);
    await expect(sheet).toHaveCount(0);
    expect(errors, `closed by ${way}${from}`).toEqual([]);
  };

  // A sheet that fits its content.
  await page.goto("/");
  await expect(page.locator(".card")).toHaveCount(2);
  const more = page.getByRole("button", { name: "More for Brash ice" });
  for (const way of Object.keys(ways))
    await close(await open(more, "Actions for Brash ice"), way);
  const actions = await open(more, "Actions for Brash ice");
  await actions.getByRole("button", { name: "Archive" }).click();
  await expect(actions).toHaveCount(0);
  await expect(
    page.locator(".card-title", { hasText: "Brash ice" }),
  ).toHaveCount(0);
  expect(errors, "closed by Archive").toEqual([]);

  // A sheet with a detent, from the detent and from full height.
  await page.locator(".card-title", { hasText: "A floe at dawn" }).click();
  await expect(page.locator(".prose")).toContainText("Paragraph 12.");
  const text = page
    .getByRole("toolbar", { name: "Article" })
    .getByRole("button", { name: "Text and theme" });
  for (const full of [false, true])
    for (const way of Object.keys(ways)) {
      const sheet = await open(text, "Text and theme");
      if (full) {
        await drag(sheet, -800);
        await expect(page.locator(".sheet-overlay[data-expanded]")).toHaveCount(
          1,
        );
        await rested();
      }
      await close(sheet, way, full ? " at full height" : " at the detent");
    }
});
