import type { ActivityTracker } from "./tracker";

export interface InteractionHandlers {
  /** A deliberate input: a press, mouse movement, touch, key or wheel, or a scroll just after one. */
  input(at: number): void;
  /** The page was hidden, frozen or cached, or the window lost focus. */
  pause(at: number): void;
  /** The page is visible again, or the window has focus again. */
  resume(at: number): void;
  /** The page is unloading for good. Without it, `pause` handles this too. */
  exit?(at: number): void;
}

export interface InteractionOptions {
  /** The window to observe. Defaults to the global one. */
  target?: Window;
  /** Unix milliseconds. Defaults to `Date.now`. */
  now?: () => number;
  /** Whether losing window focus pauses. Defaults to true; input resumes. */
  pauseOnBlur?: boolean;
  /** How long after an input a scroll still counts. Defaults to one second. */
  scrollAfterInputMs?: number;
}

/** Inputs that only a person makes. `mousemove` is not sent for touch moves. */
const INPUTS = [
  "pointerdown",
  "mousemove",
  "touchstart",
  "touchmove",
  "keydown",
  "wheel",
] as const;

const LISTEN = { capture: true, passive: true } as const;

/**
 * Reports a page's interaction signals; returns a function that stops.
 *
 * Inputs count only while the page is visible and only when the browser made
 * them (`isTrusted`). A scroll event is trusted even when code scrolled the
 * page, as when a reader restores its position, so a scroll counts only
 * within `scrollAfterInputMs` of a real input. Listeners use the capture
 * phase, so a handler that stops propagation cannot hide an input.
 *
 * A page that is hidden when observation starts reports a pause at once.
 */
export function observeInteraction(
  handlers: InteractionHandlers,
  options: InteractionOptions = {},
): () => void {
  const win = options.target ?? window;
  const doc = win.document;
  const now = options.now ?? (() => Date.now());
  const pauseOnBlur = options.pauseOnBlur ?? true;
  const scrollAfterInputMs = options.scrollAfterInputMs ?? 1000;
  const exit = handlers.exit ?? handlers.pause;
  let lastInput = -Infinity;

  const visible = () => doc.visibilityState === "visible";
  const trusted = (event: Event) => event.isTrusted !== false && visible();

  const onInput = (event: Event) => {
    if (!trusted(event)) return;
    lastInput = now();
    handlers.input(lastInput);
  };
  const onScroll = (event: Event) => {
    if (!trusted(event)) return;
    const at = now();
    if (at < lastInput || at - lastInput > scrollAfterInputMs) return;
    handlers.input(at);
  };
  const onVisibility = () => {
    if (visible()) handlers.resume(now());
    else handlers.pause(now());
  };
  // Focus that moves into a frame of this page keeps `hasFocus()` true.
  const onBlur = (event: Event) => {
    if (event.target !== win || doc.hasFocus()) return;
    handlers.pause(now());
  };
  const onFocus = (event: Event) => {
    if (event.target !== win || !visible()) return;
    handlers.resume(now());
  };
  // A page kept in the back/forward cache can return; others are gone.
  const onPageHide = (event: Event) => {
    if ((event as PageTransitionEvent).persisted) handlers.pause(now());
    else exit(now());
  };
  const onPageShow = (event: Event) => {
    if ((event as PageTransitionEvent).persisted && visible()) {
      handlers.resume(now());
    }
  };
  const onFreeze = () => handlers.pause(now());

  for (const type of INPUTS) win.addEventListener(type, onInput, LISTEN);
  win.addEventListener("scroll", onScroll, LISTEN);
  doc.addEventListener("visibilitychange", onVisibility);
  doc.addEventListener("freeze", onFreeze);
  if (pauseOnBlur) win.addEventListener("blur", onBlur);
  win.addEventListener("focus", onFocus);
  win.addEventListener("pagehide", onPageHide);
  win.addEventListener("pageshow", onPageShow);
  if (!visible()) handlers.pause(now());

  return () => {
    for (const type of INPUTS) win.removeEventListener(type, onInput, LISTEN);
    win.removeEventListener("scroll", onScroll, LISTEN);
    doc.removeEventListener("visibilitychange", onVisibility);
    doc.removeEventListener("freeze", onFreeze);
    win.removeEventListener("blur", onBlur);
    win.removeEventListener("focus", onFocus);
    win.removeEventListener("pagehide", onPageHide);
    win.removeEventListener("pageshow", onPageShow);
  };
}

/**
 * Feeds a page's signals to a tracker and saves its changes every checkpoint
 * interval. Unloading the page ends the session; returns a function that
 * disconnects without ending it.
 */
export function connectTracker<P>(
  tracker: ActivityTracker<P>,
  options: Omit<InteractionOptions, "now"> = {},
): () => void {
  const stop = observeInteraction(
    {
      input: (at) => tracker.input(at),
      pause: (at) => tracker.pause(at),
      resume: (at) => tracker.resume(at),
      exit: (at) => {
        tracker.end(at);
      },
    },
    { ...options, now: tracker.now },
  );
  // The timer saves counted time; it never counts time itself.
  const timer = setInterval(() => tracker.flush(), tracker.checkpointMs);
  return () => {
    clearInterval(timer);
    stop();
  };
}
