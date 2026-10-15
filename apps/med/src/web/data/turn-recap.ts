import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { Thread } from "../../shared/threads";

// The turn recap (components/session/TurnRecap.tsx): when a thread's turn
// ends and the reader did not see it end, the session thread ends with the
// turn's facts and a way into the review.
//
// A turn counts as seen when the reader watched it end (the thread's session
// on screen, in a window that shows), pressed Review, or hid the recap. This
// browser keeps, by thread, the end of the last turn seen. Turns that ended
// before the first visit with the recap count as seen, so old work does not
// show a recap. Seen is the recap's own state: the tab's unread mark and
// "Needs you" keep their rules (data/tabs.ts, data/threads.ts).

const SEEN_KEY = "med:recap-seen";
const SINCE_KEY = "med:recap-seen-since";
/** The threads that the browser keeps a mark for, the newest marks first. */
const KEEP = 200;

interface Marks {
  since: number;
  /** The end of the last turn seen, by thread. */
  threads: Readonly<Record<string, number>>;
  /** Threads that work while the reader sees their session, in this window. */
  watched: ReadonlySet<string>;
}

let marks: Marks | null = null;
const listeners = new Set<() => void>();
const publish = (next: Marks) => {
  marks = next;
  for (const listener of listeners) listener();
};

function read(): Marks {
  if (marks) return marks;
  let since = 0;
  let threads: Record<string, number> = {};
  try {
    since = Number(localStorage.getItem(SINCE_KEY)) || 0;
    threads = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "{}") as Record<string, number>;
  } catch {
    /* Storage can be unavailable; the marks last for this page. */
  }
  if (!since) {
    since = Date.now();
    try {
      localStorage.setItem(SINCE_KEY, String(since));
    } catch {
      /* As above. */
    }
  }
  marks = { since, threads, watched: new Set() };
  return marks;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Another window's mark hides the recap here too.
  const storage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== SEEN_KEY && event.key !== SINCE_KEY) return;
    const { watched } = read();
    marks = null;
    publish({ ...read(), watched });
  };
  window.addEventListener("storage", storage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", storage);
  };
}

/** Marks a thread's turn, by its end, as seen. */
function see(threadId: string, endedAt: number) {
  const current = read();
  if ((current.threads[threadId] ?? 0) >= endedAt) return;
  const threads = Object.fromEntries(
    Object.entries({ ...current.threads, [threadId]: endedAt })
      .sort((a, b) => b[1] - a[1])
      .slice(0, KEEP),
  );
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(threads));
  } catch {
    /* As above. */
  }
  publish({ ...current, threads });
}

/** Whether the reader sees a working thread's session now. */
function watch(threadId: string, value: boolean) {
  const current = read();
  if (current.watched.has(threadId) === value) return;
  const watched = new Set(current.watched);
  if (value) watched.add(threadId);
  else watched.delete(threadId);
  publish({ ...current, watched });
}

/**
 * The recap state of a thread's last turn. `endedAt` is the end of a turn
 * that ended and no other started; `unseen` says that its recap shows.
 * `watching` tells whether the reader can see the thread's session, apart
 * from whether the window shows, which this reads itself.
 */
export function useTurnRecap(thread: Thread | undefined, watching: () => boolean) {
  const current = useSyncExternalStore(subscribe, read, read);
  const id = thread?.id;
  const working = thread?.state === "working";
  const endedAt = !working ? thread?.turn?.endedAt : undefined;
  // A turn that ends while the reader watches is seen from its first view.
  const watched = id !== undefined && current.watched.has(id);
  const unseen =
    id !== undefined &&
    endedAt !== undefined &&
    !watched &&
    endedAt > (current.threads[id] ?? current.since);

  // While the turn works: does the reader see its session, in a window that shows?
  useEffect(() => {
    if (id === undefined || !working) return;
    const update = () => watch(id, watching() && document.visibilityState === "visible");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, [id, working, watching]);
  // A workspace that hides, or a thread that leaves, is not watched.
  useEffect(() => {
    if (id === undefined) return;
    return () => watch(id, false);
  }, [id]);
  // The turn ended while watched: it is seen.
  useEffect(() => {
    if (id === undefined || endedAt === undefined || !watched) return;
    see(id, endedAt);
    watch(id, false);
  }, [id, endedAt, watched]);

  const seeTurn = useCallback(() => {
    if (id !== undefined && endedAt !== undefined) see(id, endedAt);
  }, [id, endedAt]);
  return { endedAt, unseen, see: seeTurn };
}
