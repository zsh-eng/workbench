/**
 * App updates through a service worker, as a small store. The new worker
 * installs in the background and waits; the store reports the download's
 * progress from the precache, and the app chooses when to switch. The worker
 * must wait (no `skipWaiting()` in install) and accept
 * `{ type: "SKIP_WAITING" }`, as Workbox's generated worker does with
 * `skipWaiting: false`. See docs/STATES.md, "App updates".
 */
import type { ActivityClock, ActivityStorage, TrackedJobSource } from "./types";

export type AppUpdateStatus =
  | "idle"
  | "downloading"
  | "ready"
  | "applying"
  | "failed";

export interface AppUpdateProgress {
  /** Files of the new version stored since the download started. */
  done: number;
  total: number;
  bytes: number;
  /** 0 when the manifest has no sizes. */
  totalBytes: number;
}

export interface AppUpdateState {
  status: AppUpdateStatus;
  /** While downloading, when the new version's file list is known. */
  progress: AppUpdateProgress | null;
  /**
   * The new worker already controls this page: another tab switched, so the
   * page runs the old code on the new files. It should reload soon.
   */
  takenOver: boolean;
  /** This page loaded just after an update applied here. */
  justUpdated: boolean;
  error: string | null;
}

/** One precache entry, as Workbox lists them. */
export interface PrecacheEntry {
  url: string;
  revision: string | null;
  size?: number;
}

/** The parts of `navigator.serviceWorker` that the store uses. */
export interface ServiceWorkerContainerLike {
  readonly controller: unknown;
  addEventListener(type: "controllerchange", listener: () => void): void;
  removeEventListener(type: "controllerchange", listener: () => void): void;
}

export interface ServiceWorkerLike {
  readonly state: string;
  postMessage(message: unknown): void;
  addEventListener(type: "statechange", listener: () => void): void;
  removeEventListener(type: "statechange", listener: () => void): void;
}

export interface ServiceWorkerRegistrationLike {
  readonly scope: string;
  readonly installing: ServiceWorkerLike | null;
  readonly waiting: ServiceWorkerLike | null;
  update(): Promise<unknown>;
  addEventListener(type: "updatefound", listener: () => void): void;
  removeEventListener(type: "updatefound", listener: () => void): void;
}

export interface CacheStorageLike {
  open(name: string): Promise<{ keys(): Promise<readonly { url: string }[]> }>;
}

export interface AppUpdateOptions {
  container: ServiceWorkerContainerLike;
  /** Registers the app's worker. Resolves to undefined where workers do not run. */
  register(): Promise<ServiceWorkerRegistrationLike | undefined>;
  /**
   * `now` switches as soon as the update is ready and reloads, which is
   * what an auto-updating PWA does. `wait` holds it until `apply()`. Read
   * each time an update becomes ready.
   */
  policy(): "now" | "wait";
  /** The new version's precache list, for the download's progress. */
  readManifest?(): Promise<readonly PrecacheEntry[]>;
  /** Workbox's precache cache for a scope. */
  cacheName?(scope: string): string;
  caches?: CacheStorageLike;
  reload(): void;
  /** The first install finished: the app now opens offline. */
  onOfflineReady?(): void;
  /** Check for an update this often. Default one hour; 0 turns it off. */
  checkIntervalMs?: number;
  /** Remembers an apply across the reload, for "Updated". sessionStorage. */
  storage?: ActivityStorage;
  clock?: ActivityClock;
  /** The update's name in the activity sheet. */
  title?: string;
}

export interface AppUpdate {
  subscribe(listener: () => void): () => void;
  getSnapshot(): AppUpdateState;
  /** Ask the server for a new version now. */
  check(): Promise<void>;
  /** Switch to the waiting version and reload. Does nothing without one. */
  apply(): void;
  /** The update as a tracked job, for the activity manager. */
  asJob(): TrackedJobSource;
  dispose(): void;
}

const UPDATED_KEY = "background-activity:updated";
const POLL_MS = 250;
const HOUR = 60 * 60 * 1000;

