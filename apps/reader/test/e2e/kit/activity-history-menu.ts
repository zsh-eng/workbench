import type { Page } from "@playwright/test";
import {
  openAccountMenu,
  waitForSheet,
  waitForSheetToRest,
} from "../helpers/fixtures";

/**
 * agent-kit `--steps` for a clip, with `two-devices.ts`: the account menu,
 * held long enough to read, then Account → Activity until it rests.
 */
export default async function activityHistoryMenu({ page }: { page: Page }) {
  const menu = await openAccountMenu(page);
  const item = menu.getByRole("menuitem", { name: "Activity", exact: true });
  await item.waitFor();
  // Held for the viewer, not for the page.
  await page.waitForTimeout(1_000);
  await item.click();
  const sheet = await waitForSheet(page, "Activity");
  await sheet.locator("[data-sync-history]").waitFor();
  await waitForSheetToRest(sheet);
  await page.waitForTimeout(800);
}
