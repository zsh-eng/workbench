import type { Page } from "@playwright/test";
import {
  openAccountMenu,
  waitForSheet,
  waitForSheetToRest,
} from "../helpers/fixtures";

/** agent-kit `--steps`, with `two-devices.ts`: Account → Activity, at rest. */
export default async function activityHistory({ page }: { page: Page }) {
  const menu = await openAccountMenu(page);
  await menu.getByRole("menuitem", { name: "Activity", exact: true }).click();
  const sheet = await waitForSheet(page, "Activity");
  await sheet.locator("[data-sync-history]").waitFor();
  await waitForSheetToRest(sheet);
}
