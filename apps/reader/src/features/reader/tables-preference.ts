import { getRuntimeStorage } from "@/features/sync-lab/runtime";
import { getDebugEnabled } from "@/lib/debug-preference";
import { useSyncExternalStore } from "react";
import type { ReaderTablesMode } from "./data/chapter-tables";

export const TABLES_STORAGE_KEY = "reader-tables-v1";

function isTablesMode(value: string | null): value is ReaderTablesMode {
  return value === "auto" || value === "grid" || value === "flat";
}

/**
 * Tables in the Reader (docs/0005-tables.md): Auto reads a chapter's tables
 * as grids up to a cell limit. Debug mode can choose Grid or Paragraph for
 * every chapter instead; the choice is for this device.
 */
function readSaved(): ReaderTablesMode {
  try {
    const value = getRuntimeStorage().getItem(TABLES_STORAGE_KEY);
    return isTablesMode(value) ? value : "auto";
  } catch {
    return "auto";
  }
}

let saved = readSaved();
const listeners = new Set<() => void>();

/**
 * How chapters read their tables: Auto, unless Debug mode chose otherwise.
 * `?tables=grid`, `flat` or `auto` overrides the saved choice for Design
 * ideas and benchmarks. The answer changes parsed chapters, so it is part of
 * their cache keys.
 */
export function getReaderTablesMode(): ReaderTablesMode {
  if (!getDebugEnabled()) return "auto";
  const param = new URLSearchParams(window.location.search).get("tables");
  return isTablesMode(param) ? param : saved;
}

export function setReaderTablesPreference(mode: ReaderTablesMode): void {
  try {
    getRuntimeStorage().setItem(TABLES_STORAGE_KEY, mode);
  } catch {
    // Keep the in-memory choice when storage is unavailable.
  }
  saved = mode;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The saved choice, for the Appearance row. */
export function useReaderTablesPreference(): ReaderTablesMode {
  return useSyncExternalStore(
    subscribe,
    () => saved,
    () => saved,
  );
}
