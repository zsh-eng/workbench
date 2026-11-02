import type { CDPSession, Page } from "@playwright/test";
import { waitForReaderReady } from "../helpers/fixtures";

declare global {
  interface Window {
    __turnMotion?: {
      frames: { at: number; state: string }[];
      releasedAt: number | null;
      stop: boolean;
    };
  }
}

/**
 * agent-kit `time` steps: one page turn on a touch screen, and how long the
 * page moves after the finger lifts. `KIT_TURN` is `tap` (the default) or
 * `swipe`, a 300 px flick. Each frame reads every spread layer's offset and
 * opacity, so the result is the time from the finger's lift to the last
 * frame that differs from rest, with no fixed wait. Logs the first and last
 * moving frames to `KIT_RECORD`'s console line.
 */
export default async function turnMotion({ page }: { page: Page }) {
  await waitForReaderReady(page);
  await page.evaluate(() => {
    const motion = { frames: [], releasedAt: null, stop: false } as NonNullable<
      Window["__turnMotion"]
    >;
    window.__turnMotion = motion;
    addEventListener(
      "pointerup",
      () => {
        motion.releasedAt = performance.now();
      },
      { capture: true, once: true },
    );
    const state = () =>
      [
        ...document.querySelectorAll<HTMLElement>(
          "[data-reader-spread-layer], [data-reader-spread-layer] > div",
        ),
      ]
        .map((element) => {
          const style = getComputedStyle(element);
          const x = new DOMMatrix(style.transform).m41;
          return `${element.dataset.readerSpreadLayer ?? "spread"}:${x.toFixed(1)}:${Number(style.opacity).toFixed(3)}`;
        })
        .join(" ");
    const loop = () => {
      motion.frames.push({ at: performance.now(), state: state() });
      if (!motion.stop) requestAnimationFrame(loop);
    };
    loop();
  });

  const { width, height } = page.viewportSize()!;
  const y = height / 2;
  if ((process.env.KIT_TURN ?? "tap") === "tap") {
    await page.touchscreen.tap(width * 0.85, y);
  } else {
    const cdp: CDPSession = await page.context().newCDPSession(page);
    const point = (x: number) => [{ x, y }];
    const from = width * 0.8;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: point(from),
    });
    for (let step = 1; step <= 6; step++) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: point(from - step * 50),
      });
      await page.waitForTimeout(16);
    }
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await cdp.detach();
  }

  await page.waitForTimeout(1200); // past any turn: the frames say when it ended
  const { frames, releasedAt } = await page.evaluate(() => {
    const motion = window.__turnMotion!;
    motion.stop = true;
    return { frames: motion.frames, releasedAt: motion.releasedAt };
  });
  const rest = frames.at(-1)!.state;
  const lastMoving = frames.findLastIndex((frame) => frame.state !== rest);
  const firstMoving = frames.findIndex(
    (frame, index) =>
      index > 0 &&
      frame.at >= (releasedAt ?? 0) &&
      frame.state !== frames[index - 1]!.state,
  );
  const elapsed = frames[lastMoving + 1]!.at - (releasedAt ?? frames[0]!.at);
  console.log(
    `first change +${Math.round(frames[firstMoving]!.at - releasedAt!)} ms, rest +${Math.round(elapsed)} ms`,
  );
  return elapsed;
}
