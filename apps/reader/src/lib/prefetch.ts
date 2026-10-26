/**
 * Runs `callback` once the page is idle, and within two seconds at the latest.
 * Safari has no `requestIdleCallback`; there a short timer stands in. Returns
 * a cancel.
 */
export function whenIdle(callback: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(callback, { timeout: 2000 });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(callback, 250);
  return () => window.clearTimeout(id);
}

/**
 * Code that loads once: when it is first needed, or earlier, in the
 * background, so that moment downloads and parses nothing. Every caller
 * shares the one load. A failed load is forgotten, so a later call, such as
 * the route that needs the code, tries again.
 */
export function preloadable<T>(load: () => Promise<T>): () => Promise<T> {
  let loading: Promise<T> | null = null;
  return () => {
    loading ??= load().catch((error: unknown) => {
      loading = null;
      throw error;
    });
    return loading;
  };
}
