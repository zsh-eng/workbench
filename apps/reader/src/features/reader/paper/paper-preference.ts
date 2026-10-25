import { getRuntimeStorage } from "@/features/sync-lab/runtime";
import { useSyncExternalStore } from "react";
import { isPaperGrain, type PaperGrain } from "./paper-grain";

/** `curl` is the leaf you can hold; `curl-v1` the first curl, kept to compare. */
export type PageTurnStyle = "slide" | "curl" | "curl-v1";

export function isPageTurnStyle(value: unknown): value is PageTurnStyle {
  return value === "slide" || value === "curl" || value === "curl-v1";
}

/**
 * Paper in the Reader, a prototype: how a swipe turns the page, the grain
 * under the text, and the turn's feel. One choice for this device, applied
 * only while Debug mode is on.
 */
export interface PaperPreference {
  pageTurn: PageTurnStyle;
  grain: PaperGrain;
  /** The front's ink shows faintly through the back of a curling page. */
  showThrough: boolean;
  haptics: boolean;
  sound: boolean;
}

export const PLAIN_PAPER: PaperPreference = {
  pageTurn: "slide",
  grain: "off",
  showThrough: true,
  haptics: true,
  sound: false,
};

export const PAPER_STORAGE_KEY = "reader-paper-v1";

function readPaperPreference(): PaperPreference {
  try {
    const raw = getRuntimeStorage().getItem(PAPER_STORAGE_KEY);
    const saved: Partial<PaperPreference> = raw ? JSON.parse(raw) : {};
    return {
      pageTurn: isPageTurnStyle(saved.pageTurn) ? saved.pageTurn : "slide",
      grain: isPaperGrain(saved.grain) ? saved.grain : PLAIN_PAPER.grain,
      showThrough: saved.showThrough !== false,
      haptics: saved.haptics !== false,
      sound: saved.sound === true,
    };
  } catch {
    return PLAIN_PAPER;
  }
}

let preference = readPaperPreference();
const listeners = new Set<() => void>();

function publish(next: PaperPreference): void {
  preference = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === PAPER_STORAGE_KEY || event.key === null)
      publish(readPaperPreference());
  };
  window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function setPaperPreference(change: Partial<PaperPreference>): void {
  const next = { ...preference, ...change };
  try {
    getRuntimeStorage().setItem(PAPER_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Keep the in-memory choice when storage is unavailable.
  }
  publish(next);
}

export function usePaperPreference(): PaperPreference {
  return useSyncExternalStore(
    subscribe,
    () => preference,
    () => preference,
  );
}

/**
 * The paper the Reader shows. Design ideas pass `?turn=`, `?paper=` and
 * `?showThrough=` to preview an idea without saving it.
 */
export function resolvePaper(
  debugEnabled: boolean,
  saved: PaperPreference,
  params: URLSearchParams,
): PaperPreference {
  if (!debugEnabled) return PLAIN_PAPER;
  const turn = params.get("turn");
  const grain = params.get("paper");
  const showThrough = params.get("showThrough");
  return {
    ...saved,
    pageTurn: isPageTurnStyle(turn) ? turn : saved.pageTurn,
    grain: isPaperGrain(grain) ? grain : saved.grain,
    showThrough:
      showThrough === "off"
        ? false
        : showThrough === "on"
          ? true
          : saved.showThrough,
  };
}
