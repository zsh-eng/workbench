import { useSyncExternalStore } from "react";

// Back and Forward, as routes have them. Each step the reader takes is an
// entry of the browser's history: another workspace (Workspaces.tsx), a page
// that covers them, such as Sources, and in a workspace, its page, its file,
// and its review. The entry holds what the workspace showed (its `screen`),
// and Back shows that again. Med reads the address for the workspace and the
// entry for the rest, so a thread's link stays its link.

/** What a workspace showed in an entry: its page or file tab, and its review. */
export interface Screen {
  workspace: string;
  tab?: string;
  review?: string;
}

type EntryState = { screen?: Screen } & Record<string, unknown>;

const LAST = "med:screen:v1";

const entry = () => (history.state ?? {}) as EntryState;

export function screenOf(state: unknown): Screen | undefined {
  const screen = (state as EntryState | null)?.screen;
  return screen && typeof screen.workspace === "string" ? screen : undefined;
}

export const sameScreen = (a: Screen | undefined, b: Screen | undefined) =>
  a?.workspace === b?.workspace && a?.tab === b?.tab && a?.review === b?.review;

/** A step is on its way: the next screen gets an entry of its own. It lapses
 * when nothing changes, as when the reader opens the file on screen. */
let stepping: ReturnType<typeof setTimeout> | undefined;
const STEP_MS = 3000;

/** The reader takes a step, such as to another page or file: what shows
 * next is a new entry, and the one on screen stays behind it for Back. */
export function step() {
  clearTimeout(stepping);
  stepping = setTimeout(() => (stepping = undefined), STEP_MS);
}

/** What the workspace on screen shows now: a new entry after a step, else
 * this entry. An entry that names no screen yet, as one that a switch of
 * workspace made, takes it. */
export function record(screen: Screen) {
  const state = entry();
  if (sameScreen(state.screen, screen)) return;
  const fresh = stepping !== undefined && state.screen?.workspace === screen.workspace;
  clearTimeout(stepping);
  stepping = undefined;
  const next = { ...state, screen };
  if (fresh) history.pushState(next, "", location.pathname + location.search + location.hash);
  else history.replaceState(next, "");
  try {
    localStorage.setItem(LAST, JSON.stringify(screen));
  } catch {
    /* A restart then opens the workspace on its own first page. */
  }
  changed();
}

/** The screen that a window showed last, which a restart shows again. */
export function lastScreen(): Screen | undefined {
  try {
    return screenOf({ screen: JSON.parse(localStorage.getItem(LAST) ?? "null") });
  } catch {
    return undefined;
  }
}

/** Back and Forward go no step that the reader took meanwhile. */
export function settle() {
  clearTimeout(stepping);
  stepping = undefined;
}

// Whether Back and Forward have somewhere to go. The Navigation API knows;
// where a browser lacks it, both stay on.
const listeners = new Set<() => void>();
const changed = () => {
  for (const listener of listeners) listener();
};
type Navigation = EventTarget & { canGoBack: boolean; canGoForward: boolean };
const navigation = (globalThis as { navigation?: Navigation }).navigation;
function subscribe(listener: () => void) {
  listeners.add(listener);
  navigation?.addEventListener("currententrychange", listener);
  addEventListener("popstate", listener);
  return () => {
    listeners.delete(listener);
    navigation?.removeEventListener("currententrychange", listener);
    removeEventListener("popstate", listener);
  };
}
const steps = () =>
  navigation ? (navigation.canGoBack ? 1 : 0) | (navigation.canGoForward ? 2 : 0) : 3;

/** Whether Back and Forward can go. */
export function useHistorySteps() {
  const value = useSyncExternalStore(subscribe, steps, () => 0);
  return { back: (value & 1) > 0, forward: (value & 2) > 0 };
}
