import { SPRINGS, settleTime, springDisplacement, type Spring } from "./spring";

/**
 * Moves a React Aria Sheet on a spring, as a UIKit sheet moves.
 *
 * React Aria's Sheet is a scroll container: a drag is the browser's own
 * scrolling, with its momentum and snapping to detents, and that stays. The
 * sheet's own moves (opening, closing, a new detent) are smooth scrolls,
 * which follow the browser's curve and start a screen below for a short
 * sheet. This takes over those smooth scrolls on one scroller: it starts an
 * entering sheet at the bottom edge of the screen and runs the spring on the
 * scroll offset frame by frame. Everything that React Aria drives from the
 * scroll offset (the dimming, the lower sheet's step back, closing once the
 * sheet is out of view) follows the spring with it.
 *
 * A drag, a wheel or an instant scroll stops the spring where it is; a tap
 * lets it settle. A new smooth scroll starts from the current place and
 * speed. With reduced
 * motion, React Aria scrolls instantly and this does nothing. Returns a
 * function that gives the scroller back.
 */
export function springSheetScroller(
  scroller: HTMLElement,
  spring: Spring = SPRINGS.sheet,
): () => void {
  const nativeScrollTo = Element.prototype.scrollTo;
  let run: Run | null = null;
  let snap = "";
  let userScroll = false;

  type Run = {
    frame: number;
    position: () => number;
    velocity: () => number;
  };

  const finish = (dispatch: boolean) => {
    if (!run) return;
    cancelAnimationFrame(run.frame);
    run = null;
    scroller.style.scrollSnapType = snap;
    // React Aria waits for the scroll to end before the sheet counts as
    // open or closed.
    if (dispatch) scroller.dispatchEvent(new Event("scrollend"));
  };

  const springTo = (top: number) => {
    const goal = snapTarget(scroller, top);
    let from = scroller.scrollTop;
    let speed = 0;
    if (run) {
      from = run.position();
      speed = run.velocity();
      cancelAnimationFrame(run.frame);
    } else {
      // A drag that interrupted the last spring has snapping off still.
      if (!userScroll) snap = scroller.style.scrollSnapType;
      userScroll = false;
    }
    // React Aria rests a closed sheet a screen below. The spring covers
    // only the part that you see, as UIKit's does: an entering sheet starts
    // at the bottom edge of the screen, and a leaving one stops there, then
    // drops to its closed place out of view.
    const sheet = scroller.querySelector("[data-sheet-content]");
    const edge = sheet
      ? scroller.scrollTop + sheet.getBoundingClientRect().top - screenBottom()
      : -Infinity;
    if (goal > from && from < edge) from = Math.min(edge, goal);
    const target = goal < from && goal < edge ? Math.min(edge, from) : goal;
    // Snapping would pull each frame's offset to a detent.
    scroller.style.scrollSnapType = "none";
    const distance = target - from;
    if (Math.abs(distance) < 0.5) {
      scroller.scrollTop = goal;
      run = { frame: 0, position: () => goal, velocity: () => 0 };
      finish(true);
      return;
    }
    // Spring time is in seconds; its velocity is in distances per second.
    const velocity = speed / distance;
    const seconds = settleTime(spring, distance, { velocity });
    const start = performance.now();
    const at = (t: number) =>
      target - distance * springDisplacement(spring, t, velocity);
    const elapsed = () => Math.min((performance.now() - start) / 1000, seconds);
    const current: Run = {
      frame: 0,
      position: () => at(elapsed()),
      velocity: () => {
        const t = elapsed();
        return (at(t + 0.004) - at(t)) / 0.004;
      },
    };
    run = current;
    scroller.scrollTop = from;
    const step = () => {
      if (run !== current) return;
      if (!scroller.isConnected) {
        run = null;
        return;
      }
      const t = elapsed();
      scroller.scrollTop = t >= seconds ? goal : at(t);
      if (t >= seconds) finish(true);
      else current.frame = requestAnimationFrame(step);
    };
    current.frame = requestAnimationFrame(step);
  };

  scroller.scrollTo = function scrollTo(
    this: HTMLElement,
    ...args: [ScrollToOptions?] | [number, number]
  ) {
    const [options] = args;
    if (
      typeof options === "object" &&
      options?.behavior === "smooth" &&
      typeof options.top === "number" &&
      !matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      springTo(options.top);
      return;
    }
    finish(false);
    nativeScrollTo.apply(this, args as [ScrollToOptions]);
  } as typeof scroller.scrollTo;

  // While the spring runs, the offsets it writes end scrolls of their own.
  // React Aria would take the first for the end of the move.
  const onScrollEnd = (event: Event) => {
    if (event.target !== scroller || !event.isTrusted) return;
    if (run) event.stopImmediatePropagation();
    // A drag that took the sheet from the spring snaps once it ends.
    else if (userScroll) {
      userScroll = false;
      scroller.style.scrollSnapType = snap;
    }
  };
  // A finger or a wheel that moves the sheet takes it from wherever the
  // spring has it, and the browser's own scrolling carries on. A tap does
  // not: it leaves the sheet to settle. Snapping returns once that scroll
  // ends; changing it during a throw would stop the throw in Safari.
  const interrupt = () => {
    if (!run) return;
    cancelAnimationFrame(run.frame);
    run = null;
    userScroll = true;
  };
  window.addEventListener("scrollend", onScrollEnd, true);
  scroller.addEventListener("touchmove", interrupt, { passive: true });
  scroller.addEventListener("wheel", interrupt, { passive: true });

  return () => {
    finish(false);
    delete (scroller as { scrollTo?: unknown }).scrollTo;
    window.removeEventListener("scrollend", onScrollEnd, true);
    scroller.removeEventListener("touchmove", interrupt);
    scroller.removeEventListener("wheel", interrupt);
  };
}

