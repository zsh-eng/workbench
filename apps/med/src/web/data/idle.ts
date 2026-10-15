/** Runs once the page is idle, or after two seconds. Returns a cancel. */
export function whenIdle(run: () => void) {
  if (!("requestIdleCallback" in globalThis)) {
    const timer = setTimeout(run, 300);
    return () => clearTimeout(timer);
  }
  const id = requestIdleCallback(run, { timeout: 2000 });
  return () => cancelIdleCallback(id);
}

/** How long after a key or a press the reader counts as still acting. */
export const QUIET_MS = 1000;

/** The last key or press, in performance.now() time. */
let lastInput = -Infinity;
const inputListeners = new Set<() => void>();
if (typeof window !== "undefined") {
  const note = () => {
    lastInput = performance.now();
    for (const listener of inputListeners) listener();
  };
  window.addEventListener("keydown", note, { capture: true, passive: true });
  window.addEventListener("pointerdown", note, { capture: true, passive: true });
}

/** Calls `listener` on each key or press. Returns a stop. */
export function onInput(listener: () => void) {
  inputListeners.add(listener);
  return () => void inputListeners.delete(listener);
}

/**
 * Runs `run` when the reader does not act: QUIET_MS after the last key or
 * press, while `busy` is false, and once the page is idle. Work that can wait,
 * such as loading tabs ahead, then never competes with a key. Returns a
 * cancel.
 */
export function whenFree(run: () => void, busy?: () => boolean) {
  let cancel = () => {};
  let ended = false;
  const wait = () => {
    const left = lastInput + QUIET_MS - performance.now();
    if (left > 0 || busy?.()) {
      const timer = setTimeout(wait, Math.max(left, 100));
      cancel = () => clearTimeout(timer);
      return;
    }
    cancel = whenIdle(() => {
      if (ended) return;
      if (performance.now() - lastInput < QUIET_MS || busy?.()) return wait();
      ended = true;
      run();
    });
  };
  wait();
  return () => {
    ended = true;
    cancel();
  };
}
