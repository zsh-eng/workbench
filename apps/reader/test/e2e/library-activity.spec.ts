import type { Locator, Page } from "@playwright/test";
import { expect, test, waitForSheet } from "./helpers/fixtures";

// The activity glyph and its sheet show without a Debug switch; a restore
// is the sync they speak for. Covers that fill as books download stay
// behind Debug -> Offline downloads.

const glyph = (page: Page) => page.locator("[data-activity-glyph]");

/**
 * Makes the next sync this device's first, a restore, and holds its pull
 * until the returned function runs.
 */
async function holdRestore(page: Page): Promise<() => void> {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/sync/v2/pull*", async (route) => {
    await gate;
    await route.fallback();
  });
  await page.evaluate(async () => {
    const { readSyncClientState, writeSyncClientState } =
      await import("/src/lib/sync-v2/client-state.ts");
    writeSyncClientState({ ...readSyncClientState()!, bootstrapped: false });
  });
  await page.reload();
  return release;
}

/** Each button's and link's place in `area`, except the glyph's. */
function places(area: Locator) {
  return area
    .locator("button:not([data-activity-glyph]), a")
    .evaluateAll((elements) =>
      elements.map((element) => {
        const box = element.getBoundingClientRect();
        return `${element.getAttribute("aria-label") ?? element.textContent}: ${box.x},${box.y} ${box.width}x${box.height}`;
      }),
    );
}

/**
 * A restore raises the glyph; its sheet lists it under This app until it
 * has synced. Nothing beside the glyph moves while it comes and goes.
 */
async function restoreComesAndGoes(page: Page, area: Locator) {
  // Debug mode adds Design ideas, the button that used to move.
  await page.addInitScript(() =>
    localStorage.setItem("reader-debug-enabled-v1", "true"),
  );
  const release = await holdRestore(page);
  try {
    await expect(glyph(page)).toHaveAttribute(
      "data-activity-glyph",
      "progress",
    );
    await expect(glyph(page)).toHaveAccessibleName(
      "Activity: restoring your library",
    );
    await expect(
      area.getByRole("link", { name: "Design ideas" }),
    ).toBeVisible();
    const withGlyph = await places(area);

    await glyph(page).click();
    const sheet = await waitForSheet(page, "Activity");
    await expect(
      sheet.getByRole("heading", { name: "This app" }),
    ).toBeVisible();
    const row = sheet.locator('[data-sheet-row="sync"]');
    await expect(row).toContainText("Restoring your library");
    release();
    await expect(row).toContainText("Synced");
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(glyph(page)).toHaveCount(0);
    expect(await places(area)).toEqual(withGlyph);
  } finally {
    release();
  }
}

test.use({ signedIn: true });

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("a restore raises the glyph, and the filter row's buttons keep their places", async ({
    page,
    localBook: _localBook,
  }) => {
    const filterRow = page.getByRole("group", { name: "Show" }).locator("..");
    await restoreComesAndGoes(page, filterRow);
  });
});

test.describe("with room", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("a restore raises the glyph, and the header's buttons keep their places", async ({
    page,
    localBook: _localBook,
  }) => {
    await restoreComesAndGoes(page, page.locator("header"));
  });
});
