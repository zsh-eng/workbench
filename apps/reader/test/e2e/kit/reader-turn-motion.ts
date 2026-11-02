import type { CDPSession, Page } from "@playwright/test";
import { waitForReaderReady } from "../helpers/fixtures";

declare global {
  interface Window {
    __turnMotion?: {
      frames: { at: number; state: string; values: number[] }[];
      releasedAt: number | null;
      stop: boolean;
    };
  }
}

/**
 * agent-kit `time` steps: one page turn on a touch screen, and how long the
 * page moves after the finger lifts. `KIT_TURN` is `tap` (the default) or
 * `swipe`, a 300 px flick. Each frame reads every spread layer's offset and
 * opacity, so the result is the time from the finger's lift to the first
 * frame that looks at rest: every layer within half a pixel of where it ends
 * and 1% of its final opacity. Logs the first change and the rest.
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
    const read = () =>
      [
        ...document.querySelectorAll<HTMLElement>(
          "[data-reader-spread-layer], [data-reader-spread-layer] > div",
        ),
      ].map((element) => {
        const style = getComputedStyle(element);
        return {
          name: element.dataset.readerSpreadLayer ?? "spread",
          x: new DOMMatrix(style.transform).m41,
          opacity: Number(style.opacity),
        };
      });
    const loop = () => {
      const layers = read();
      motion.frames.push({
        at: performance.now(),
        state: layers.map((layer) => layer.name).join(" "),
        values: layers.flatMap((layer) => [layer.x, layer.opacity * 50]),
      });
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
  const rest = frames.at(-1)!;
  const atRest = (frame: (typeof frames)[number]) =>
    frame.state === rest.state &&
    frame.values.every(
      (value, index) => Math.abs(value - rest.values[index]!) <= 0.5,
    );
  const lastMoving = frames.findLastIndex((frame) => !atRest(frame));
  const released = releasedAt ?? frames[0]!.at;
  const firstMoving = frames.find(
    (frame, index) =>
      index > 0 &&
      frame.at >= released &&
      (frame.state !== frames[index - 1]!.state ||
        frame.values.some(
          (value, at) => value !== frames[index - 1]!.values[at],
        )),
  )!;
  const elapsed = frames[lastMoving + 1]!.at - released;
  console.log(
    `first change +${Math.round(firstMoving.at - released)} ms, rest +${Math.round(elapsed)} ms`,
  );
  return elapsed;
}
