/**
 * The real engine on simulated work, for Design ideas → Background
 * activity. Downloads are timers, the network is a switch, sync is a status
 * object, and the update runs `createAppUpdate` against a fake service
 * worker whose precache fills over three seconds. Nothing touches the
 * network or the app's own data.
 */
import {
  createActivityManager,
  syncAsJob,
  type JobKind,
  type SyncStatusLike,
} from "@workbench/background-activity";
import {
  createAppUpdate,
  precacheKey,
  type AppUpdate,
  type PrecacheEntry,
  type ServiceWorkerLike,
} from "@workbench/background-activity/service-worker";
import type { ActivityEnvironment, UpdateStore } from "../ActivityContext";

export interface SimBook {
  id: string;
  title: string;
  author: string;
  /** The EPUB's size in bytes. */
  size: number;
}

export interface SimWorld {
  online: boolean;
  /** Books shown so far while a new device restores; null when all are. */
  arrived: readonly string[] | null;
  onDevice: ReadonlySet<string>;
  /** Changes saved only on this device, by book. */
  pending: ReadonlyMap<string, number>;
  /** Books whose changes just synced: the second tick draws. */
  synced: ReadonlySet<string>;
}

export type ScenarioId =
  | "new-device"
  | "download"
  | "offline"
  | "update"
  | "failure";

export const SCENARIOS: { id: ScenarioId; label: string }[] = [
  { id: "new-device", label: "New device" },
  { id: "download", label: "Download 3" },
  { id: "offline", label: "Offline edits" },
  { id: "update", label: "Update" },
  { id: "failure", label: "Failure" },
];

function emitter() {
  const listeners = new Set<() => void>();
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit() {
      for (const listener of [...listeners]) listener();
    },
  };
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

/** The new version's files: 48 of them, 4.6 MB, 30 changed per release. */
function manifest(version: number): PrecacheEntry[] {
  return Array.from({ length: 48 }, (_, index) => ({
    url: `assets/chunk-${index}.js`,
    revision: index < 30 ? `v${version}-${index}` : `stable-${index}`,
    size: 40_000 + ((index * 7919) % 150_000),
  }));
}

class FakeWorker implements ServiceWorkerLike {
  state = "installing";
  private readonly listeners = new Set<() => void>();
  private readonly onSkip: (worker: FakeWorker) => void;
  constructor(onSkip: (worker: FakeWorker) => void) {
    this.onSkip = onSkip;
  }
  postMessage(message: unknown) {
    if ((message as { type?: string } | null)?.type === "SKIP_WAITING")
      this.onSkip(this);
  }
  addEventListener(_type: "statechange", listener: () => void) {
    this.listeners.add(listener);
  }
  removeEventListener(_type: "statechange", listener: () => void) {
    this.listeners.delete(listener);
  }
  set(state: string) {
    this.state = state;
    for (const listener of [...this.listeners]) listener();
  }
}

const SCOPE = "https://reader.simulated/";

export interface Simulation {
  environment: ActivityEnvironment;
  books: readonly SimBook[];
  subscribe(listener: () => void): () => void;
  getWorld(): SimWorld;
  run(id: ScenarioId): void;
  /** You tapped a book that is not on this device. */
  download(bookId: string): void;
  reset(): void;
  dispose(): void;
}

