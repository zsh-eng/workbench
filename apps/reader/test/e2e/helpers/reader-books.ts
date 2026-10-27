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
 * Opens the Contents entry that matches `entry` from the footer and waits
 * for its page: Contents is a sheet on a phone and the Reader tools panel,
 * which may already be open, on an iPad. The jump saves the reading place,
 * so the book reopens there.
 */
export async function openContentsEntry(
  page: Page,
  entry: RegExp,
): Promise<void> {
  const sheet = page.getByRole("dialog", { name: "Contents", exact: true });
  const panelItem = page
    .getByRole("complementary", { name: "Reader tools", exact: true })
    .getByRole("button", { name: entry })
    .first();
  if (!(await panelItem.isVisible())) {
    await showPhoneChrome(page);
    const button = page.getByRole("button", {
      name: "Open table of contents",
      exact: true,
    });
    // Setup for timings and table specs; Contents has its own specs. A tap
    // before the Reader takes taps opens Contents once it does. An event
    // click is not held up by a toast or the chrome's own motion.
    await button.dispatchEvent("click");
    await expect(sheet.or(panelItem).first()).toBeVisible();
  }
  const onSheet = await sheet.isVisible();
  if (onSheet) await waitForSheet(page, "Contents");
  const item = onSheet
    ? sheet.getByRole("button", { name: entry }).first()
    : panelItem;
  const pages = await currentPages(page);
  await item.dispatchEvent("click");
  await expect.poll(() => currentPages(page)).not.toEqual(pages);
  // Escape reaches the sheet from inside it, and the jump may move focus.
  if (await sheet.isVisible()) await sheet.press("Escape");
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
