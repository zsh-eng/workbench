// The page's streams from Med's host connect again soon after they end. The
// host is local, so an attempt costs little, and after an update or a restart
// it is back within a second or two. A wait also ends at once when the
// network comes back or the window shows again.

const FIRST_MS = 250;
/** The longest wait between two attempts. */
const MOST_MS = 3000;

const waiting = new Set<() => void>();
/** Ends every wait now, so each stream tries again. */
export function reconnectNow() {
  for (const done of [...waiting]) done();
}
if (typeof window !== "undefined" && typeof document !== "undefined") {
  window.addEventListener("online", reconnectNow);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") reconnectNow();
  });
}

/** The wait before attempt `attempt + 1`: 250 ms, then twice as long each
 * time, up to 3 s. It ends early on `signal`, or when `reconnectNow` runs. */
export function reconnectPause(attempt: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      waiting.delete(done);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, Math.min(FIRST_MS * 2 ** attempt, MOST_MS));
    waiting.add(done);
    signal.addEventListener("abort", done, { once: true });
  });
}
