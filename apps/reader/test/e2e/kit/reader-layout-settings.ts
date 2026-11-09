import type { Page } from "@playwright/test";
import { waitForReaderReady } from "../helpers/fixtures";

/**
 * agent-kit steps: opens Appearance → Page in the Reader tools sidebar of
 * a tablet or desktop window (Reading view, Pages, Full screen while
 * reading).
 */
export default async function layoutSettings({ page }: { page: Page }) {
  await waitForReaderReady(page);
  const tools = page.getByRole("button", {
    name: "Open reader tools",
    exact: true,
  });
  const { width, height } = page.viewportSize()!;
  if (!(await tools.isVisible()) || (await tools.boundingBox())!.y < 0)
    await page.touchscreen.tap(width / 2, height / 2);
  await tools.click();
  const sidebar = page.locator('aside[aria-label="Reader tools"]');
  const row = sidebar.locator("[data-pages-row]");
  if (!(await row.isVisible()))
    await sidebar
      .getByRole("button", { name: "Reading appearance", exact: true })
      .click();
  if (!(await row.isVisible()))
    await sidebar.getByRole("tab", { name: "Page", exact: true }).click();
  await row.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400); // the sidebar's slide, for the picture only
}
