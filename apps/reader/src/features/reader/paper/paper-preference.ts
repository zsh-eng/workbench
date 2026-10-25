import { getRuntimeStorage } from "@/features/sync-lab/runtime";
import { useSyncExternalStore } from "react";
import { isPaperGrain, type PaperGrain } from "./paper-grain";

/** `curl` is the leaf you can hold; `curl-v1` the first curl, kept to compare. */
export type PageTurnStyle = "slide" | "curl" | "curl-v1";

export function isPageTurnStyle(value: unknown): value is PageTurnStyle {
  return value === "slide" || value === "curl" || value === "curl-v1";
}

/**
 * Where the ink sits: `on` the grain, as first built; `in` it, the grain
 * multiplied over the text and the ink thinned on the tooth; or `gl`, the
 * page's ink drawn into the paper by WebGL under transparent live text.
 */
export type PaperInk = "on" | "in" | "gl";

export function isPaperInk(value: unknown): value is PaperInk {
  return value === "on" || value === "in" || value === "gl";
}

/**
 * Where a hand holds the leaf (Debug curl). `anywhere` holds the paper
 * under the finger and turns the fold with the pull: a roll from the middle
 * of the edge, a cone from a corner. `edge` is the first leaf: the
 * fore-edge carried ahead of the finger round a roll that tilts only near a
 * corner.
 */
export type LeafGrip = "anywhere" | "edge";

export function isLeafGrip(value: unknown): value is LeafGrip {
  return value === "anywhere" || value === "edge";
}

/**
 * Paper in the Reader, a prototype: how a swipe turns the page, the grain
 * under the text, and the turn's feel. One choice for this device, applied
 * only while Debug mode is on.
 */
export interface PaperPreference {
  pageTurn: PageTurnStyle;
  grain: PaperGrain;
  ink: PaperInk;
  grip: LeafGrip;
  /** The front's ink shows faintly through the back of a curling page. */
  showThrough: boolean;
  haptics: boolean;
  sound: boolean;
}

export const PLAIN_PAPER: PaperPreference = {
  pageTurn: "slide",
  grain: "off",
  ink: "in",
  grip: "anywhere",
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
      ink: isPaperInk(saved.ink) ? saved.ink : PLAIN_PAPER.ink,
      grip: isLeafGrip(saved.grip) ? saved.grip : PLAIN_PAPER.grip,
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
 * The paper the Reader shows. Design ideas pass `?turn=`, `?paper=`,
 * `?ink=`, `?grip=` and `?showThrough=` to preview an idea without saving
 * it.
 */
export function resolvePaper(
  debugEnabled: boolean,
  saved: PaperPreference,
  params: URLSearchParams,
): PaperPreference {
  if (!debugEnabled) return PLAIN_PAPER;
  const turn = params.get("turn");
  const grain = params.get("paper");
  const ink = params.get("ink");
  const grip = params.get("grip");
  const showThrough = params.get("showThrough");
  return {
    ...saved,
    pageTurn: isPageTurnStyle(turn) ? turn : saved.pageTurn,
    grain: isPaperGrain(grain) ? grain : saved.grain,
    ink: isPaperInk(ink) ? ink : saved.ink,
    grip: isLeafGrip(grip) ? grip : saved.grip,
    showThrough:
      showThrough === "off"
        ? false
        : showThrough === "on"
          ? true
          : saved.showThrough,
  };
}
