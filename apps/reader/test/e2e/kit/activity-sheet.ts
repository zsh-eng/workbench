import type { Page } from "@playwright/test";
import { waitForSheet, waitForSheetToRest } from "../helpers/fixtures";

/** agent-kit `--steps`: taps the activity glyph and waits for its sheet. */
export default async function activitySheet({ page }: { page: Page }) {
  await page.locator("[data-activity-glyph]").click();
  await waitForSheetToRest(await waitForSheet(page, "Activity"));
}