/**
 * Where a smooth scroll to `top` comes to rest. The sheet's scroller snaps
 * to the nearest snap position, as the browser does at the end of a smooth
 * scroll: React Aria's exit and rest markers are its children, and its
 * detents are `[data-sheet-detent]`. On iOS Safari the scroll range runs
 * past full height, under the toolbar, so the end of the range is not a
 * rest.
 */
function snapTarget(scroller: HTMLElement, top: number): number {
  const max = scroller.scrollHeight - scroller.clientHeight;
  const box = scroller.getBoundingClientRect();
  let best = Math.min(Math.max(top, 0), max);
  let bestDistance = Infinity;
  const markers = [
    ...scroller.children,
    ...scroller.querySelectorAll("[data-sheet-detent]"),
  ];
  for (const marker of markers) {
    if (!(marker instanceof HTMLElement)) continue;
    const align = marker.style.scrollSnapAlign.split(" ")[0];
    if (align !== "start" && align !== "end") continue;
    const rect = marker.getBoundingClientRect();
    const style = getComputedStyle(marker);
    const position =
      align === "start"
        ? rect.top -
          box.top +
          scroller.scrollTop -
          (parseFloat(style.scrollMarginTop) || 0)
        : rect.bottom -
          box.top +
          scroller.scrollTop +
          (parseFloat(style.scrollMarginBottom) || 0) -
          scroller.clientHeight;
    const snapped = Math.min(Math.max(position, 0), max);
    const distance = Math.abs(snapped - top);
    if (distance < bestDistance) {
      best = snapped;
      bestDistance = distance;
    }
  }
  return best;
}

/** The bottom of what can show: on iOS Safari the page runs on under the
 * toolbar, to the large viewport's height. */
function screenBottom(): number {
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;top:0;height:100lvh;width:0;visibility:hidden;pointer-events:none";
  document.body.append(probe);
  const large = probe.offsetHeight;
  probe.remove();
  return Math.max(innerHeight, large);
}
