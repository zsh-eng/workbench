import type { Page } from "@playwright/test";
import {
  nextSpread,
  selectPassage,
  waitForReaderReady,
} from "../helpers/fixtures";

/**
 * agent-kit `--steps` for a phone Reader with the sample book: selects a
 * passage and lets the highlight tools open, then changes the selection
 * with no release, as a selection handle or a key can, and taps Highlight
 * straight away. The clip shows which passage the highlight takes.
 */
export default async function changeSelectionAndHighlight({
  page,
}: {
  page: Page;
}) {
  await waitForReaderReady(page);
  for (let turn = 0; turn < 8; turn++) await nextSpread(page);
  const yellow = page.getByRole("button", { name: "Highlight with yellow" });
  await selectPassage(page, { index: 0, length: 20 });
  await yellow.waitFor();
  // Pauses only let a viewer see each selection.
  await page.waitForTimeout(800);
  await selectPassage(page, { index: 3, length: 40, release: false });
  await page.waitForTimeout(250);
  await yellow.tap();
  await page
    .locator('[data-reader-spread-layer="current"] mark[data-highlight-id]')
    .first()
    .waitFor();
  await page.waitForTimeout(1200);
}
