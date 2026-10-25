import { sheetSnaps, snapPosition, type SheetSnap } from "./sheet-motion";
import { SPRINGS, settleTime, springDisplacement, type Spring } from "./spring";

/**
 * How a sheet that fits its content follows the content's height
 * (docs/MOTION.md, "Sheet behaviour").
 *
 * - `rest`: the sheet's height is the content's.
 * - `held`: the content shrank over several frames, as rows that collapse
 *   do. The sheet keeps its height and the freed space shows at
 *   `[data-sheet-slack]`, until the content is still and no finger is on
 *   the sheet.
 * - `settling`: the sheet moves to the content's height on the sheet spring.
 */
export type SheetFitState = "rest" | "held" | "settling";

export interface SheetFitOptions {
  /** Holds the sheet's height: this writes its `style.height`. */
  fit: HTMLElement;
  /**
   * The content inside `fit`: a flex column at least as tall as `fit`. Free
   * space goes to its `[data-sheet-slack]` elements, which grow; their
   * height is not part of the content's.
   */
  content: HTMLElement;
  /** React Aria's sheet scroller, `[data-sheet-scroll]`. */
  scroller: HTMLElement;
  /** The spring for height changes. UIKit's sheet spring by default. */
  spring?: Spring;
  /** Milliseconds the content must hold still before a held sheet settles. */
  quiet?: number;
  /** Called when the state changes, for readouts and tests. */
  onState?: (state: SheetFitState, detail: SheetFitDetail) => void;
}

export interface SheetFitDetail {
  /** The height the sheet has now. */
  height: number;
  /** The content's own height: where the sheet settles. */
  content: number;
}

/**
 * Keeps a sheet's height in step with its content without chasing every
 * frame of the content's own animations, as UIKit's sheets do: a sheet
 * changes height when its detents are resolved again, once, on the sheet
 * spring.
 *
 * - A change within one frame (a tab, a filter) moves the sheet at once.
 * - Growth over several frames is followed on the spring.
 * - Shrinking over several frames is held until the content has been still
 *   for `quiet` milliseconds and no finger is on the sheet; then the sheet
 *   settles once. Rows removed one after another move the sheet once.
 * - At a partial detent the sheet re-snaps in the same frame as each height
 *   change, so a fixed detent keeps its top edge. In full view the top edge
 *   moves with the height.
 * - Nothing moves under a finger on the sheet. A height change waits until
 *   it lifts and the scroll it started has ended.
 *
 * With reduced motion each change applies at once, after the same waits.
 * Returns a function that stops it.
 */
