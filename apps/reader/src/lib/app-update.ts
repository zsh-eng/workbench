import { getLabRuntime } from "@/features/sync-lab/runtime";
import { calmUpdates } from "@/lib/debug-switch";
import {
  createAppUpdate,
  type AppUpdate,
  type AppUpdateState,
  type PrecacheEntry,
} from "@workbench/background-activity/service-worker";
import { useSyncExternalStore } from "react";

/** Away this long, a return to the app is a safe moment to switch. */
export const AWAY_FOR_UPDATE_MS = 2 * 60_000;
/** Away this long, a return to the app also asks for a new version. */
export const AWAY_FOR_CHECK_MS = 15 * 60_000;
/** A page this new has shown nothing you are using yet. */
export const LAUNCH_MS = 5_000;

export function isReadingPath(pathname: string): boolean {
  return (
    pathname.startsWith("/reader/") || pathname.startsWith("/debug/reader/")
  );
}

export interface UpdateMomentContext {
  calm: boolean;
  pathname: string;
  /** Work you asked for is running, such as a download. */
  busy: boolean;
  /** Time since this page started. */
  pageAgeMs: number;
}

/**
 * Whether a ready update switches at once. Without Calm updates it does, as
 * the auto-updating app always has. With it, only on a page that has just
 * started away from a book; everything else waits for `updateMoment`.
 */
export function updatePolicy(context: UpdateMomentContext): "now" | "wait" {
  if (!context.calm) return "now";
  if (context.pageAgeMs < LAUNCH_MS && !isReadingPath(context.pathname))
    return "now";
  return "wait";
}

export type UpdateMomentEvent =
  | { type: "visible"; awayMs: number }
  | { type: "route"; from: string };

/**
 * What a calm update does at a moment: switch (`apply`), look for a new
 * version (`check`), or nothing. Never on the Reader.
 */
export function updateMoment(
  update: Pick<AppUpdateState, "status" | "takenOver">,
  event: UpdateMomentEvent,
  context: UpdateMomentContext,
): "apply" | "check" | null {
  if (!context.calm) return null;
  const reading = isReadingPath(context.pathname);
  if (update.status === "ready" && !reading) {
    // Another tab switched: this page runs old code on the new files, so
    // the first moment away from a book reloads it.
    if (update.takenOver) return "apply";
    if (
      event.type === "visible" &&
      event.awayMs >= AWAY_FOR_UPDATE_MS &&
      !context.busy
    )
      return "apply";
  }
  if (
    event.type === "visible" &&
    event.awayMs >= AWAY_FOR_CHECK_MS &&
    (update.status === "idle" || update.status === "failed")
  )
    return "check";
  return null;
}

const busyChecks = new Set<() => boolean>();

/** Hold a calm update while `check` is true, for example during a download. */
export function holdUpdatesWhile(check: () => boolean): () => void {
  busyChecks.add(check);
  return () => {
    busyChecks.delete(check);
  };
}

const pageStartedAt = Date.now();

export function updateContext(): UpdateMomentContext {
  return {
    calm: calmUpdates.get(),
    pathname: window.location.pathname,
    busy: [...busyChecks].some((check) => check()),
    pageAgeMs: Date.now() - pageStartedAt,
  };
}

let instance: AppUpdate | null = null;
const startListeners = new Set<() => void>();

function shouldRegister(): boolean {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator))
    return false;
  // Sync Lab clients and isolated design frames never register a worker.
  if (getLabRuntime()) return false;
  return !window.location.pathname.startsWith("/debug/elements/frame/");
}

/** Waits for the page to finish loading, as Workbox's registration does. */
function afterLoad(): Promise<void> {
  if (document.readyState === "complete") return Promise.resolve();
  return new Promise((resolve) =>
    window.addEventListener("load", () => resolve(), { once: true }),
  );
}

/**
 * Registers the app's worker and follows its updates, once per page. The
 * worker waits after it installs; `updatePolicy` and `updateMoment` decide
 * when it takes over.
 */
export function startAppUpdate(options: {
  onOfflineReady?: () => void;
}): AppUpdate | null {
  if (instance) return instance;
  if (!shouldRegister()) return null;
  const container = navigator.serviceWorker;
  instance = createAppUpdate({
    container,
    async register() {
      await afterLoad();
      return container.register(
        import.meta.env.DEV ? "/dev-sw.js?dev-sw" : "/sw.js",
        { scope: "/", type: "classic" },
      );
    },
    policy: () => updatePolicy(updateContext()),
    readManifest: async () => {
      if (import.meta.env.DEV) return [];
      const response = await fetch("/sw-precache.json", { cache: "no-store" });
      if (!response.ok) return [];
      return (await response.json()) as PrecacheEntry[];
    },
    caches: typeof caches === "undefined" ? undefined : caches,
    reload: () => window.location.reload(),
    onOfflineReady: options.onOfflineReady,
    storage: sessionStorage,
    title: "Reader",
  });
  for (const listener of startListeners) listener();
  return instance;
}

export function getAppUpdate(): AppUpdate | null {
  return instance;
}

const IDLE: AppUpdateState = {
  status: "idle",
  progress: null,
  takenOver: false,
  justUpdated: false,
  error: null,
};

function subscribe(listener: () => void): () => void {
  let stop = instance?.subscribe(listener) ?? null;
  const onStart = () => {
    stop?.();
    stop = instance?.subscribe(listener) ?? null;
    listener();
  };
  startListeners.add(onStart);
  return () => {
    startListeners.delete(onStart);
    stop?.();
  };
}

const getSnapshot = () => instance?.getSnapshot() ?? IDLE;

export function useAppUpdate(): AppUpdateState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * The reload that sync asks for when this version is too old to sync: it
 * switches to a waiting update, which a plain reload would not.
 */
export function reloadToLatest(): void {
  const update = instance;
  if (update && update.getSnapshot().status === "ready") update.apply();
  else window.location.reload();
}
