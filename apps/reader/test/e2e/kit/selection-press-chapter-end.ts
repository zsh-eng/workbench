import type { Page } from "@playwright/test";
import {
  currentPages,
  expect,
  openReaderTool,
  waitForReaderReady,
} from "../helpers/fixtures";
import { pressColour } from "./selection-press";

export { reset } from "./selection-press";

/**
 * agent-kit `--steps` for `kit time`, as `selection-press.ts`, with the
 * passage on the last spread of the first chapter: reached through
 * Contents to the second chapter, then one spread back. Work that walks a
 * chapter up to the passage costs most there.
 */
export default async function pressAtChapterEnd({ page }: { page: Page }) {
  if (
    !(await page
      .getByRole("button", { name: "Highlight with yellow" })
      .isVisible())
  ) {
    await waitForReaderReady(page);
    await page.touchscreen.tap(195, 422);
    const contents = await openReaderTool(page, /Contents/, "Contents");
    await contents
      .getByRole("button")
      .filter({ hasText: /Pool of Tears/i })
      .first()
      .click();
    // Contents, then Reader tools under it.
    for (const sheet of [
      contents,
      page.getByRole("dialog", { name: "Reader tools" }),
    ]) {
      await page.keyboard.press("Escape");
      await expect(sheet).not.toBeVisible();
    }
    await waitForReaderReady(page);
    const chapterStart = await currentPages(page);
    await page.keyboard.press("ArrowLeft");
    await expect.poll(() => currentPages(page)).not.toEqual(chapterStart);
    await waitForReaderReady(page);
  }
  return pressColour(page);
}
