import type { Locator, Page } from "@playwright/test";
import {
  test,
  expect,
  recordSheetMotion,
  waitForSheet,
  waitForSheetToRest,
} from "./helpers/fixtures";

test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});

/** The bar at the top of the lab that reads the topmost sheet. */
const readout = (page: Page) => page.locator("[data-lab-readout]");

/** Opens the lab; its page loads on demand, which takes a while cold. */
async function openLab(page: Page) {
  await page.goto("/debug/sheet-lab");
  await expect(page.getByRole("heading", { name: "Sheet Lab" })).toBeVisible({
    timeout: 30_000,
  });
}

async function openScenario(page: Page, id: string, title: string) {
  await openLab(page);
  await page.locator(`[data-lab-scenario="${id}"]`).click();
  const sheet = await waitForSheet(page, title);
  await waitForSheetToRest(sheet);
  return sheet;
}

const rowIds = (sheet: Locator) =>
  sheet
    .locator("[data-lab-row]")
    .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-lab-row")));

test("Every case opens from the lab with a tap", async ({ page }) => {
  await openLab(page);
  const scenarios = page.locator("[data-lab-scenario]");
  const count = await scenarios.count();
  expect(count).toBeGreaterThanOrEqual(10);
  for (let index = 0; index < count; index++) {
    const scenario = scenarios.nth(index);
    const title = (await scenario.locator("span").first().textContent())!;
    await scenario.click();
    const sheet = await waitForSheet(page, title);
    await waitForSheetToRest(sheet);
    await expect(readout(page)).not.toHaveAttribute("data-detent", "none");
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
  }
});

for (const reduce of [false, true])
  test(`Rows removed one after another move the sheet once${reduce ? ", at once with reduced motion" : ""}, and Undo puts a row back`, async ({
    page,
  }) => {
    if (reduce) await page.emulateMedia({ reducedMotion: "reduce" });
    const sheet = await openScenario(page, "rows", "Rows removed quickly");
    await sheet.getByRole("button", { name: "Full height" }).click();
    await expect(readout(page)).toHaveAttribute("data-detent", "full");
    await waitForSheetToRest(sheet);
    const before = await rowIds(sheet);
    const height = await recordSheetMotion(sheet);

    await sheet.getByRole("button", { name: "Remove 3 rows" }).click();
    await expect
      .poll(async () => (await rowIds(sheet)).length)
      .toBe(before.length - 3);
    await waitForSheetToRest(sheet);
    const { states, holds } = await height();
    expect(states[0]).toBe("held");
    expect(states.at(-1)).toBe("rest");
    // The sheet did not move while it held.
    for (const tops of holds)
      expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(1);
    if (reduce) {
      // Each row goes at once, and so does the sheet.
      expect(states).not.toContain("settling");
    } else {
      // It held while the rows collapsed, then moved once.
      expect(states).toEqual(["held", "settling", "rest"]);
    }
    // Still in full view, and the rest keep their order.
    await expect(readout(page)).toHaveAttribute("data-detent", "full");
    expect(await rowIds(sheet)).toEqual(before.slice(3));

    // Undo brings the last row back where it was.
    await sheet.getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => rowIds(sheet)).toEqual(before.slice(2));
    await waitForSheetToRest(sheet);
    await expect(readout(page)).toHaveAttribute("data-detent", "full");
    await expect(
      sheet.getByRole("textbox", { name: "Write a note" }),
    ).toBeVisible();
  });

