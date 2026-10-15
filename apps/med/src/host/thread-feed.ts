import type { ThreadList } from "../shared/threads";

/**
 * One thread list for every window. The host reads it once for all of them:
 * soon after a change that it hears of, such as a tab that closes or a
 * checkout's new work, and every `intervalMs` while a window listens, for
 * agents whose transcripts change outside Med. That read checks file times
 * only; Git work runs in the background (checkout-work.ts). A window gets the
 * list when it opens, then each list that differs.
 */
export function createThreadFeed(options: {
  list: () => Promise<ThreadList>;
  intervalMs: number;
  /** How long a burst of changes waits, so that it gives one read. */
  delayMs?: number;
}) {
  type Listener = (text: string) => void;
  const listeners = new Set<Listener>();
  // Windows that opened since the last read; they get its list even if it is the same.
  const fresh = new Set<Listener>();
  let last: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let due = Infinity;
  let running = false;
  let again = false;
  let closed = false;

  /** Reads at `ms` from now, or at the time already set if that is sooner. */
  const schedule = (ms: number) => {
    if (closed || !listeners.size) return;
    const at = Date.now() + ms;
    if (timer && at >= due) return;
    clearTimeout(timer);
    due = at;
    timer = setTimeout(() => void run(), ms);
  };
  const run = async () => {
    clearTimeout(timer);
    timer = undefined;
    due = Infinity;
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        const text = JSON.stringify(await options.list());
        const changed = text !== last;
        last = text;
        for (const listener of listeners) if (changed || fresh.has(listener)) listener(text);
        fresh.clear();
      } while (again && listeners.size && !closed);
    } catch {
      /* The next change or interval reads again. */
    } finally {
      running = false;
      schedule(options.intervalMs);
    }
  };

  return {
    /** Adds a window's stream; it gets a list that is read now. */
    add(listener: Listener) {
      listeners.add(listener);
      fresh.add(listener);
      if (running) again = true;
      else schedule(0);
      return () => {
        listeners.delete(listener);
        fresh.delete(listener);
        if (!listeners.size) {
          clearTimeout(timer);
          timer = undefined;
          due = Infinity;
        }
      };
    },
    /** Something that the list shows changed: read again soon. */
    changed() {
      if (running) again = true;
      else schedule(options.delayMs ?? 50);
    },
    close() {
      closed = true;
      clearTimeout(timer);
      listeners.clear();
      fresh.clear();
    },
  };
}
