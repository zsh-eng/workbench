import { getRuntimeStorage } from "@/features/sync-lab/runtime";
import { useSyncExternalStore } from "react";

export const DETENT_SHEETS_STORAGE_KEY = "reader-detent-sheets-v1";

/**
 * The phone Reader's sheets rest on React Aria's detents. On unless turned
 * off in Debug mode, which brings back the fixed-height sheets.
 */
function readDetentSheets(): boolean {
  try {
    return getRuntimeStorage().getItem(DETENT_SHEETS_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

let enabled = readDetentSheets();
const listeners = new Set<() => void>();

function publish(next: boolean): void {
  if (next === enabled) return;
  enabled = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === DETENT_SHEETS_STORAGE_KEY || event.key === null)
      publish(readDetentSheets());
  };
  window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function setDetentSheetsEnabled(next: boolean): void {
  try {
    getRuntimeStorage().setItem(DETENT_SHEETS_STORAGE_KEY, String(next));
  } catch {
    // Keep the in-memory choice when storage is unavailable.
  }
  publish(next);
}

export function useDetentSheetsEnabled(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => enabled,
    () => enabled,
  );
}
