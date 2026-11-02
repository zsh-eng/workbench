import type { Page } from "@playwright/test";
import { waitForReaderReady } from "../helpers/fixtures";

/**
 * agent-kit steps for a picture of the page: turns `KIT_TURNS` pages (6 by
 * default) with the arrow key, past the book's front matter, and waits for
 * the spread to rest.
 */
export default async function bookSpread({ page }: { page: Page }) {
  await waitForReaderReady(page);
  const turns = Number(process.env.KIT_TURNS ?? "6");
  for (let turn = 0; turn < turns; turn++) {
    await page.keyboard.press("ArrowRight");
    await waitForReaderReady(page);
  }
  await page.waitForTimeout(600); // the last turn's motion, for the picture only
}
