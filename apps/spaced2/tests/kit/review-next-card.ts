import type { Page } from "playwright";

/**
 * agent-kit `--steps`, after `markdown-cards.ts`, on a desktop window:
 * grades the current card Good and returns the milliseconds from the click
 * to the frame after the next card's front has its text, measured in the
 * page. Each run grades one of the 160 cards.
 */
export default async function nextCard({ page }: { page: Page }) {
  await page.waitForFunction(() =>
    /#\d+/.test(document.querySelector("main article")?.textContent ?? ""),
  );
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const article = () => document.querySelector("main article");
        const before = article()?.textContent?.match(/#\d+/)?.[0];
        const good = [...document.querySelectorAll("main button")].find(
          (button) => button.textContent?.trim().startsWith("Good"),
        ) as HTMLButtonElement | undefined;
        if (!good) return reject(new Error("No Good button"));
        const start = performance.now();
        good.click();
        const frame = () => {
          const now = article()?.textContent?.match(/#\d+/)?.[0];
          if (now && now !== before) resolve(performance.now() - start);
          else if (performance.now() - start > 10_000)
            reject(new Error("The next card did not show"));
          else requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      }),
  );
}
