import type { Page } from "@playwright/test";
import { startRestore } from "../helpers/fixtures";
import activitySheet from "./activity-sheet";

const after = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * agent-kit `--steps`, with `signed-in-book.ts`: a restore that takes
 * 2.5 s. The activity glyph comes for it and goes when it ends.
 */
export default async function restore({ page }: { page: Page }) {
  await startRestore(page, () => after(2_500));
  const glyph = page.locator("[data-activity-glyph]");
  await glyph.waitFor();
  await glyph.waitFor({ state: "detached", timeout: 10_000 });
  await page.waitForTimeout(600);
}

/** The same restore, held for a minute, with the activity sheet open. */
export async function restoreSheet({ page }: { page: Page }) {
  await startRestore(page, () => after(60_000));
  await activitySheet({ page });
}