export function fitSheetHeight({
  fit,
  content,
  scroller,
  spring = SPRINGS.sheet,
  quiet = 250,
  onState,
}: SheetFitOptions): () => void {
  let height = natural();
  let state: SheetFitState = "rest";
  let run: {
    frame: number;
    from: number;
    to: number;
    start: number;
    velocity: number;
    seconds: number;
    snap: SheetSnap | null;
  } | null = null;
  /** When the content's size last changed, and how often since it rested. */
  let lastChange = 0;
  let burst = 0;
  let lastNatural = height;
  let timer = 0;
  let fingers = 0;
  const pointers = new Set<number>();
  let lastUserScroll = 0;
  let ownScroll = false;

  write(height);
  setState("rest");

  /** The content's own height, without the space a held height frees. */
  function natural(): number {
    let slack = 0;
    for (const element of content.querySelectorAll<HTMLElement>(
      "[data-sheet-slack]",
    ))
      slack += element.offsetHeight;
    return content.offsetHeight - slack;
  }

  function write(next: number) {
    height = next;
    fit.style.height = `${next}px`;
  }

  function setState(next: SheetFitState) {
    if (next !== state || fit.dataset.sheetFitState !== next) {
      state = next;
      fit.dataset.sheetFitState = next;
    }
    onState?.(state, { height, content: lastNatural });
  }

  function reduceMotion() {
    return matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  /** A finger, a mouse button or a scroll the person started is on the sheet. */
  function busy() {
    return (
      fingers > 0 ||
      pointers.size > 0 ||
      performance.now() - lastUserScroll < 120
    );
  }

  /** The partial detent the sheet rests on, if any. In full view, none. */
  function restingSnap(): SheetSnap | null {
    const top = scroller.scrollTop;
    let best: SheetSnap | null = null;
    for (const snap of sheetSnaps(scroller)) {
      if (Math.abs(snap.position - top) > 1) continue;
      // A detent that coincides with full view counts as the detent: the
      // sheet stays there if the content grows past it again.
      if (!best || best.full) best = snap;
    }
    return best && !best.full ? best : null;
  }

  /** Puts the sheet back on its detent after its height changed. */
  function keepSnap(snap: SheetSnap | null) {
    if (!snap || !snap.marker.isConnected) return;
    if (scroller.hasAttribute("data-sheet-spring")) return;
    const position = snapPosition(scroller, snap.marker);
    if (Math.abs(position - scroller.scrollTop) < 0.5) return;
    ownScroll = true;
    scroller.scrollTop = position;
  }

  function schedule(ms: number) {
    window.clearTimeout(timer);
    timer = window.setTimeout(check, ms);
  }

  /** Moves the sheet's height to `to` on the spring, from where it is now. */
  function move(to: number) {
    if (reduceMotion()) {
      const snap = restingSnap();
      if (run) cancelAnimationFrame(run.frame);
      run = null;
      write(to);
      keepSnap(snap);
      setState("rest");
      return;
    }
    const now = performance.now();
    let from = height;
    let speed = 0;
    let snap = restingSnap();
    if (run) {
      const t = Math.min((now - run.start) / 1000, run.seconds);
      const distance = run.to - run.from;
      const at = (s: number) =>
        run!.to - distance * springDisplacement(spring, s, run!.velocity);
      from = at(t);
      speed = (at(t + 0.004) - at(t)) / 0.004;
      snap = run.snap;
      cancelAnimationFrame(run.frame);
    }
    const distance = to - from;
    if (Math.abs(distance) < 0.5) {
      run = null;
      write(to);
      keepSnap(snap);
      setState("rest");
      return;
    }
    const velocity = speed / distance;
    const current = {
      frame: 0,
      from,
      to,
      start: now,
      velocity,
      seconds: settleTime(spring, distance, { velocity }),
      snap,
    };
    run = current;
    setState("settling");
    const step = () => {
      if (run !== current) return;
      if (!fit.isConnected) {
        run = null;
        return;
      }
      const t = Math.min(
        (performance.now() - current.start) / 1000,
        current.seconds,
      );
      const done = t >= current.seconds;
      write(
        done
          ? current.to
          : current.to -
              distance * springDisplacement(spring, t, current.velocity),
      );
      keepSnap(current.snap);
      if (!done) {
        current.frame = requestAnimationFrame(step);
        return;
      }
      run = null;
      check();
    };
    current.frame = requestAnimationFrame(step);
  }

  /** Decides what the sheet's height does now. */
  function check() {
    window.clearTimeout(timer);
    const next = natural();
    lastNatural = next;
    if (run) {
      // Growth during a settle retargets it. Shrinking waits for the end.
      if (next > run.to + 0.5) move(next);
      return;
    }
    if (Math.abs(next - height) < 0.5) {
      burst = 0;
      if (state !== "rest") setState("rest");
      return;
    }
    if (busy()) {
      if (next < height) setState("held");
      // Lifting the finger or the end of the scroll checks again.
      schedule(150);
      return;
    }
    if (next > height) {
      burst = 0;
      move(next);
      return;
    }
    // Shrinking: a change in one frame settles after two more frames, which
    // tell it from an animation. An animation settles once it is still.
    const now = performance.now();
    const wait = burst > 1 ? quiet : 40;
    if (now - lastChange < wait) {
      setState("held");
      schedule(wait - (now - lastChange) + 1);
      return;
    }
    burst = 0;
    move(next);
  }

  const resize = new ResizeObserver(() => {
    const next = natural();
    if (Math.abs(next - lastNatural) < 0.5) return;
    lastNatural = next;
    lastChange = performance.now();
    burst = state === "rest" && !run ? 1 : burst + 1;
    // Newly mounted slack elements report their own sizes too.
    for (const element of content.querySelectorAll("[data-sheet-slack]"))
      resize.observe(element);
    check();
  });
  resize.observe(content);
  for (const element of content.querySelectorAll("[data-sheet-slack]"))
    resize.observe(element);

  const onTouch = (event: TouchEvent) => {
    fingers = event.touches.length;
    if (!fingers) schedule(150);
  };
  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType === "touch") return;
    pointers.add(event.pointerId);
  };
  const onPointerUp = (event: PointerEvent) => {
    if (!pointers.delete(event.pointerId)) return;
    schedule(150);
  };
  // The fit box clips, and so the browser can scroll it to show a focused
  // or clipped element. It never scrolls: the sheet moves instead.
  const onFitScroll = () => {
    if (fit.scrollTop || fit.scrollLeft) fit.scrollTo(0, 0);
  };
  const onScroll = () => {
    if (ownScroll) {
      ownScroll = false;
      return;
    }
    if (!scroller.hasAttribute("data-sheet-spring"))
      lastUserScroll = performance.now();
  };
  scroller.addEventListener("touchstart", onTouch, { passive: true });
  scroller.addEventListener("touchend", onTouch, { passive: true });
  scroller.addEventListener("touchcancel", onTouch, { passive: true });
  scroller.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener("pointerup", onPointerUp, true);
  window.addEventListener("pointercancel", onPointerUp, true);
  scroller.addEventListener("scroll", onScroll, { passive: true });
  fit.addEventListener("scroll", onFitScroll, { passive: true });

  return () => {
    resize.disconnect();
    window.clearTimeout(timer);
    if (run) cancelAnimationFrame(run.frame);
    run = null;
    scroller.removeEventListener("touchstart", onTouch);
    scroller.removeEventListener("touchend", onTouch);
    scroller.removeEventListener("touchcancel", onTouch);
    scroller.removeEventListener("pointerdown", onPointerDown, true);
    window.removeEventListener("pointerup", onPointerUp, true);
    window.removeEventListener("pointercancel", onPointerUp, true);
    scroller.removeEventListener("scroll", onScroll);
    fit.removeEventListener("scroll", onFitScroll);
  };
}

