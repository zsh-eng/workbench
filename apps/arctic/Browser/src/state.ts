import { createContext, useContext, useSyncExternalStore } from "react";
import { project, type Article } from "./articles";
import type { Session } from "./sync/session";

export const SessionContext = createContext<Session | null>(null);

export function useSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error("Arctic has no signed-in session.");
  return session;
}

function useVersion(session: Session) {
  return useSyncExternalStore(
    (listener) => session.subscribe(listener),
    () => session.version,
  );
}

/** One projection per record change, shared by every component that reads it. */
const projections = new WeakMap<
  Session,
  { version: number; articles: Article[] }
>();
function articles(session: Session) {
  const cached = projections.get(session);
  if (cached?.version === session.version) return cached.articles;
  const next = project(session.arctic, session.copies);
  projections.set(session, { version: session.version, articles: next });
  return next;
}

export function useArticles(): Article[] {
  const session = useSession();
  return useSyncExternalStore(
    (listener) => session.subscribe(listener),
    () => articles(session),
  );
}

export function useStatus() {
  const session = useSession();
  useVersion(session);
  return session.status;
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
  clearTimeout(toastTimer);
  toast = { id: Date.now(), message, action };
  toastListeners.forEach((listener) => listener());
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
