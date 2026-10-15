import { useSyncExternalStore } from "react";

/** One path that a few views share without rendering their parents again,
 * such as the file row under the pointer, for the status bar. */
export function createPathValue() {
  let value: string | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: string | null) {
      if (next === value) return;
      value = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
export type PathValue = ReturnType<typeof createPathValue>;

/** The file row under the pointer, in any list of files. A window shows one
 * pointer, so one value serves its workspaces. */
export const hoveredPath = createPathValue();

export function usePathValue(value: PathValue) {
  return useSyncExternalStore(value.subscribe, value.get, () => null);
}
