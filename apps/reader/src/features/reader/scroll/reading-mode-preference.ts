import { getRuntimeStorage } from "@/features/sync-lab/runtime";
import type { ContentAnchor } from "@/lib/pagination-v2";
import { useSyncExternalStore } from "react";

export type ReadingMode = "pages" | "scroll";

export const READING_MODE_STORAGE_KEY = "reader-reading-mode-v1";

/**
 * The reading layout, like Apple Books' Scrolling View: one choice for every
 * book on this device. A book read in scroll mode reopens in scroll mode.
 * It applies only while Debug mode is on.
 */
function readReadingMode(): ReadingMode {
  try {
    return getRuntimeStorage().getItem(READING_MODE_STORAGE_KEY) === "scroll"
      ? "scroll"
      : "pages";
  } catch {
    return "pages";
  }
}

let mode = readReadingMode();
const listeners = new Set<() => void>();

function publish(next: ReadingMode): void {
  if (next === mode) return;
  mode = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === READING_MODE_STORAGE_KEY || event.key === null)
      publish(readReadingMode());
  };
  window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function getReadingModePreference(): ReadingMode {
  return mode;
}

export function setReadingModePreference(next: ReadingMode): void {
  try {
    getRuntimeStorage().setItem(READING_MODE_STORAGE_KEY, next);
  } catch {
    // Keep the in-memory choice when storage is unavailable.
  }
  publish(next);
}

export function useReadingModePreference(): ReadingMode {
  return useSyncExternalStore(
    subscribe,
    () => mode,
    () => mode,
  );
}

const SCROLL_PLACE_STORAGE_KEY = "reader-scroll-place-v1";
const MAX_SCROLL_PLACES = 30;

type ScrollPlaces = Record<string, ContentAnchor>;

function readScrollPlaces(): ScrollPlaces {
  try {
    const raw = getRuntimeStorage().getItem(SCROLL_PLACE_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? (parsed as ScrollPlaces) : {};
  } catch {
    return {};
  }
}

/**
 * The line at the top of the view when the reader last stopped scrolling a
 * book. History keeps the same anchor; this tells it apart from a page's own
 * anchor, so reopening restores that exact line.
 */
export function saveScrollPlace(bookId: string, anchor: ContentAnchor): void {
  const places = readScrollPlaces();
  delete places[bookId];
  places[bookId] = anchor;
  const kept = Object.entries(places).slice(-MAX_SCROLL_PLACES);
  try {
    getRuntimeStorage().setItem(
      SCROLL_PLACE_STORAGE_KEY,
      JSON.stringify(Object.fromEntries(kept)),
    );
  } catch {
    // The place is a refinement; history still restores the page.
  }
}

export function loadScrollPlace(bookId: string): ContentAnchor | null {
  return readScrollPlaces()[bookId] ?? null;
}
