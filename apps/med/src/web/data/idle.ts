/** Runs once the page is idle, or after two seconds. Returns a cancel. */
export function whenIdle(run: () => void) {
  if (!("requestIdleCallback" in globalThis)) {
    const timer = setTimeout(run, 300);
    return () => clearTimeout(timer);
  }
  const id = requestIdleCallback(run, { timeout: 2000 });
  return () => cancelIdleCallback(id);
}
