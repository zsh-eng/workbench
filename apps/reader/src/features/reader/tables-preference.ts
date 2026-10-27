import { getRuntimeStorage } from "@/features/sync-lab/runtime";
import { getDebugEnabled } from "@/lib/debug-preference";
import { useSyncExternalStore } from "react";

export const TABLES_STORAGE_KEY = "reader-tables-v1";

/**
 * Real tables in the Reader, a prototype (docs/0005-tables.md). Off, a table
 * reads as one paragraph of its text, as before. One choice for this device,
 * applied only while Debug mode is on.
 */
function readSaved(): boolean {
  try {
    return getRuntimeStorage().getItem(TABLES_STORAGE_KEY) === "grid";
  } catch {
    return false;
  }
}

let saved = readSaved();
const listeners = new Set<() => void>();

/**
 * Whether chapters parse tables into rows and cells. `?tables=grid` or
 * `?tables=flat` overrides the saved choice for Design ideas and benchmarks.
 * The answer changes parsed chapters, so it is part of their cache keys.
 */
export function getReaderTablesEnabled(): boolean {
  if (!getDebugEnabled()) return false;
  const param = new URLSearchParams(window.location.search).get("tables");
  if (param === "grid") return true;
  if (param === "flat") return false;
  return saved;
}

export function setReaderTablesPreference(enabled: boolean): void {
  try {
    getRuntimeStorage().setItem(TABLES_STORAGE_KEY, enabled ? "grid" : "flat");
  } catch {
    // Keep the in-memory choice when storage is unavailable.
  }
  saved = enabled;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The saved choice, for the Appearance row. */
export function useReaderTablesPreference(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => saved,
    () => saved,
  );
}
