import { useSyncExternalStore } from "react";

/**
 * How much chrome surrounds the code. "quiet" gives each pane one row and
 * says each thing once: the thread's title in the sidebar (or the title band
 * while the sidebar is hidden), its branch in the title band, the range in
 * the review's row, and the agent's state in the session's row. Rare actions
 * go to the review's ⋯ menu and ⌘K, and the status bar goes. "full" is the
 * layout before. Every window and workspace shares the choice.
 */
export type ChromeMode = "quiet" | "full";

const KEY = "med:chrome:v1";
const listeners = new Set<() => void>();
const read = (): ChromeMode => {
  try {
    return localStorage.getItem(KEY) === "full" ? "full" : "quiet";
  } catch {
    return "quiet";
  }
};
let mode = read();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== KEY && event.key !== null) return;
    mode = read();
    listener();
  };
  addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    removeEventListener("storage", onStorage);
  };
};

/** Uses a chrome, and stores the choice for other windows and the next visit.
 * Without `store`, the choice holds for this page only. */
export function setChromeMode(next: ChromeMode, store = true) {
  mode = next;
  if (store)
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* The choice lasts for this page. */
    }
  for (const listener of listeners) listener();
}

/** Whether the quiet chrome shows. */
export function useQuietChrome() {
  return useSyncExternalStore(
    subscribe,
    () => mode === "quiet",
    () => true,
  );
}
