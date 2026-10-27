import type { Page } from "@playwright/test";
import { waitForSheet, waitForSheetToRest } from "../helpers/fixtures";

/**
 * agent-kit `--steps`, on `/debug/sheet-lab` with Debug on (`--storage
 * reader-debug-enabled-v1=true`): opens the lab's case `KIT_LAB_CASE`
 * ("fit" unless set) and waits for its sheet to rest. With `KIT_LAB_CLOSE`
 * set it then waits a moment and swipes the sheet away: a wheel, as a
 * trackpad scrolls it, since WebKit has no touch drag to replay.
 */
export default async function sheetLabOpen({ page }: { page: Page }) {
  const id = process.env.KIT_LAB_CASE ?? "fit";
  const scenario = page.locator(`[data-lab-scenario="${id}"]`);
  await scenario.waitFor({ timeout: 30_000 });
  const title = (await scenario.locator("span").first().textContent())!;
  await page.waitForTimeout(400);
  await scenario.click();
  const sheet = await waitForSheet(page, title);
  await waitForSheetToRest(sheet);
  if (!process.env.KIT_LAB_CLOSE) return;
  await page.waitForTimeout(600);
  const box = (await sheet.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 30);
  for (let step = 0; step < 12; step++) {
    await page.mouse.wheel(0, -80);
    await page.waitForTimeout(16);
  }
  await sheet.waitFor({ state: "hidden" });
}
