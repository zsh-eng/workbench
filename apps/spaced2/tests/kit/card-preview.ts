import type { Page } from "playwright";
import { DIAGRAM_CARDS } from "./diagram-cards";

/** agent-kit `--steps` on /create: writes the Mermaid card and shows Preview. */
export default async function preview({ page }: { page: Page }) {
  await page.getByPlaceholder("Enter the question").fill(DIAGRAM_CARDS[0].front);
  await page.getByPlaceholder("Enter the answer").fill(DIAGRAM_CARDS[1].back);
  await page.getByRole("button", { name: "Preview" }).click();
  await page.locator("form pre[data-rendered] svg.pele").first().waitFor();
  await page.locator("form .katex-display").waitFor();
}
