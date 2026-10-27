import { SPRINGS, settleTime, springDisplacement, type Spring } from "./spring";

/** A spring asked for the scroller's next smooth scroll only. */
const nextSprings = new WeakMap<HTMLElement, Spring>();

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
 * The spring heads for a snap marker, not a fixed offset: when the sheet's
 * height changes during the move (content that arrives while it opens), its
 * detent moves and the spring follows, so the sheet still lands on it.
 *
 * A drag, a wheel or an instant scroll stops the spring where it is; a tap
 * lets it settle. A new smooth scroll starts from the current place and
 * speed. The scroller has `data-sheet-spring` while the spring runs. With
 * reduced motion, React Aria scrolls instantly and this does nothing.
 * Returns a function that gives the scroller back.
 */
export function springSheetScroller(
  scroller: HTMLElement,
  spring: Spring = SPRINGS.sheet,
): () => void {
  const nativeScrollTo = Element.prototype.scrollTo;
  let run: Run | null = null;
  let snap = "";
  let userScroll = false;
  /** A sheet that left keeps snapping off until it moves again. */
  let parked = false;

  type Run = {
    frame: number;
    position: () => number;
    velocity: () => number;
    leaving: boolean;
  };

  const restoreSnap = () => {
    parked = false;
    scroller.style.scrollSnapType = snap;
  };

  const finish = (dispatch: boolean) => {
    if (!run) return;
    const { leaving } = run;
    cancelAnimationFrame(run.frame);
    run = null;
    scroller.removeAttribute("data-sheet-spring");
    // Snapping would pull a sheet that left back to its nearest detent
    // before React Aria sees it out of view, and it would not close.
    if (leaving && dispatch) parked = true;
    else restoreSnap();
    // React Aria waits for the scroll to end before the sheet counts as
    // open or closed.
    if (dispatch) scroller.dispatchEvent(new Event("scrollend"));
  };

  const springTo = (top: number) => {
    const moveSpring = nextSprings.get(scroller) ?? spring;
    nextSprings.delete(scroller);
    const resting = snapTarget(scroller, top);
    const goal = resting.position;
    let from = scroller.scrollTop;
    let speed = 0;
    if (run) {
      from = run.position();
      speed = run.velocity();
      cancelAnimationFrame(run.frame);
    } else {
      // A drag that interrupted the last spring, or a sheet that left, has
      // snapping off still.
      if (!userScroll && !parked) snap = scroller.style.scrollSnapType;
      userScroll = false;
      parked = false;
    }
    // React Aria rests a closed sheet a screen below. The spring covers
    // only the part that you see, as UIKit's does: an entering sheet starts
    // at the bottom edge of the screen, and a leaving one stops there, then
    // drops to its closed place out of view.
    const sheet = scroller.querySelector("[data-sheet-content]");
    const edge = sheet
      ? scroller.scrollTop + sheet.getBoundingClientRect().top - screenBottom()
      : -Infinity;
    // An entering sheet starts a pixel in. React Aria counts a sheet as
    // entered once its IntersectionObserver reports some of it on screen,
    // and the observer reports again only when all of it shows or none
    // does. A sheet that touches the edge is reported as intersecting with
    // none of it showing; at a partial detent it then never counts as
    // entered, and a swipe out of view leaves it open.
    if (goal > from && from < edge) from = Math.min(edge + 1, goal);
    const leaving = goal < from && goal < edge;
    // A leaving sheet stops a pixel past the edge, where React Aria's
    // IntersectionObserver sees none of it.
    const target = leaving ? Math.max(goal, Math.min(edge - 1, from)) : goal;
    // A detent can move while the sheet heads for it, when the sheet's
    // height changes. A leaving sheet heads for the screen's edge, which
    // stays where it is.
    const marker = leaving ? null : resting.marker;
    const targetNow = () =>
      marker?.isConnected
        ? target + snapPosition(scroller, marker) - goal
        : target;
    // Snapping would pull each frame's offset to a detent.
    scroller.style.scrollSnapType = "none";
    const distance = target - from;
    if (Math.abs(distance) < 0.5) {
      scroller.scrollTop = targetNow();
      run = { frame: 0, position: () => goal, velocity: () => 0, leaving };
      finish(true);
      return;
    }
    // Spring time is in seconds; its velocity is in distances per second.
    const velocity = speed / distance;
    const seconds = settleTime(moveSpring, distance, { velocity });
    const start = performance.now();
    const at = (t: number, end: number) =>
      end - distance * springDisplacement(moveSpring, t, velocity);
    const elapsed = () => Math.min((performance.now() - start) / 1000, seconds);
    const current: Run = {
      frame: 0,
      leaving,
      position: () => at(elapsed(), targetNow()),
      velocity: () => {
        const t = elapsed();
        const end = targetNow();
        return (at(t + 0.004, end) - at(t, end)) / 0.004;
      },
    };
    run = current;
    scroller.setAttribute("data-sheet-spring", "");
    scroller.scrollTop = from;
    const step = () => {
      if (run !== current) return;
      if (!scroller.isConnected) {
        run = null;
        return;
      }
      const t = elapsed();
      const end = targetNow();
      scroller.scrollTop = t >= seconds ? end : at(t, end);
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
    nextSprings.delete(scroller);
    finish(false);
    if (parked) restoreSnap();
    Reflect.apply(nativeScrollTo, this, args);
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
    scroller.removeAttribute("data-sheet-spring");
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
 * Keeps a resting sheet where it rests when the window turns or is resized,
 * as UIKit keeps a sheet's selected detent: on the same detent, or in full
 * view. Detents and full view move with the window's size, and the browser
 * would snap the sheet to whichever is nearest its old offset (WebKit does).
 * A sheet shorter than its detent rests at both, and keeps the one it had.
 * Returns a function that stops.
 */
export function holdRestOnResize(scroller: HTMLElement): () => void {
  let rest: HTMLElement | null = null;
  let frame = 0;
  const note = () => {
    if (scroller.hasAttribute("data-sheet-spring")) return;
    const top = scroller.scrollTop;
    const here = sheetSnaps(scroller).filter(
      (snap) =>
        (snap.full || snap.marker.hasAttribute("data-sheet-detent")) &&
        Math.abs(snap.position - top) < 1,
    );
    if (!here.length) rest = null;
    else if (!here.some((snap) => snap.marker === rest))
      rest = (here.find((snap) => !snap.full) ?? here[0]!).marker;
  };
  // After the frame's media query changes, which can move the sheet to
  // another layout first.
  const hold = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (!rest?.isConnected || scroller.hasAttribute("data-sheet-spring"))
        return;
      const position = snapPosition(scroller, rest);
      if (Math.abs(position - scroller.scrollTop) >= 1)
        scroller.scrollTop = position;
    });
  };
  scroller.addEventListener("scrollend", note);
  window.addEventListener("resize", hold);
  return () => {
    cancelAnimationFrame(frame);
    scroller.removeEventListener("scrollend", note);
    window.removeEventListener("resize", hold);
  };
}

