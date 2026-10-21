import { useSyncExternalStore } from "react";
import type { Article } from "./articles";
import { getSettings } from "./settings";
import type { Session } from "./sync/session";

/**
 * Keeps saved articles' text in this browser for offline reading. Opened
 * articles are kept anyway; this downloads the rest, four at a time.
 */
export type Offline = {
  running: boolean;
  /** Texts of saved articles: kept here, and in all. */
  kept: number;
  total: number;
  failed: number;
  bytes: number;
};

let state: Offline = { running: false, kept: 0, total: 0, failed: 0, bytes: 0 };
let stop: AbortController | undefined;
const listeners = new Set<() => void>();
const set = (next: Partial<Offline>) => {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
};

export function useOffline() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}

/** Counts what this browser keeps of the saved articles' text. */
export async function countKept(session: Session, articles: Article[]) {
  const kept = await session.keptFiles();
  const files = savedFiles(articles);
  set({
    kept: files.filter((file) => kept.has(file.id)).length,
    total: files.length,
    bytes: files.reduce(
      (sum, file) => sum + (kept.has(file.id) ? file.bytes : 0),
      0,
    ),
  });
  return { kept, files };
}

export async function downloadAll(session: Session, articles: Article[]) {
  if (state.running) return;
  stop = new AbortController();
  const signal = stop.signal;
  set({ running: true, failed: 0 });
  // Ask the browser not to clear the text when space runs low.
  void navigator.storage?.persist?.().catch(() => false);
  try {
    const { kept, files } = await countKept(session, articles);
    const queue = files.filter((file) => !kept.has(file.id));
    const worker = async () => {
      for (let file = queue.shift(); file; file = queue.shift()) {
        if (signal.aborted) return;
        try {
          await session.keepFile(file.id, signal);
          set({ kept: state.kept + 1, bytes: state.bytes + file.bytes });
        } catch {
          if (!signal.aborted) set({ failed: state.failed + 1 });
        }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
  } finally {
    set({ running: false });
  }
}

export function stopDownload() {
  stop?.abort();
}

/** After a sync, new text downloads when the setting is on. */
export function downloadNew(session: Session, articles: Article[]) {
  if (getSettings().offline && navigator.onLine)
    void downloadAll(session, articles);
}

function savedFiles(articles: Article[]) {
  const files = new Map<string, number>();
  for (const article of articles)
    if (article.saved && article.copy)
      files.set(article.copy.file, article.copy.bytes);
  return [...files].map(([id, bytes]) => ({ id, bytes }));
}
