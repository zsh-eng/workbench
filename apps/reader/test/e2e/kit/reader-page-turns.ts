import type { Page } from "@playwright/test";
import { nextSpread, waitForReaderReady } from "../helpers/fixtures";

/**
 * agent-kit `time` steps: turns `KIT_TURNS` pages (8 by default) forward
 * from the Reader's place with the arrow key, each once the last has come to
 * rest. Marks the turns `kit:turns:start` and `kit:turns:end` for
 * `kit frames`, and returns their mean in milliseconds.
 */
export default async function turns({ page }: { page: Page }) {
  await waitForReaderReady(page);
  const count = Number(process.env.KIT_TURNS ?? "8");
  await page.evaluate(() => performance.mark("kit:turns:start"));
  const startedAt = Date.now();
  for (let turn = 0; turn < count; turn++) await nextSpread(page);
  const elapsed = Date.now() - startedAt;
  await page.evaluate(() => performance.mark("kit:turns:end"));
  return elapsed / count;
}

/** Back to the page the turns started from, untimed. */
export async function reset({ page }: { page: Page }) {
  const count = Number(process.env.KIT_TURNS ?? "8");
  for (let turn = 0; turn < count; turn++) {
    await page.keyboard.press("ArrowLeft");
    await waitForReaderReady(page);
  }
}
