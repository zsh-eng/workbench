import { useMemo, useSyncExternalStore, type SetStateAction } from "react";

/**
 * The reader's view settings: how the diff, the files, the session, and the
 * window's chrome show. Each one is a word in localStorage under its own
 * `med:` key, so it outlasts a reload, a closed window, and a restart of the
 * browser or of Med's server. localStorage belongs to the page's origin, and
 * Med serves one origin for each port (6330 by default).
 *
 * A key that is missing or holds an unknown word reads as the default, so a
 * first visit needs no setup. The keys that older versions wrote stay the
 * same, so an older Med's storage reads as it did. When storage refuses a
 * write, the choice holds for this page.
 *
 * `useViewSetting` shares a setting with every workspace and window that
 * shows it: a change in another window arrives as a storage event. A setting
 * that each window keeps for itself, such as the sidebar or zen mode, reads
 * `get` once and writes with `set`. docs/USAGE.md lists the settings and
 * where the others, such as pane layouts, are kept.
 */
export interface ViewSetting<T extends string> {
  readonly key: string;
  readonly fallback: T;
  get(): T;
  /** With `store: false`, the choice holds for this page only. */
  set(value: T, options?: { store?: boolean }): void;
  subscribe(listener: () => void): () => void;
}

function viewSetting<T extends string>(
  key: string,
  fallback: T,
  values: readonly T[],
): ViewSetting<T> {
  const listeners = new Set<() => void>();
  // A choice that storage does not hold: refused, or for this page only.
  let page: T | undefined;
  return {
    key,
    fallback,
    // Read each time, so a value that a test or another window stored is
    // never hidden behind a copy.
    get() {
      if (page !== undefined) return page;
      try {
        const value = localStorage.getItem(key);
        return values.includes(value as T) ? (value as T) : fallback;
      } catch {
        return fallback;
      }
    },
    set(value, { store = true } = {}) {
      page = value;
      if (store)
        try {
          localStorage.setItem(key, value);
          page = undefined;
        } catch {
          /* The choice holds for this page. */
        }
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      const other = (event: StorageEvent) => {
        if (event.key !== key && event.key !== null) return;
        page = undefined;
        listener();
      };
      addEventListener("storage", other);
      return () => {
        listeners.delete(listener);
        removeEventListener("storage", other);
      };
    },
  };
}

export const viewSettings = {
  /** Split or unified diffs; a review narrower than 760 px shows unified ones. */
  diffLayout: viewSetting("med:mode", "split", ["split", "unified"]),
  /** Wrap long lines in diffs. */
  wrap: viewSetting("med:wrap", "off", ["on", "off"]),
  /** Comments in the diff. Writing or opening a comment shows them again. */
  comments: viewSetting("med:comments", "shown", ["shown", "hidden"]),
  /** The rail beside Review and Changes: the Guide, or the files and
   * commits. "auto" shows it in a wide review; a choice holds in any width.
   * The key is the one that the files rail had before the Guide's joined it. */
  reviewRail: viewSetting("med:changes-rail", "auto", ["auto", "open", "closed"]),
  /** Vim keys in files. */
  vim: viewSetting("med:vim", "on", ["on", "off"]),
  /** The blame of the cursor's line in files. */
  lineBlame: viewSetting("med:line-blame", "on", ["on", "off"]),
  /** Quiet or full chrome (chrome.ts). */
  chrome: viewSetting("med:chrome:v1", "quiet", ["quiet", "full"]),
  /** The preview beside Find file's results. */
  filePreview: viewSetting("med:picker-preview", "on", ["on", "off"]),
  /** The work of finished turns in a session, folded into one row or shown. */
  work: viewSetting("med:work", "folded", ["folded", "shown"]),
  /** The session's side panel, which shows in a wide pane unless closed. */
  sessionPanel: viewSetting("med:session-panel", "auto", ["auto", "closed"]),
  /** What ⌘↩ does with a message while the agent works: send it now, at the
   * agent's next step, or queue it for the turn's end. ⇧⌘↩ does the other. */
  followUp: viewSetting("med:follow-up", "now", ["now", "queue"]),
  /** The background tasks dock under a session. */
  backgroundTasks: viewSetting("med:background", "open", ["open", "closed"]),
  /** Each window's sidebar, read when the window opens. */
  sidebar: viewSetting("med:sidebar", "shown", ["shown", "hidden"]),
  /** Each workspace's zen mode, read when the workspace opens. */
  zen: viewSetting("med:zen", "off", ["on", "off"]),
} as const;

/** A setting's value, shared with the other workspaces and windows. */
export function useViewSetting<T extends string>(setting: ViewSetting<T>) {
  return useSyncExternalStore(setting.subscribe, setting.get, () => setting.fallback);
}

/** Sets a two-word setting from a boolean or an update function, as React's
 * state setter does. */
export function switchSetter<T extends string>(setting: ViewSetting<T>, on: T, off: T) {
  return (next: SetStateAction<boolean>) => {
    const value = typeof next === "function" ? next(setting.get() === on) : next;
    setting.set(value ? on : off);
  };
}

/** A two-word setting as a boolean, and its setter (`switchSetter`). */
export function useViewSwitch<T extends string>(setting: ViewSetting<T>, on: T, off: T) {
  const value = useViewSetting(setting) === on;
  const set = useMemo(() => switchSetter(setting, on, off), [setting, on, off]);
  return [value, set] as const;
}
