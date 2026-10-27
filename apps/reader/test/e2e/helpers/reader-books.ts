import type { Page } from "@playwright/test";
import {
  currentPages,
  expect,
  waitForReaderReady,
  waitForSheet,
} from "./fixtures";

/**
 * Imports an EPUB through the Library's file picker and opens it. Returns
 * the book's id from the Reader's address, so it works on a production
 * preview as well as on the dev server.
 */
export async function importAndOpenEpub(
  page: Page,
  file: string | { name: string; mimeType: string; buffer: Buffer },
  title: string | RegExp,
): Promise<string> {
  await page.goto("/");
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page
      .getByRole("button", { name: "Choose EPUB files", exact: true })
      .click(),
  ]);
  await chooser.setFiles(file);
  const heading = page.getByRole("heading", { name: title }).first();
  await expect(heading).toBeVisible({ timeout: 120_000 });
  await heading.click();
  await page.waitForURL(/\/reader\/[^/?#]+/, { timeout: 60_000 });
  await waitForReaderReady(page);
  return decodeURIComponent(
    new URL(page.url()).pathname.split("/reader/")[1]!.split("/")[0]!,
  );
}

/**
 * Opens the Contents entry that matches `entry` from the phone's footer and
 * waits for its page. The jump saves the reading place, so the
 * book reopens there.
 */
export async function openContentsEntry(
  page: Page,
  entry: RegExp,
): Promise<void> {
  await showPhoneChrome(page);
  await page
    .getByRole("button", { name: "Open table of contents", exact: true })
    .click();
  const contents = await waitForSheet(page, "Contents");
  const pages = await currentPages(page);
  await contents.getByRole("button", { name: entry }).first().click();
  await expect.poll(() => currentPages(page)).not.toEqual(pages);
  if (await contents.isVisible()) await page.keyboard.press("Escape");
  await expect(contents).toBeHidden();
  await waitForReaderReady(page);
}

/**
 * Shows the phone Reader's header, without the reading-status prompt that
 * a new book shows in its place. Hidden chrome is translated above the
 * viewport, not removed, and a tap in the middle of the page toggles it.
 */
export async function showPhoneChrome(page: Page): Promise<void> {
  // A new book's reading-status prompt stands where the header shows.
  const prompt = page.getByRole("button", {
    name: "Dismiss reading status prompt",
  });
  if (await prompt.isVisible()) await prompt.click();
  const tools = page.getByRole("button", { name: "Open reader tools" });
  const shown = async () =>
    (await tools.count()) > 0 &&
    (await tools.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return rect.top > 0 && rect.height > 0;
    }));
  const { width, height } = page.viewportSize()!;
  for (let attempt = 0; attempt < 4 && !(await shown()); attempt++) {
    await page.evaluate(() => getSelection()?.removeAllRanges());
    await page.touchscreen.tap(width / 2, height / 2);
    await expect
      .poll(shown, { timeout: 1500 })
      .toBe(true)
      .catch(() => {});
  }
  await expect.poll(shown).toBe(true);
}
