import type { Locator, Page } from "@playwright/test";
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
 * Opens the Contents entry that matches `entry` from the footer and waits
 * for its page: Contents is a sheet on a phone and a side panel on an iPad.
 * The jump saves the reading place, so the book reopens there.
 */
export async function openContentsEntry(
  page: Page,
  entry: RegExp,
): Promise<void> {
  // Setup for timings and table specs, not the interaction under test: a
  // toast or the chrome's own motion must not hold the taps up, and a busy
  // machine may drop the first open. Contents navigation has its own specs.
  const sheet = page.getByRole("dialog", { name: "Contents", exact: true });
  const entryIn = (scope: Page | Locator) =>
    scope.getByRole("button", { name: entry }).first();
  const open = async () =>
    (await sheet.isVisible()) || (await entryIn(page).isVisible());
  for (let attempt = 0; attempt < 3 && !(await open()); attempt++) {
    await showPhoneChrome(page);
    await page
      .getByRole("button", { name: "Open table of contents", exact: true })
      .dispatchEvent("click");
    await expect
      .poll(open, { timeout: 5000 })
      .toBe(true)
      .catch(() => {});
  }
  // A phone's Contents is a sheet; an iPad's is the tools panel.
  const item = (await sheet.isVisible()) ? entryIn(sheet) : entryIn(page);
  if (await sheet.isVisible()) await waitForSheet(page, "Contents");
  const pages = await currentPages(page);
  await item.dispatchEvent("click");
  await expect.poll(() => currentPages(page)).not.toEqual(pages);
  for (let attempt = 0; attempt < 3 && (await sheet.isVisible()); attempt++) {
    await page.keyboard.press("Escape");
    await expect(sheet)
      .toBeHidden({ timeout: 3000 })
      .catch(() => {});
  }
  await expect(sheet).toBeHidden();
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
