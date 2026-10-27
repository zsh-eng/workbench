import type { KitContext } from "../../../../../packages/agent-kit/kit";

/**
 * agent-kit `--steps`: waits for the library's cards and their first
 * pictures, then scrolls down SCROLL_PX (4000) by wheel steps over
 * SCROLL_SECONDS (8), as a reader flicks through it. SCROLL_PX=0 only waits.
 * SCROLL_FROM starts lower, at once, for a still of a later part. The
 * scroll is marked `kit:scroll` for `kit frames`.
 */
export default async function scrollLibrary({ page }: KitContext) {
  await page.locator(".card[data-id]").first().waitFor();
  const from = Number(process.env.SCROLL_FROM ?? 0);
  if (from) await page.evaluate((top) => window.scrollTo({ top }), from);
  // Pictures on screen, or six seconds.
  await page
    .waitForFunction(
      () =>
        [...document.querySelectorAll<HTMLImageElement>(".cover img")]
          .filter((image) => {
            const box = image.getBoundingClientRect();
            return box.top < innerHeight && box.bottom > 0;
          })
          .every((image) => image.complete),
      undefined,
      { timeout: 6000 },
    )
    .catch(() => {});
  await page.waitForTimeout(400);
  const distance = Number(process.env.SCROLL_PX ?? 4000);
  const seconds = Number(process.env.SCROLL_SECONDS ?? 8);
  const steps = Math.max(1, Math.round(seconds * 30));
  const box = page.viewportSize()!;
  await page.mouse.move(box.width / 2, box.height / 2);
  // For `kit frames`: the scroll, from the first wheel step to the last.
  await page.evaluate(() => performance.mark("kit:scroll:start"));
  for (let step = 0; step < steps && distance; step++) {
    // Ease in and out, as a flick slows.
    const t = (step + 0.5) / steps;
    await page.mouse.wheel(
      0,
      (distance / steps) * 1.5 * Math.sin(Math.PI * t) * 1.05,
    );
    await page.waitForTimeout(1000 / 30);
  }
  await page.evaluate(() => performance.mark("kit:scroll:end"));
  await page.waitForTimeout(600);
}
