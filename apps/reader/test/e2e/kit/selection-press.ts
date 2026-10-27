import type { Page } from "@playwright/test";
import {
  nextSpread,
  selectPassage,
  waitForReaderReady,
} from "../helpers/fixtures";

const COLOUR = { name: "Highlight with yellow" } as const;

/**
 * agent-kit `--steps` for `kit time` on a phone Reader: what a press on the
 * highlight tools costs, which reads the selection into a highlight's
 * place in the chapter. The first run turns 8 spreads, selects a passage
 * and waits for the tools. Each run returns the milliseconds, measured in
 * the page, that a pointerdown on a colour takes. `reset` cancels the press.
 * `selection-press-chapter-end.ts` presses at the end of the first chapter.
 */
export default async function pressHighlightTools({ page }: { page: Page }) {
  if (!(await page.getByRole("button", COLOUR).isVisible())) {
    await waitForReaderReady(page);
    for (let turn = 0; turn < 8; turn++) await nextSpread(page);
  }
  return pressColour(page);
}

/** Selects a passage if the tools are not open, then times one press. */
export async function pressColour(page: Page): Promise<number> {
  const colour = page.getByRole("button", COLOUR);
  if (!(await colour.isVisible())) {
    await selectPassage(page, { index: 2, length: 30 });
    await colour.waitFor();
  }
  return colour.evaluate((element) => {
    const start = performance.now();
    element.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        pointerType: "touch",
        isPrimary: true,
      }),
    );
    return performance.now() - start;
  });
}

export async function reset({ page }: { page: Page }) {
  await page
    .getByRole("button", COLOUR)
    .dispatchEvent("pointercancel", { bubbles: true, pointerType: "touch" });
}
