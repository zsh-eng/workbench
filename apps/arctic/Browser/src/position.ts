import { useSyncExternalStore } from "react";

/**
 * Where the reader left each article in this browser, as a share of its
 * height (0–1). The reader returns there; the Magazine layout draws it
 * under the picture. It stays in this browser and does not sync.
 */
const key = (id: string) => `arctic:position:${id}`;
const listeners = new Set<() => void>();

export function readPosition(id: string) {
  try {
    const value = Number(localStorage.getItem(key(id)));
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

export function savePosition(id: string, value: number) {
  try {
    localStorage.setItem(key(id), String(Math.round(value * 1000) / 1000));
  } catch {
    /* Storage is full or blocked; position is a convenience. */
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The article's position, or 0 when it is unread or finished: the reader
 * returns to a position between these too.
 */
export function useProgress(id: string) {
  const position = useSyncExternalStore(subscribe, () => readPosition(id));
  return position > 0.02 && position < 0.98 ? position : 0;
}