/**
 * Moves a sheet that `springSheetScroller` drives to `top` on another
 * spring than its own, once: the keyboard's, when a field raises the sheet.
 */
export function springSheetTo(
  scroller: HTMLElement,
  top: number,
  spring: Spring,
): void {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    scroller.scrollTo({ top, behavior: "instant" });
    return;
  }
  nextSprings.set(scroller, spring);
  scroller.scrollTo({ top, behavior: "smooth" });
}

export type SheetSnap = {
  marker: HTMLElement;
  /** The scroll offset where the marker holds the sheet. */
  position: number;
  /** React Aria's marker for the sheet in full view. */
  full: boolean;
};

/**
 * The scroll offsets where a sheet can rest, and the markers that make
 * them: React Aria's exit and full-view markers are the scroller's
 * children, and its detents are `[data-sheet-detent]`.
 */
export function sheetSnaps(scroller: HTMLElement): SheetSnap[] {
  const snaps: SheetSnap[] = [];
  const markers = [
    ...scroller.children,
    ...scroller.querySelectorAll("[data-sheet-detent]"),
  ];
  for (const marker of markers) {
    if (!(marker instanceof HTMLElement)) continue;
    const align = marker.style.scrollSnapAlign.split(" ")[0];
    if (align !== "start" && align !== "end") continue;
    snaps.push({
      marker,
      position: snapPosition(scroller, marker),
      full: align === "end" && marker.parentElement === scroller,
    });
  }
  return snaps;
}

/** The scroll offset where `marker` holds the sheet, within the scroll range. */
export function snapPosition(
  scroller: HTMLElement,
  marker: HTMLElement,
): number {
  const max = scroller.scrollHeight - scroller.clientHeight;
  const box = scroller.getBoundingClientRect();
  const rect = marker.getBoundingClientRect();
  const style = getComputedStyle(marker);
  const align = marker.style.scrollSnapAlign.split(" ")[0];
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
  return Math.min(Math.max(position, 0), max);
}

/**
 * Where a smooth scroll to `top` comes to rest, and the marker that holds
 * it there, as the browser snaps at the end of a smooth scroll. On iOS
 * Safari the scroll range runs past full height, under the toolbar, so the
 * end of the range is not a rest.
 */
function snapTarget(
  scroller: HTMLElement,
  top: number,
): { position: number; marker: HTMLElement | null } {
  const max = scroller.scrollHeight - scroller.clientHeight;
  let best: { position: number; marker: HTMLElement | null } = {
    position: Math.min(Math.max(top, 0), max),
    marker: null,
  };
  let bestDistance = Infinity;
  for (const snap of sheetSnaps(scroller)) {
    const distance = Math.abs(snap.position - top);
    if (distance < bestDistance) {
      best = snap;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Whether any of a sheet shows on screen. A sheet that leaves on the spring
 * rests a pixel past the bottom of the screen, not at the start of its
 * scroll range: it is out of view there.
 */
export function sheetInView(scroller: HTMLElement): boolean {
  const sheet = scroller.querySelector("[data-sheet-content]");
  return sheet !== null && sheet.getBoundingClientRect().top < screenBottom();
}

/** The bottom of what can show: on iOS Safari the page runs on under the
 * toolbar, to the large viewport's height. */
function screenBottom(): number {
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;top:0;height:100lvh;width:0;visibility:hidden;pointer-events:none";
  document.body.appendChild(probe);
  const large = probe.offsetHeight;
  probe.remove();
  return Math.max(innerHeight, large);
}
