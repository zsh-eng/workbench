// Tells the settings file what the reader chose: each setting that the page
// stores calls `noteStored`, and the file's sync (settings-file.ts) writes
// it. A module of its own, so the stores need no part of the sync.

type Listener = (key: string, value: string) => void;
const listeners = new Set<Listener>();

/** A setting that the page stored under its localStorage key. */
export function noteStored(key: string, value: string) {
  for (const listener of listeners) listener(key, value);
}

export function onStored(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
