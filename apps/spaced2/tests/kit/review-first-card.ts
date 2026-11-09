import type { Page } from "playwright";

/**
 * agent-kit `--steps`, after `markdown-cards.ts`: reloads Review and returns
 * the milliseconds from navigation start to the frame after the first
 * card's front has its text, measured in the page.
 */
export default async function firstCard({ page }: { page: Page }) {
  await page.addInitScript(() => {
    const w = window as { __firstCard?: number };
    const look = () => {
      const article = document.querySelector("main article");
      if (/#\d+/.test(article?.textContent ?? "")) {
        requestAnimationFrame(() => {
          w.__firstCard = performance.now();
          console.info("first card", article.textContent?.match(/#\d+/)?.[0]);
        });
        return true;
      }
      return false;
    };
    const observer = new MutationObserver(() => look() && observer.disconnect());
    observer.observe(document, { childList: true, subtree: true });
  });
  await page.reload();
  await page.waitForFunction(
    () => (window as { __firstCard?: number }).__firstCard !== undefined,
    undefined,
    { timeout: 60_000 },
  );
  return page.evaluate(() => (window as { __firstCard?: number }).__firstCard!);
}
