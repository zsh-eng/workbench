import type { KitContext } from "../../../../../packages/agent-kit/kit";

/**
 * agent-kit `--steps`, after `preview-account.ts`: saves `{link}` with the
 * Save a link field and waits until its page's preview has arrived.
 */
export default async function saveLink({ page, vars }: KitContext) {
  await page.locator(".card").first().waitFor();
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: "Save a link" }).first().click();
  await page.getByPlaceholder("Paste a link").fill(vars.link!);
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page
    .locator(".card-title", { hasText: "The quiet clock of sea ice" })
    .waitFor({ timeout: 15_000 });
  await page.waitForTimeout(1200);
}
