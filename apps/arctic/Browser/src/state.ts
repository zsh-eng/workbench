import { createContext, useContext, useSyncExternalStore } from "react";
import { useSyncStatus, useSyncSummary } from "@zsh-eng/local-sync/react";
import { projector, type Article } from "./articles";
import type { Session } from "./sync/session";
import type { RecordStorage } from "./sync/storage";

export const SessionContext = createContext<Session | null>(null);

export function useSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error("Arctic has no signed-in session.");
  return session;
}

/** One projection per record change, shared by every component that reads it. */
const projections = new WeakMap<
  Session,
  {
    records: number;
    articles: Article[];
    project: ReturnType<typeof projector>;
  }
>();
export function articles(session: Session) {
  const cached = projections.get(session);
  if (cached?.records === session.records) return cached.articles;
  const project = cached?.project ?? projector();
  const next = project(session.arctic, session.copies);
  projections.set(session, {
    records: session.records,
    articles: next,
    project,
  });
  return next;
}

export function useArticles(): Article[] {
  const session = useSession();
  return useSyncExternalStore(
    (listener) => session.subscribe(listener),
    () => articles(session),
  );
}

/** Whether the links' first pull on this device is still under way. */
export function useRestoring() {
  const session = useSession();
  return useSyncExternalStore(
    (listener) => session.subscribe(listener),
    () => session.restoring,
  );
}

/** Whether the links' first pull on this device has ended with every page. */
export function useLinksRestored() {
  const session = useSession();
  return useSyncExternalStore(
    (listener) => session.subscribe(listener),
    () => session.linksRestored,
  );
}

/** Each derivation's last value, per storage: one per record change. */
const derived = new WeakMap<
  RecordStorage,
  Map<(storage: RecordStorage) => unknown, { revision: number; value: unknown }>
>();

/**
 * A value derived from one namespace's records, such as its highlights. It
 * is derived again only after a record changes, once for every component
 * that reads it, so `derive` must be a module-level function.
 */
export function useDerived<T>(
  storage: RecordStorage,
  derive: (storage: RecordStorage) => T,
): T {
  return useSyncExternalStore(
    (listener) => storage.subscribe(listener),
    () => {
      let values = derived.get(storage);
      if (!values) derived.set(storage, (values = new Map()));
      const cached = values.get(derive);
      if (cached?.revision === storage.revision) return cached.value as T;
      const value = derive(storage);
      values.set(derive, { revision: storage.revision, value });
      return value;
    },
  );
}

/** Whether a sync is running; re-renders only when that changes. */
export function useSyncing() {
  return useSyncStatus(useSession().controller, (status) => status.running);
}

/** The status in words, the same as in the other Workbench apps. */
export function useStatusText() {
  return useSyncSummary(useSession().controller);
}

type Toast = {
  /** The toast's element: it stays the same while the toast changes. */
  id: number;
  message: string;
  /** Undo, offered while its countdown runs (UNDO_SECONDS). */
  action?: ToastAction;
  /** What the toast is about. A toast with the same key takes in the next
   * change in place, instead of replacing it with a new one. */
  key: string;
  /** Changes it has taken in after the first. Each one starts the
   * countdown again. */
  round: number;
  /** The change was undone: the toast says so with a check, then leaves. */
  done?: boolean;
};

type ToastAction = {
  label: string;
  run: () => void;
  /** What the toast says once the change is undone. */
  done?: string;
};

let toast: Toast | null = null;
let toastId = 0;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
const toastListeners = new Set<() => void>();
const emit = () => toastListeners.forEach((listener) => listener());

/**
 * One notice at a time. A new subject replaces the last; the same subject
 * (`key`, or else the same words) changes the toast in place. While Undo is
 * on offer, another change of the same kind joins it: `message` can count
 * them ("3 archived"), the countdown starts again, and Undo takes them all
 * back, the newest first.
 */
export function showToast(
  message: string | ((count: number) => string),
  action?: ToastAction,
  { key }: { key?: string } = {},
) {
  const words = (count: number) =>
    typeof message === "string" ? message : message(count);
  const subject = key ?? words(1);
  const same = toast && !toast.done && toast.key === subject ? toast : null;
  if (same && action && same.action) {
    const earlier = same.action.run;
    toast = {
      ...same,
      // The first change and each one that joined.
      message: words(same.round + 2),
      round: same.round + 1,
      action: {
        ...action,
        run: () => {
          action.run();
          earlier();
        },
      },
    };
  } else if (same && !action && !same.action) {
    toast = { ...same, message: words(1), round: same.round + 1 };
  } else {
    toast = {
      id: ++toastId,
      message: words(1),
      action,
      key: subject,
      round: 0,
    };
  }
  emit();
  holdToast(false);
}

/** Undoes the toast's change and turns the same toast into its done state. */
export function undoToast(id: number) {
  if (!toast || toast.id !== id || !toast.action || toast.done) return;
  toast.action.run();
  toast = { ...toast, done: true, message: toast.action.done ?? "Undone" };
  emit();
  holdToast(false);
}

/**
 * A notice stays while the pointer or focus is on it, then 6 s more, and a
 * toast that says its change was undone 1.6 s. An offer of Undo keeps its
 * own time: the toast's countdown ends it.
 */
export function holdToast(held: boolean) {
  clearTimeout(toastTimer);
  if (held || !toast || (toast.action && !toast.done)) return;
  toastTimer = setTimeout(dismissToast, toast.done ? 1600 : 6000);
}

/** Dismisses the toast, or only the one with this id. */
export function dismissToast(id?: number) {
  if (!toast || (id !== undefined && toast.id !== id)) return;
  clearTimeout(toastTimer);
  toast = null;
  emit();
}

export function useToast() {
  return useSyncExternalStore(
    (listener) => {
      toastListeners.add(listener);
      return () => toastListeners.delete(listener);
    },
    () => toast,
  );
}

/** Shows the cause of a failed write; the edit was not committed. */
export function reportError(error: unknown) {
  showToast(error instanceof Error ? error.message : "Something went wrong.");
}