test("A sheet at a fixed detent stays there while its content changes", async ({
  page,
}) => {
  const sheet = await openScenario(page, "fixed", "Fixed detent");
  await expect(readout(page)).toHaveAttribute("data-detent", "detent 1");
  const top = await readout(page).getAttribute("data-top");
  const motion = await recordSheetMotion(sheet);
  await sheet.getByRole("button", { name: "Add a section" }).click();
  await expect(sheet.locator("[data-lab-section]")).toHaveCount(2);
  await sheet.getByRole("button", { name: "Remove a section" }).click();
  await sheet.getByRole("button", { name: "Remove a section" }).click();
  await expect(sheet.locator("[data-lab-section]")).toHaveCount(0);
  await waitForSheetToRest(sheet);
  await expect(readout(page)).toHaveAttribute("data-detent", "detent 1");
  await expect(readout(page)).toHaveAttribute("data-top", top!);
  const { tops } = await motion();
  // It never moved by a pixel.
  expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(1);
});

test("A field raises the sheet with the keyboard and returns it to its detent", async ({
  page,
}) => {
  const sheet = await openScenario(page, "keyboard", "Keyboard");
  await expect(readout(page)).toHaveAttribute("data-detent", "detent 1");
  await sheet.getByRole("button", { name: "Show keyboard" }).click();
  await expect(sheet.getByRole("textbox", { name: "Lab field" })).toBeFocused();
  await expect(readout(page)).toHaveAttribute("data-detent", "full");
  await sheet.getByRole("button", { name: "Hide keyboard" }).click();
  await expect(readout(page)).toHaveAttribute("data-detent", "detent 1");
  await expect(sheet).toBeVisible();
});

test("A sheet lands on the last detent asked for while it moves", async ({
  page,
}) => {
  const sheet = await openScenario(page, "moving", "Changes mid-move");
  await sheet.getByRole("button", { name: "Full, then medium" }).click();
  await waitForSheetToRest(sheet);
  await expect(readout(page)).toHaveAttribute("data-detent", "detent 1");
  await sheet.getByRole("button", { name: "Medium, then full" }).click();
  await waitForSheetToRest(sheet);
  await expect(readout(page)).toHaveAttribute("data-detent", "full");
  // New content during the move does not stop it short.
  await sheet.getByRole("button", { name: "Medium", exact: true }).click();
  await expect(readout(page)).toHaveAttribute("data-detent", "detent 1");
  await sheet.getByRole("button", { name: "Grow while moving" }).click();
  await waitForSheetToRest(sheet);
  await expect(readout(page)).toHaveAttribute("data-detent", "full");
});

test("A sheet floats below full height and meets the edges at full height", async ({
  page,
}) => {
  const sheet = await openScenario(page, "shape", "Shape and safe areas");
  await expect(readout(page)).toHaveAttribute("data-shape", "attach");
  const box = () =>
    sheet.evaluate((element) => {
      const scroller = element.closest<HTMLElement>("[data-sheet-scroll]")!;
      const style = getComputedStyle(scroller);
      return {
        float: Number(style.getPropertyValue("--wb-sheet-float")),
        expanded: !!element.closest("[data-expanded]"),
      };
    });
  await expect.poll(box).toEqual({ float: 1, expanded: false });
  await sheet.getByRole("button", { name: "Full height" }).click();
  await expect(readout(page)).toHaveAttribute("data-detent", "full");
  // React Aria still sees the whole sheet in view: the shape is a mask.
  await expect.poll(box).toEqual({ float: 0, expanded: true });
  await sheet.getByRole("button", { name: "Small" }).click();
  await expect(readout(page)).toHaveAttribute("data-detent", "detent 1");
  await expect.poll(box).toEqual({ float: 1, expanded: false });
});

test("A sheet over a sheet goes back to the one below", async ({ page }) => {
  const lower = await openScenario(page, "stacked", "Sheet over a sheet");
  await lower.getByRole("button", { name: "Open a sheet over this" }).click();
  const upper = await waitForSheet(page, "Upper sheet");
  await waitForSheetToRest(upper);
  await expect(page.getByRole("dialog")).toHaveCount(2);
  await upper.getByRole("button", { name: "Back to the lower sheet" }).click();
  await expect(upper).toBeHidden();
  await expect(lower).toBeVisible();
});