const defaultClock: ActivityClock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) =>
    clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Workbox's cache key: the URL, with the revision as a query parameter. */
export function precacheKey(entry: PrecacheEntry, base: string): string {
  const url = new URL(entry.url, base);
  if (entry.revision) url.searchParams.set("__WB_REVISION__", entry.revision);
  return url.href;
}

export function createAppUpdate(options: AppUpdateOptions): AppUpdate {
  const clock = options.clock ?? defaultClock;
  const listeners = new Set<() => void>();
  const cleanups: Array<() => void> = [];
  let justUpdated = false;
  try {
    justUpdated = (options.storage?.getItem(UPDATED_KEY) ?? null) !== null;
    if (justUpdated) options.storage?.removeItem(UPDATED_KEY);
  } catch {
    // Blocked storage: the page does not say "Updated".
  }
  let state: AppUpdateState = {
    status: "idle",
    progress: null,
    takenOver: false,
    justUpdated,
    error: null,
  };
  let registration: ServiceWorkerRegistrationLike | undefined;
  let disposed = false;
  /** This page asked the waiting worker to take over. */
  let applyingHere = false;
  let hadController = options.container.controller !== null;
  /** The worker whose install the progress follows. */
  let watched: ServiceWorkerLike | null = null;
  let pollTimer: unknown = null;
  let checkTimer: unknown = null;

  function publish(next: Partial<AppUpdateState>) {
    const keys = Object.keys(next) as (keyof AppUpdateState)[];
    if (keys.every((key) => state[key] === next[key])) return;
    state = { ...state, ...next };
    for (const listener of [...listeners]) listener();
  }

  function becomeReady() {
    stopPolling();
    publish({ status: "ready", progress: null, error: null });
    if (options.policy() === "now") apply();
  }

  /** Follow one installing worker to waiting, or to its failure. */
  function follow(worker: ServiceWorkerLike | null) {
    if (!worker || worker === watched) return;
    // With no worker in control, this is the first install, not an update.
    if (options.container.controller === null) {
      const onState = () => {
        if (worker.state !== "activated") return;
        worker.removeEventListener("statechange", onState);
        options.onOfflineReady?.();
      };
      worker.addEventListener("statechange", onState);
      cleanups.push(() => worker.removeEventListener("statechange", onState));
      return;
    }
    watched = worker;
    publish({ status: "downloading", progress: null, error: null });
    const onState = () => {
      if (worker !== watched) return;
      if (worker.state === "installed") {
        watched = null;
        becomeReady();
      } else if (worker.state === "redundant") {
        watched = null;
        stopPolling();
        // A newer worker can replace this one while it installs.
        if (registration?.installing) follow(registration.installing);
        else if (registration?.waiting) becomeReady();
        else
          publish({
            status: "failed",
            progress: null,
            error: "The update did not install",
          });
      }
    };
    worker.addEventListener("statechange", onState);
    cleanups.push(() => worker.removeEventListener("statechange", onState));
    void pollProgress(worker, null);
  }

  async function pollProgress(
    worker: ServiceWorkerLike,
    baseline: { done: number; bytes: number } | null,
  ) {
    pollTimer = null;
    if (disposed || worker !== watched || !registration) return;
    const progress = await readProgress(registration.scope).catch(() => null);
    if (disposed || worker !== watched) return;
    if (progress) {
      const start = baseline ?? { done: progress.done, bytes: progress.bytes };
      baseline = start;
      publish({
        progress: {
          done: progress.done - start.done,
          total: progress.total - start.done,
          bytes: progress.bytes - start.bytes,
          totalBytes: progress.totalBytes - start.bytes,
        },
      });
    }
    if (worker.state === "installing")
      pollTimer = clock.setTimeout(
        () => void pollProgress(worker, baseline),
        POLL_MS,
      );
  }

  let manifest: Promise<readonly PrecacheEntry[]> | null = null;
  async function readProgress(scope: string) {
    if (!options.readManifest || !options.caches) return null;
    manifest ??= options.readManifest();
    const entries = await manifest.catch((error) => {
      manifest = null;
      throw error;
    });
    if (entries.length === 0) return null;
    const cacheName =
      options.cacheName?.(scope) ?? `workbox-precache-v2-${scope}`;
    const cache = await options.caches.open(cacheName);
    const stored = new Set((await cache.keys()).map((request) => request.url));
    let done = 0;
    let bytes = 0;
    let totalBytes = 0;
    for (const entry of entries) {
      totalBytes += entry.size ?? 0;
      if (!stored.has(precacheKey(entry, scope))) continue;
      done++;
      bytes += entry.size ?? 0;
    }
    return { done, total: entries.length, bytes, totalBytes };
  }

  function stopPolling() {
    if (pollTimer === null) return;
    clock.clearTimeout(pollTimer);
    pollTimer = null;
  }

  function onControllerChange() {
    if (disposed) return;
    if (applyingHere) {
      options.reload();
      return;
    }
    // The first install's clients.claim() gives this page its first worker.
    if (!hadController) {
      hadController = true;
      return;
    }
    // Another tab, or the browser, switched this page to the new version.
    publish({ status: "ready", takenOver: true, progress: null });
    if (options.policy() === "now") apply();
  }

  function apply() {
    if (disposed) return;
    if (state.takenOver) {
      remember();
      options.reload();
      return;
    }
    const waiting = registration?.waiting;
    if (!waiting) return;
    applyingHere = true;
    remember();
    publish({ status: "applying" });
    waiting.postMessage({ type: "SKIP_WAITING" });
  }

  function remember() {
    try {
      options.storage?.setItem(UPDATED_KEY, String(clock.now()));
    } catch {
      // Without storage, the next page does not say "Updated".
    }
  }

  async function check() {
    if (!registration || disposed) return;
    try {
      await registration.update();
    } catch {
      // Offline, or the server did not answer: the next check tries again.
    }
  }

  function scheduleChecks() {
    const every = options.checkIntervalMs ?? HOUR;
    if (every <= 0) return;
    checkTimer = clock.setTimeout(() => {
      void check();
      scheduleChecks();
    }, every);
  }

  options.container.addEventListener("controllerchange", onControllerChange);
  cleanups.push(() =>
    options.container.removeEventListener(
      "controllerchange",
      onControllerChange,
    ),
  );

  void options
    .register()
    .then((found) => {
      if (disposed || !found) return;
      registration = found;
      const onUpdateFound = () => follow(found.installing);
      found.addEventListener("updatefound", onUpdateFound);
      cleanups.push(() =>
        found.removeEventListener("updatefound", onUpdateFound),
      );
      if (found.waiting && options.container.controller !== null) becomeReady();
      else follow(found.installing);
      scheduleChecks();
    })
    .catch((error: unknown) => {
      if (disposed) return;
      publish({
        error: error instanceof Error ? error.message : String(error),
      });
    });

  const job: TrackedJobSource = {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    read() {
      const title = options.title ?? "App update";
      if (state.status === "downloading")
        return {
          kind: "app-update",
          title,
          state: "running",
          origin: "app",
          detail: "Downloading the update",
          progress: state.progress ?? undefined,
        };
      if (state.status === "ready")
        return {
          kind: "app-update",
          title,
          state: "waiting",
          waitingFor: "moment",
          origin: "user",
          detail: "Ready · restart to update",
        };
      if (state.status === "applying")
        return {
          kind: "app-update",
          title,
          state: "running",
          origin: "user",
          progress: { phase: "restarting" },
        };
      return null;
    },
    retry: () => void check(),
  };

  return {
    subscribe: job.subscribe,
    getSnapshot: () => state,
    check,
    apply,
    asJob: () => job,
    dispose() {
      disposed = true;
      stopPolling();
      if (checkTimer !== null) clock.clearTimeout(checkTimer);
      for (const cleanup of cleanups.splice(0)) cleanup();
      listeners.clear();
    },
  };
}
