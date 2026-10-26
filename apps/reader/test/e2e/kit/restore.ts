import type { Page } from "@playwright/test";
import activitySheet from "./activity-sheet";

/**
 * Makes the next sync this device's first, a restore, whose pull answers
 * after `ms`, and starts it.
 */
async function startRestore(page: Page, ms: number) {
  await page.route("**/api/sync/v2/pull*", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    await route.fallback();
  });
  await page.evaluate(async () => {
    const { readSyncClientState, writeSyncClientState } =
      await import("/src/lib/sync-v2/client-state.ts");
    const { syncService } = await import("/src/lib/sync-service.ts");
    writeSyncClientState({ ...readSyncClientState()!, bootstrapped: false });
    syncService.controller.requestSync();
  });
}

/**
 * agent-kit `--steps`, with `signed-in-book.ts`: a restore that takes
 * 2.5 s. The activity glyph comes for it and goes when it ends.
 */
export default async function restore({ page }: { page: Page }) {
  await startRestore(page, 2_500);
  const glyph = page.locator("[data-activity-glyph]");
  await glyph.waitFor();
  await glyph.waitFor({ state: "detached", timeout: 10_000 });
  await page.waitForTimeout(600);
}

/** The same restore, held for a minute, with the activity sheet open. */
export async function restoreSheet({ page }: { page: Page }) {
  await startRestore(page, 60_000);
  await activitySheet({ page });
}
