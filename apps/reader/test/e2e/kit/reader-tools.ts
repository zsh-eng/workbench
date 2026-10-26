import type { Page } from "@playwright/test";
import { closeSheet } from "../helpers/fixtures";

/**
 * agent-kit `--steps` example for a phone Reader: taps Reader tools and
 * returns the milliseconds, measured in the page, until the sheet rests (its
 * top edge holds still for 50 ms). `reset` closes the sheet, so `kit time`
 * can repeat it.
 */
export default async function openReaderTools({ page }: { page: Page }) {
  const button = page.getByRole("button", {
    name: "Open reader tools",
    exact: true,
  });
  if (!(await button.isVisible())) await page.touchscreen.tap(195, 422);
  await button.waitFor();
  return button.evaluate(async (element) => {
    const start = performance.now();
    (element as HTMLElement).click();
    let last: number | undefined;
    let moved = start;
    for (;;) {
      await new Promise(requestAnimationFrame);
      const now = performance.now();
      const top = document
        .querySelector(
          ".reader-sheet-overlay:not([data-entering]) .reader-sheet",
        )
        ?.getBoundingClientRect().top;
      if (top === undefined || top >= innerHeight || top !== last) moved = now;
      else if (now - moved > 50) return moved - start;
      last = top;
    }
  });
}

export async function reset({ page }: { page: Page }) {
  const sheet = page.getByRole("dialog", { name: "Reader tools", exact: true });
  await closeSheet(page, sheet);
}