/**
 * Tells a sheet's CSS where it floats and where it meets the screen's
 * edges (docs/MOTION.md, "Sheet behaviour"). Below full height an iOS sheet
 * floats, inset from the sides and the bottom; at the large detent it is
 * edge to edge. Between its highest detent and the large detent the inset
 * follows the sheet's position.
 *
 * Only a sheet as tall as it can be (its `max-height`) reaches the large
 * detent; a shorter one floats in full view too. This sets, on the
 * overlay:
 *
 * - `data-sheet-shape`: `float` (never meets the edges), `attach` (meets
 *   them in full view, by scroll position), or `attached` (always, a sheet
 *   that is always large).
 * - `--wb-sheet-attach-start` and `--wb-sheet-attach-end`: the scroll
 *   offsets of the highest detent and of full view, for the scroll-driven
 *   animation in `sheet.css`.
 *
 * Returns a function that stops it.
 */
export function trackSheetShape(
  overlay: HTMLElement,
  scroller: HTMLElement,
  sheet: HTMLElement,
): () => void {
  let frame = 0;
  const update = () => {
    frame = 0;
    const surface =
      sheet.querySelector<HTMLElement>("[data-sheet-content]") ?? sheet;
    const max = parseFloat(getComputedStyle(sheet).maxHeight);
    const tall = Number.isFinite(max) && surface.offsetHeight >= max - 1;
    if (!tall) {
      overlay.dataset.sheetShape = "float";
      return;
    }
    const snaps = sheetSnaps(scroller);
    const full = snaps.find((snap) => snap.full);
    const detents = snaps.filter(
      (snap) =>
        snap.marker.hasAttribute("data-sheet-detent") &&
        full &&
        snap.position < full.position - 1,
    );
    if (!full || !detents.length) {
      overlay.dataset.sheetShape = "attached";
      return;
    }
    const highest = Math.max(...detents.map((snap) => snap.position));
    overlay.dataset.sheetShape = "attach";
    overlay.style.setProperty("--wb-sheet-attach-start", `${highest}px`);
    overlay.style.setProperty("--wb-sheet-attach-end", `${full.position}px`);
  };
  const request = () => {
    if (!frame) frame = requestAnimationFrame(update);
  };
  update();
  const resize = new ResizeObserver(request);
  resize.observe(sheet);
  window.addEventListener("resize", request);
  return () => {
    cancelAnimationFrame(frame);
    resize.disconnect();
    window.removeEventListener("resize", request);
  };
}