export function createSimulation(
  books: readonly SimBook[],
  options: { onDevice?: readonly string[] } = {},
): Simulation {
  const initialOnDevice = new Set(
    options.onDevice ?? books.filter((_, i) => i % 2 === 1).map((b) => b.id),
  );
  let world: SimWorld = {
    online: true,
    arrived: null,
    onDevice: initialOnDevice,
    pending: new Map(),
    synced: new Set(),
  };
  const worldChanged = emitter();
  const setWorld = (patch: Partial<SimWorld>) => {
    world = { ...world, ...patch };
    worldChanged.emit();
  };

  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (ms: number, run: () => void) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      run();
    }, ms);
    timers.add(timer);
  };

  // The network.
  const networkListeners = new Set<(online: boolean) => void>();
  const setOnline = (online: boolean) => {
    setWorld({ online });
    for (const listener of [...networkListeners]) listener(online);
  };

  // Downloads: a book's bytes arrive over two to four seconds. A failing
  // book's server errors at 45% until you tap Retry.
  const failing = new Set<string>();
  const download: JobKind<{ bookId: string; title: string; size: number }> = {
    lane: "network",
    retry: { attempts: 2, initialMs: 1_500, maxMs: 3_000 },
    title: (input) => input.title,
    async run(input, { signal, progress, checkpoint, resume }) {
      const total = input.size;
      let bytes = typeof resume === "number" ? resume : 0;
      const step = total / (22 + ((input.size / 997) % 16));
      progress({ phase: "downloading", bytes, totalBytes: total });
      while (bytes < total) {
        await sleep(100, signal);
        bytes = Math.min(total, bytes + step);
        progress({ bytes, totalBytes: total });
        checkpoint(bytes);
        if (failing.has(input.bookId) && bytes > total * 0.45)
          throw Object.assign(new Error("Server error"), { status: 503 });
      }
      progress({ phase: "preparing" });
      await sleep(450, signal);
      setWorld({ onDevice: new Set([...world.onDevice, input.bookId]) });
    },
  };

  const manager = createActivityManager({
    kinds: { "book-download": download },
    lanes: { network: 2 },
    network: {
      isOnline: () => world.online,
      subscribe(listener) {
        networkListeners.add(listener);
        return () => {
          networkListeners.delete(listener);
        };
      },
    },
  });

  // Sync, as a status object the real adapter reads.
  const SYNCED: SyncStatusLike = {
    connection: "online",
    auth: { status: "signed-in" },
    running: false,
    restoring: false,
    pending: 0,
    failure: null,
    failures: 0,
    retryAt: null,
  };
  let sync = SYNCED;
  const syncChanged = emitter();
  const setSync = (patch: Partial<SyncStatusLike>) => {
    sync = { ...sync, ...patch };
    syncChanged.emit();
  };
  manager.track(
    "sync",
    syncAsJob({ subscribe: syncChanged.subscribe, getSnapshot: () => sync }),
  );

  // The update: the real store on a fake worker, registration and cache.
  let version = 1;
  const cached = new Set(manifest(version).map((e) => precacheKey(e, SCOPE)));
  const containerListeners = new Set<() => void>();
  const container = {
    controller: {} as unknown,
    addEventListener: (_: "controllerchange", l: () => void) =>
      void containerListeners.add(l),
    removeEventListener: (_: "controllerchange", l: () => void) =>
      void containerListeners.delete(l),
  };
  const foundListeners = new Set<() => void>();
  const registration = {
    scope: SCOPE,
    installing: null as FakeWorker | null,
    waiting: null as FakeWorker | null,
    async update() {
      if (registration.installing || registration.waiting) return;
      install();
    },
    addEventListener: (_: "updatefound", l: () => void) =>
      void foundListeners.add(l),
    removeEventListener: (_: "updatefound", l: () => void) =>
      void foundListeners.delete(l),
  };
  const remembered = new Map<string, string>();
  const storage = {
    getItem: (key: string) => remembered.get(key) ?? null,
    setItem: (key: string, value: string) => void remembered.set(key, value),
    removeItem: (key: string) => void remembered.delete(key),
  };

  function install() {
    const next = manifest(version + 1);
    const worker = new FakeWorker((skipping) => {
      later(200, () => {
        skipping.set("activated");
        registration.waiting = null;
        container.controller = skipping;
        version += 1;
        for (const listener of [...containerListeners]) listener();
      });
    });
    registration.installing = worker;
    for (const listener of [...foundListeners]) listener();
    const missing = next.filter((e) => !cached.has(precacheKey(e, SCOPE)));
    missing.forEach((entry, index) =>
      later(110 * (index + 1), () => cached.add(precacheKey(entry, SCOPE))),
    );
    later(110 * (missing.length + 1), () => {
      registration.installing = null;
      registration.waiting = worker;
      worker.set("installed");
    });
  }

  const updateChanged = emitter();
  let update: AppUpdate;
  let stopTrackingUpdate = () => {};
  const updateStore: UpdateStore = {
    subscribe: updateChanged.subscribe,
    getSnapshot: () => update.getSnapshot(),
    startedAt: Date.now(),
  };
  function mountUpdate() {
    update = createAppUpdate({
      container,
      register: async () => registration,
      policy: () => "wait",
      readManifest: async () => manifest(version + 1),
      caches: {
        open: async () => ({
          keys: async () => [...cached].map((url) => ({ url })),
        }),
      },
      reload: () =>
        // The page reloads: a short beat, then a new page with the new
        // version. Downloads carry on, as persisted jobs do.
        later(650, () => {
          stopTrackingUpdate();
          update.dispose();
          updateStore.startedAt = Date.now();
          mountUpdate();
        }),
      checkIntervalMs: 0,
      storage,
      title: "Reader",
    });
    update.subscribe(updateChanged.emit);
    stopTrackingUpdate = manager.track("app-update", update.asJob());
    updateChanged.emit();
  }
  mountUpdate();

  const bookOfJob = (id: string) => id.replace(/^book:/, "");
  const startDownload = (book: SimBook) =>
    manager.start(
      "book-download",
      { bookId: book.id, title: book.title, size: book.size },
      { id: `book:${book.id}`, origin: "user" },
    );
  const notHere = () => books.filter((book) => !world.onDevice.has(book.id));

  function reset() {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    failing.clear();
    for (const job of manager.getSnapshot().jobs) {
      if (job.tracked) continue;
      manager.cancel(job.id);
      manager.dismiss(job.id);
    }
    if (!world.online) setOnline(true);
    sync = SYNCED;
    syncChanged.emit();
    setWorld({
      arrived: null,
      onDevice: new Set(initialOnDevice),
      pending: new Map(),
      synced: new Set(),
    });
  }

  function run(id: ScenarioId) {
    switch (id) {
      case "new-device": {
        reset();
        setWorld({ arrived: [], onDevice: new Set() });
        setSync({ restoring: true, running: true });
        books.forEach((book, index) =>
          later(260 * (index + 1), () =>
            setWorld({ arrived: [...(world.arrived ?? []), book.id] }),
          ),
        );
        later(260 * (books.length + 1) + 200, () => {
          setSync({ restoring: false, running: false });
          setWorld({ arrived: null });
        });
        return;
      }
      case "download":
        for (const book of notHere().slice(0, 3)) startDownload(book);
        return;
      case "offline": {
        const changed = books
          .filter((book) => world.onDevice.has(book.id))
          .slice(0, 2);
        setOnline(false);
        setWorld({
          pending: new Map(changed.map((book, i) => [book.id, 2 - i])),
        });
        setSync({ connection: "offline", pending: 3 });
        later(6_000, () => {
          setOnline(true);
          setSync({ connection: "online", running: true });
          later(700, () => {
            setWorld({
              pending: new Map(),
              synced: new Set(changed.map((book) => book.id)),
            });
            setSync({ pending: 0, running: false });
            later(1_400, () => setWorld({ synced: new Set() }));
          });
        });
        return;
      }
      case "update":
        void update.check();
        return;
      case "failure": {
        const book = notHere()[0] ?? books[0];
        if (!book) return;
        failing.add(book.id);
        startDownload(book);
        return;
      }
    }
  }

  const environment: ActivityEnvironment = {
    source: {
      subscribe: manager.subscribe,
      getSnapshot: manager.getSnapshot,
      cancel: manager.cancel,
      // In the simulation, Retry is what fixes the server.
      retry(id) {
        failing.delete(bookOfJob(id));
        manager.retry(id);
      },
      dismiss: manager.dismiss,
    },
    update: updateStore,
    restart: () => update.apply(),
  };

  return {
    environment,
    books,
    subscribe: worldChanged.subscribe,
    getWorld: () => world,
    run,
    download(bookId) {
      const book = books.find((item) => item.id === bookId);
      if (book && !world.onDevice.has(book.id)) startDownload(book);
    },
    reset,
    dispose() {
      reset();
      stopTrackingUpdate();
      update.dispose();
      manager.dispose();
    },
  };
}
