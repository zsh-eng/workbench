import type { Page } from "playwright";

/** agent-kit `--steps` on Review, after `diagram-cards.ts`: Edit, then Preview. */
export default async function editPreview({ page }: { page: Page }) {
  await page.locator("main article").first().waitFor();
  await page.getByRole("button", { name: "Card actions" }).click();
  await page.getByRole("menuitem", { name: /Edit/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Preview" }).click();
  await page.locator("[role=dialog] pre[data-rendered] svg.pele").first().waitFor();
  await page.waitForTimeout(400);
}
