import type { Locator, Page } from "@playwright/test";
import { expect, startRestore, test } from "./helpers/fixtures";

// The activity glyph and its sheet show without a Debug switch. A restore
// is the island at the top centre, which folds into the glyph when it is
// near (LibraryRestoreIsland). Covers that fill as books download stay
// behind Debug -> Offline downloads.

/** The island's place beside the glyph: its status, and its phase. */
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
 * A restore opens the island, which says what it restores and that it is
 * done, and folds away. Nothing in `area` moves.
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
    await expect(page.locator(".ba-island")).toHaveText(
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

  test("a restore opens the island, and the filter row's buttons keep their places", async ({
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
      await expect(page.locator(".ba-island")).toHaveText("Restoring library");
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
      await expect(page.locator(".ba-island")).toHaveText(
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
    await expect(page.locator(".ba-island")).toHaveText(
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

  test("a restore opens the island, and the header's buttons keep their places", async ({
    page,
    localBook: _localBook,
  }) => {
    await restoreComesAndGoes(page, page.locator("header"));
  });
});

/**
 * The controls of the header and the filter row that the island covers,
 * with the island's distance from the window's centre line.
 */
function underIsland(page: Page) {
  return page.evaluate(() => {
    // Across the phone layout's edge, the island's place moves to the
    // header and it opens again.
    const open = document.querySelector(".ba-island[data-settled]");
    if (!open) return null;
    const island = open.getBoundingClientRect();
    const rows = [
      document.querySelector("header"),
      document.querySelector('[role="group"][aria-label="Show"]')
        ?.parentElement,
    ];
    const covered = rows
      .flatMap((row) => [...(row?.querySelectorAll("a, button, input") ?? [])])
      .filter((control) => {
        const box = control.getBoundingClientRect();
        return (
          box.width > 0 &&
          box.left < island.right &&
          box.right > island.left &&
          box.top < island.bottom &&
          box.bottom > island.top
        );
      })
      .map(
        (control) => control.getAttribute("aria-label") ?? control.textContent,
      );
    const centre = island.left + island.width / 2;
    return {
      covered,
      offCentre: Math.round(
        Math.abs(centre - document.documentElement.clientWidth / 2),
      ),
    };
  });
}

test.describe("at every width", () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test("the island floats at the top centre, and below the places and filters where they hold it", async ({
    page,
    localBook: _localBook,
  }) => {
    let release = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    await startRestore(page, () => released);
    try {
      for (const [width, height, top] of [
        [320, 640, "below"],
        [390, 844, "below"],
        [600, 900, "below"],
        [768, 1024, "top"],
        [1024, 768, "top"],
        [1440, 900, "top"],
        [1920, 1080, "top"],
      ] as const) {
        await page.setViewportSize({ width, height });
        await expect
          .poll(() => underIsland(page), { message: `${width} px` })
          .toEqual({ covered: [], offCentre: 0 });
        // With room, the header's top margin holds it; a phone's header
        // and filter row take the top centre, so it goes below them.
        const box = (await page.locator(".ba-island").boundingBox())!;
        if (top === "top") expect(box.y, `${width} px`).toBe(8);
        else expect(box.y, `${width} px`).toBeGreaterThan(100);
      }
    } finally {
      release();
    }
  });
});
