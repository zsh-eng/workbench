import { afterEach, beforeEach, expect, test } from "vitest";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { Shimmer } from "../../src/web/components/Shimmer";
import { initializeTheme } from "../../src/web/themes";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  initializeTheme();
  host = document.createElement("div");
  host.style.width = "320px";
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  root.unmount();
  host.remove();
});

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

test.each([false, true])(
  "the light passes over a label with transforms only, and its copy stays on the label's text (quiet: %s)",
  async (quiet) => {
    const show = (on: boolean) =>
      flushSync(() =>
        root.render(
          <div style={{ display: "flex" }}>
            <Shimmer on={on} quiet={quiet}>
              <span style={{ fontWeight: 600 }}>Run </span>
              <span>bun test --watch</span>
            </Shimmer>
          </div>,
        ),
      );
    show(true);
    const label = host.querySelector("div > span") as HTMLElement;
    const [verb, target] = [...label.children] as HTMLElement[];
    // The text is in the document once.
    expect(label.textContent).toBe("Run bun test --watch");

    // Only transforms animate: no layout or paint on each frame.
    const animations = label.getAnimations({ subtree: true });
    expect(animations).toHaveLength(2);
    for (const animation of animations) {
      expect(animation.playState).toBe("running");
      const keys = (animation.effect as KeyframeEffect)
        .getKeyframes()
        .flatMap((frame) => Object.keys(frame))
        .filter((key) => !["offset", "computedOffset", "easing", "composite"].includes(key));
      expect(new Set(keys)).toEqual(new Set(["transform"]));
    }

    // The window moves; the copy's text does not: it stays on the label's.
    const copy = label.querySelector('[aria-hidden="true"] > span > span') as HTMLElement;
    const [ghostVerb, ghostTarget] = [...copy.children] as HTMLElement[];
    const slider = copy.parentElement!;
    const seen = new Set<number>();
    for (let frame = 0; frame < 20; frame++) {
      await nextFrame();
      seen.add(Math.round(slider.getBoundingClientRect().left));
      for (const [real, ghost] of [
        [verb!, ghostVerb!],
        [target!, ghostTarget!],
      ] as const) {
        const a = real.getBoundingClientRect();
        const b = ghost.getBoundingClientRect();
        expect(Math.abs(a.left - b.left)).toBeLessThan(0.5);
        expect(Math.abs(a.width - b.width)).toBeLessThan(0.5);
        expect(Math.abs(a.top - b.top)).toBeLessThan(0.5);
      }
    }
    expect(seen.size).toBeGreaterThan(3);

    // Off, the light leaves, and the label's own elements stay as they were.
    show(false);
    expect([...label.children]).toEqual([verb, target]);
    expect(label.getAnimations({ subtree: true })).toHaveLength(0);
  },
);
