import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import type { Thread } from "../../shared/threads";
import { needsYou } from "./threads";

// Quiet signals: how the reader learns that a tab needs them while they look
// at something else. The dot on Show sidebar is in WorkspaceBar.tsx. This
// module has the installed app's Dock badge and the OS notifications that
// the reader turns on in ⌘K. Only "needs you" gives a signal; work that
// starts or ends gives none.

/** How many tabs need the reader. */
export const needsCount = (tabs: readonly Thread[]) => tabs.filter(needsYou).length;

/**
 * The installed app's Dock badge: the number of tabs that need the reader,
 * and no badge at 0. Every window sets the same number from the host's list.
 * Without the Badging API, nothing. `null`, before the list comes, keeps the
 * badge as it is.
 */
export function useAppBadge(count: number | null) {
  useEffect(() => {
    if (count === null || !("setAppBadge" in navigator)) return;
    (count > 0 ? navigator.setAppBadge(count) : navigator.clearAppBadge()).catch(() => {});
  }, [count]);
}

// ------------------------------------------------------------- the choice

const NOTIFY_KEY = "med:notify";
const choiceListeners = new Set<() => void>();

/** The reader turned notifications on in this browser, and it allows them. */
function notifyChosen() {
  try {
    return (
      localStorage.getItem(NOTIFY_KEY) === "on" &&
      typeof Notification !== "undefined" &&
      Notification.permission === "granted"
    );
  } catch {
    return false;
  }
}

function subscribeChoice(listener: () => void) {
  choiceListeners.add(listener);
  // Another window changed the choice.
  const storage = (event: StorageEvent) => {
    if (event.key === NOTIFY_KEY || event.key === null) listener();
  };
  window.addEventListener("storage", storage);
  return () => {
    choiceListeners.delete(listener);
    window.removeEventListener("storage", storage);
  };
}

/** Whether Med notifies the reader when a tab needs them. */
export const useNotifyChoice = () =>
  useSyncExternalStore(subscribeChoice, notifyChosen, () => false);

/**
 * Turns the notifications on or off for this browser. The first time, the
 * browser asks the reader for permission; "blocked" when it does not give it.
 */
export async function chooseNotify(on: boolean): Promise<"on" | "off" | "blocked" | "unsupported"> {
  if (on) {
    if (typeof Notification === "undefined") return "unsupported";
    const permission =
      Notification.permission === "default"
        ? await Notification.requestPermission()
        : Notification.permission;
    if (permission !== "granted") return "blocked";
  }
  try {
    if (on) localStorage.setItem(NOTIFY_KEY, "on");
    else localStorage.removeItem(NOTIFY_KEY);
  } catch {
    return "unsupported";
  }
  for (const listener of choiceListeners) listener();
  return on ? "on" : "off";
}

// ------------------------------------------------------- the notifications

/** Held, shared, by each Med window that shows. */
const LOOKING = "med:looking";
/** Held by the one window that sends the notifications. */
const NOTIFIER = "med:notifier";

/** This window is on screen, or has the focus. */
const shows = () => document.visibilityState === "visible" || document.hasFocus();

/** Whether a Med window shows: this one, or one that holds the shared lock. */
async function someWindowShows() {
  if (shows()) return true;
  if (!("locks" in navigator)) return false;
  const { held = [] } = await navigator.locks.query();
  return held.some((lock) => lock.name === LOOKING);
}

/** The first line of what a tab asks: its permission request, or its question. */
export function question(thread: Thread) {
  const turn = thread.turn;
  const text =
    thread.state === "waiting" && turn?.activity ? turn.activity : (turn?.said ?? turn?.activity);
  return (
    text
      ?.split("\n")
      .find((line) => line.trim())
      ?.trim() ?? "Needs you"
  );
}

/**
 * OS notifications, when the reader turned them on: when a tab starts to need
 * the reader and no Med window shows, one notification with the thread's
 * title and the first line of its question. A click shows Med and opens the
 * tab. `null`, before the list comes, sends none; the first list only sets
 * what needs the reader already.
 *
 * Each window that shows holds a shared lock, so a window can tell whether
 * any Med window shows. The window that holds the notifier lock sends the
 * notifications. A notification's tag is its thread, so a second one for the
 * same thread replaces the first.
 */
export function useNeedsYouNotifications(
  tabs: readonly Thread[] | null,
  open: (thread: Thread) => void,
) {
  const notifier = useRef(!("locks" in navigator));
  const opener = useRef(open);
  useLayoutEffect(() => {
    opener.current = open;
  });

  // The shared lock, while this window shows.
  useEffect(() => {
    if (!("locks" in navigator)) return;
    let release: (() => void) | null = null;
    const update = () => {
      if (shows() === !!release) return;
      if (release) {
        release();
        release = null;
        return;
      }
      const held = new Promise<void>((resolve) => (release = resolve));
      navigator.locks.request(LOOKING, { mode: "shared" }, () => held).catch(() => {});
    };
    update();
    document.addEventListener("visibilitychange", update);
    window.addEventListener("focus", update);
    window.addEventListener("blur", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("focus", update);
      window.removeEventListener("blur", update);
      release?.();
    };
  }, []);

  // One window sends the notifications; when it closes, the next one does.
  useEffect(() => {
    if (!("locks" in navigator)) return;
    const stop = new AbortController();
    navigator.locks
      .request(NOTIFIER, { signal: stop.signal }, () => {
        notifier.current = true;
        return new Promise<void>((resolve) =>
          stop.signal.addEventListener("abort", () => resolve(), { once: true }),
        );
      })
      .catch(() => {});
    return () => {
      stop.abort();
      notifier.current = false;
    };
  }, []);

  const before = useRef<ReadonlySet<string> | null>(null);
  useEffect(() => {
    if (!tabs) return;
    const now = new Set(tabs.filter(needsYou).map((thread) => thread.id));
    const previous = before.current;
    before.current = now;
    if (!previous || !notifier.current || !notifyChosen()) return;
    const fresh = tabs.filter((thread) => now.has(thread.id) && !previous.has(thread.id));
    if (!fresh.length) return;
    void someWindowShows()
      .catch(() => false)
      .then((seen) => {
        if (seen) return;
        for (const thread of fresh) {
          const notification = new Notification(thread.title, {
            body: question(thread),
            tag: thread.id,
          });
          notification.onclick = () => {
            window.focus();
            notification.close();
            opener.current(thread);
          };
        }
      });
  }, [tabs]);
}
