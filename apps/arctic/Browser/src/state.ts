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

/** The revision of one namespace's records, for views derived from them. */
export function useRecords(storage: RecordStorage) {
  return useSyncExternalStore(
    (listener) => storage.subscribe(listener),
    () => storage.revision,
  );
}

/** Connection, account and sync activity (see @zsh-eng/local-sync). */
export function useStatus() {
  return useSyncStatus(useSession().controller);
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
  id: number;
  message: string;
  action?: { label: string; run: () => void };
};
let toast: Toast | null = null;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
const toastListeners = new Set<() => void>();

/** One notice at a time; a new one replaces the last. */
export function showToast(message: string, action?: Toast["action"]) {
  toast = { id: Date.now(), message, action };
  toastListeners.forEach((listener) => listener());
  holdToast(false);
}

/** A notice stays while the pointer or focus is on it, then 6 s more. */
export function holdToast(held: boolean) {
  clearTimeout(toastTimer);
  if (held || !toast) return;
  toastTimer = setTimeout(() => {
    toast = null;
    toastListeners.forEach((listener) => listener());
  }, 6000);
}

export function dismissToast() {
  clearTimeout(toastTimer);
  toast = null;
  toastListeners.forEach((listener) => listener());
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
