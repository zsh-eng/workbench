import type { Locator, Page } from "@playwright/test";
import { expect, startRestore, test } from "./helpers/fixtures";

// The activity glyph and its sheet show without a Debug switch. A restore
// is the island that grows out of the glyph's place (LibraryRestoreIsland).
// Covers that fill as books download stay behind Debug -> Offline downloads.

const island = (page: Page) => page.locator(".ba-island-slot");

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
 * A restore grows the island out of the glyph's place, says what it
 * restores and that it is done, and folds back. Nothing beside it moves.
 */
async function restoreComesAndGoes(page: Page, area: Locator) {
  // Debug mode adds Design ideas, the button that used to move.
  await page.addInitScript(() =>
    localStorage.setItem("reader-debug-enabled-v1", "true"),
  );
  // The sync that follows the reload ends before the restore starts.
  const synced = page.waitForResponse("**/api/sync/v2/pull*");
  await page.reload();
  await synced;
  await expect(area.getByRole("link", { name: "Design ideas" })).toBeVisible();
  const before = await places(area);
  let release = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  await startRestore(page, () => released);
  try {
    await expect(island(page).locator(".ba-island")).toHaveText(
      /^Restoring library\s*1 book$/,
    );
    await expect(island(page).getByRole("status")).toHaveText(
      "Restoring your library…",
    );
    expect(await places(area)).toEqual(before);
    release();
    await expect(island(page).getByRole("status")).toHaveText("Restored");
    await expect(island(page)).toHaveAttribute("data-island", "rest");
    expect(await places(area)).toEqual(before);
  } finally {
    release();
  }
}

test.use({ signedIn: true });

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("a restore grows the island from the glyph's place, and the filter row's buttons keep their places", async ({
    page,
    localBook: _localBook,
  }) => {
    const filterRow = page.getByRole("group", { name: "Show" }).locator("..");
    await restoreComesAndGoes(page, filterRow);
  });
});

test.describe("a new device", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("its Library shows its frame and the island, not empty, until the restore ends", async ({
    page,
  }) => {
    const synced = page.waitForResponse("**/api/sync/v2/pull*");
    await page.goto("/");
    await synced;
    const empty = page.getByText("Your library is empty");
    await expect(empty).toBeVisible();
    let release = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    await startRestore(page, () => released);
    try {
      await expect(page.locator('[data-restore-frame="covers"]')).toBeVisible();
      await expect(island(page).getByRole("status")).toHaveText(
        "Restoring your library…",
      );
      await expect(island(page).locator(".ba-island")).toHaveText(
        "Restoring library",
      );
      await expect(empty).toHaveCount(0);
      release();
      // Nothing came: the Library is empty again, without the frame.
      await expect(empty).toBeVisible();
      await expect(page.locator('[data-restore-frame="covers"]')).toHaveCount(
        0,
      );
    } finally {
      release();
    }
  });

  test("its island waits for a connection while it is offline", async ({
    page,
    context,
  }) => {
    const synced = page.waitForResponse("**/api/sync/v2/pull*");
    await page.goto("/");
    await synced;
    let release = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    await startRestore(page, () => released);
    try {
      await expect(island(page).getByRole("status")).toHaveText(
        "Restoring your library…",
      );
      await context.setOffline(true);
      await expect(island(page).locator(".ba-island")).toHaveText(
        "Waiting for a connection",
      );
      await expect(island(page).getByRole("status")).toHaveText(
        "Restoring your library… Waiting for a connection.",
      );
      await context.setOffline(false);
    } finally {
      release();
    }
  });

  test("a reload without a network keeps its frame and its island", async ({
    page,
  }) => {
    const synced = page.waitForResponse("**/api/sync/v2/pull*");
    await page.goto("/");
    await synced;
    // The restore began here and has not ended; the page opens offline, so
    // no pull runs to say it restores.
    await page.evaluate(async () => {
      const { syncService } = await import("/src/lib/sync-service.ts");
      while (syncService.controller.getSnapshot().running)
        await new Promise((resolve) => setTimeout(resolve, 50));
      const { readSyncClientState, writeSyncClientState } =
        await import("/src/lib/sync-v2/client-state.ts");
      writeSyncClientState({ ...readSyncClientState()!, bootstrapped: false });
    });
    await page.addInitScript(() =>
      Object.defineProperty(Navigator.prototype, "onLine", {
        get: () => false,
      }),
    );
    await page.reload();
    await expect(island(page).locator(".ba-island")).toHaveText(
      "Waiting for a connection",
    );
    await expect(island(page).getByRole("status")).toHaveText(
      "Restoring your library… Waiting for a connection.",
    );
    await expect(page.locator('[data-restore-frame="covers"]')).toBeVisible();
    await expect(page.getByText("Your library is empty")).toHaveCount(0);
  });
});

test.describe("signed out", () => {
  test.use({ viewport: { width: 390, height: 844 }, signedIn: false });

  test("a restore that a sign-out left unfinished shows the Library, not its frame", async ({
    page,
  }) => {
    await page.goto("/");
    await page.evaluate(async () => {
      const { createSyncClientState, writeSyncClientState } =
        await import("/src/lib/sync-v2/client-state.ts");
      // Shared sync bound the account's scope; the pull did not reach the end.
      writeSyncClientState({
        ...createSyncClientState("test-device"),
        bootstrapped: false,
        scope: {
          origin: location.origin,
          userId: "test-user",
          namespace: "reader",
          epoch: "1",
        },
      });
      const { syncService } = await import("/src/lib/sync-service.ts");
      syncService.controller.signOut();
    });
    await page.reload();
    await expect(page.getByText("Your library is empty")).toBeVisible();
    await expect(page.locator('[data-restore-frame="covers"]')).toHaveCount(0);
    await expect(island(page)).toHaveCount(0);
  });
});

test.describe("with room", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("a restore grows the island from the glyph's place, and the header's buttons keep their places", async ({
    page,
    localBook: _localBook,
  }) => {
    await restoreComesAndGoes(page, page.locator("header"));
  });
});
