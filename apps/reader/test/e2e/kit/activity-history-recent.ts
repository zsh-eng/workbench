import type { Page } from "@playwright/test";
import { waitForSheetToRest } from "../helpers/fixtures";
import activityHistory from "./activity-history";

/**
 * agent-kit `--steps`, with `two-devices.ts`: Account → Activity, dragged
 * up to full height so Recent shows whole.
 */
export default async function activityHistoryRecent({ page }: { page: Page }) {
  await activityHistory({ page });
  const sheet = page.getByRole("dialog", { name: "Activity" });
  const box = (await sheet.boundingBox())!;
  await page.mouse.move(195, box.y + 20);
  await page.mouse.wheel(0, 900);
  await waitForSheetToRest(sheet);
}
