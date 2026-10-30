import { getRuntimeStorage } from "@/features/sync-lab/runtime";
import { useSyncExternalStore } from "react";

export type PagesPreference = "auto" | "one" | "two";

export const PAGES_STORAGE_KEY = "reader-pages-v1";

function isPagesPreference(value: string | null): value is PagesPreference {
  return value === "auto" || value === "one" || value === "two";
}

/**
 * Appearance → Layout → Pages: Auto shows two pages where they fit (a
 * landscape tablet, a wide desktop window), One and Two choose. One choice
 * for every book on this device, like the reading view.
 */
function readSaved(): PagesPreference {
  try {
    const value = getRuntimeStorage().getItem(PAGES_STORAGE_KEY);
    return isPagesPreference(value) ? value : "auto";
  } catch {
    return "auto";
  }
}

let saved = readSaved();
const listeners = new Set<() => void>();

export function setPagesPreference(next: PagesPreference): void {
  try {
    getRuntimeStorage().setItem(PAGES_STORAGE_KEY, next);
  } catch {
    // Keep the in-memory choice when storage is unavailable.
  }
  if (next === saved) return;
  saved = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePagesPreference(): PagesPreference {
  return useSyncExternalStore(
    subscribe,
    () => saved,
    () => saved,
  );
}
