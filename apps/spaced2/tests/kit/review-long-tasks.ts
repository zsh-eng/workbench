import type { Page } from "playwright";

/**
 * agent-kit `--steps`, after `markdown-cards.ts`: reloads Review and returns
 * the main thread's blocking time (each long task's time past 50 ms) in the
 * first 3 seconds, which includes rendering the cards that review preloads.
 */
export default async function longTasks({ page }: { page: Page }) {
  await page.addInitScript(() => {
    const w = window as { __blocking?: number };
    w.__blocking = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        w.__blocking! += Math.max(0, entry.duration - 50);
    }).observe({ type: "longtask", buffered: true });
  });
  await page.reload();
  await page.waitForTimeout(3000);
  return page.evaluate(() => (window as { __blocking?: number }).__blocking!);
}
