/**
 * The background activity manager: a queue of jobs in lanes with a
 * concurrency limit each, with progress, cancel, retry with backoff, offline
 * waits and persistence across reloads. It also shows jobs that something
 * else owns (`track`), such as sync and the app update, so the UI reads one
 * list. See docs/STATES.md for the states and the rules the model checks.
 */
import type {
  ActivityClock,
  ActivityNetwork,
  ActivitySnapshot,
  ActivityStorage,
  InputOf,
  Job,
  JobContext,
  JobFailure,
  JobKind,
  JobKinds,
  JobProgress,
  JobState,
  StartOptions,
  TrackedJobSource,
  TrackedJobView,
} from "./types";

export const DEFAULT_LANE_LIMIT = 2;
export const DEFAULT_RETRY = { attempts: 3, initialMs: 2_000, maxMs: 60_000 };
const PROGRESS_INTERVAL_MS = 100;
const PERSIST_INTERVAL_MS = 500;
/** Done and cancelled jobs leave the list after this, so it does not grow. */
const KEEP_FINISHED_MS = 10_000;
const STORAGE_VERSION = 1;

const EMPTY_PROGRESS: JobProgress = {
  done: 0,
  total: null,
  bytes: 0,
  totalBytes: null,
  phase: null,
};

/** States in which the job still has work to do. */
const ACTIVE: ReadonlySet<JobState> = new Set([
  "queued",
  "waiting",
  "running",
  "retrying",
]);

/** Throw from a job to give its failure exactly. */
export class JobError extends Error {
  readonly failure: JobFailure;
  constructor(failure: JobFailure) {
    super(failure.message);
    this.name = "JobError";
    this.failure = failure;
  }
}

export interface ActivityManagerOptions<K extends JobKinds> {
  kinds: K;
  /** Concurrency per lane. A lane not listed runs two jobs at once. */
  lanes?: Record<string, number>;
  network?: ActivityNetwork;
  /** Keeps persisted kinds' jobs across reloads. */
  persist?: { storage: ActivityStorage; key: string };
  /** Start with the queue held; `resume()` lets jobs run. For first paint. */
  paused?: boolean;
  clock?: ActivityClock;
  random?: () => number;
}

export interface ActivityManager<K extends JobKinds = JobKinds> {
  subscribe(listener: () => void): () => void;
  getSnapshot(): ActivitySnapshot;
  get(id: string): Job | undefined;
  /**
   * Start a job, or join the job that has its id. A failed job with the id
   * starts again; a done or cancelled one is replaced. Returns the id.
   */
  start<N extends keyof K & string>(
    kind: N,
    input: InputOf<K[N]>,
    options?: StartOptions,
  ): string;
  /** Stop it now. It does not start again by itself. */
  cancel(id: string): void;
  /** Start a failed job again, or skip a retry's wait. */
  retry(id: string): void;
  /** Take a finished or failed job off the list. */
  dismiss(id: string): void;
  /** Show a job that something else owns. Returns a function that stops. */
  track(id: string, source: TrackedJobSource): () => void;
  /** Hold the queue: running jobs finish, no new one starts. */
  pause(): void;
  resume(): void;
  /** Resolves when no attempt is running. */
  drain(): Promise<void>;
  /** Stop every attempt. Persisted jobs start again in the next manager. */
  dispose(): void;
}

interface Entry {
  job: Job;
  kind: JobKind | null;
  source: TrackedJobSource | null;
  /** The attempt that may report. An interrupted attempt's results are ignored. */
  epoch: number;
  controller: AbortController | null;
  checkpoint: unknown;
  /** Queue order: a job keeps its place when it waits or retries. */
  order: number;
  timer: unknown;
  pendingProgress: JobProgress | null;
}

interface SavedJob {
  id: string;
  kind: string;
  input: unknown;
  origin: Job["origin"];
  title: string;
  state: "queued" | "failed";
  progress: JobProgress;
  failure: JobFailure | null;
  attempts: number;
  checkpoint: unknown;
  createdAt: number;
}

const browserClock: ActivityClock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) =>
    clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** `navigator.onLine` and its events. Without a window, always online. */
export function browserNetwork(): ActivityNetwork {
  return {
    isOnline: () =>
      typeof navigator === "undefined" || navigator.onLine !== false,
    subscribe(listener) {
      if (typeof window === "undefined") return () => {};
      const online = () => listener(true);
      const offline = () => listener(false);
      window.addEventListener("online", online);
      window.addEventListener("offline", offline);
      return () => {
        window.removeEventListener("online", online);
        window.removeEventListener("offline", offline);
      };
    },
  };
}

export function createActivityManager<K extends JobKinds>(
  options: ActivityManagerOptions<K>,
): ActivityManager<K> {
  const kinds: JobKinds = options.kinds;
  const clock = options.clock ?? browserClock;
  const random = options.random ?? Math.random;
  const network = options.network ?? browserNetwork();
  const entries = new Map<string, Entry>();
  const listeners = new Set<() => void>();
  const inFlight = new Set<Promise<void>>();
  const stopTracking = new Map<string, () => void>();
  let online = network.isOnline();
  let paused = options.paused ?? false;
  let disposed = false;
  let order = 0;
  let snapshot: ActivitySnapshot = { jobs: [], online };
  let changed = false;
  let pumping = false;
  let pumpAgain = false;
  let progressTimer: unknown = null;
  let lastProgressAt = -Infinity;
  let persistTimer: unknown = null;
  let lastPersistAt = -Infinity;

  /** Replace a job's published object with a changed copy. */
  function set(entry: Entry, patch: Partial<Job>) {
    const keys = Object.keys(patch) as (keyof Job)[];
    if (keys.every((key) => entry.job[key] === patch[key])) return;
    entry.job = { ...entry.job, ...patch };
    changed = true;
  }

  /** Publish once for everything changed since the last commit. */
  function commit() {
    if (!changed) return;
    changed = false;
    snapshot = {
      jobs: [...entries.values()]
        .filter((entry) => entry.job.kind !== "")
        .map((entry) => entry.job),
      online,
    };
    for (const listener of [...listeners]) listener();
  }

  function needsNetwork(entry: Entry) {
    return entry.kind?.needsNetwork ?? true;
  }

  function laneOf(entry: Entry) {
    return entry.kind?.lane ?? "default";
  }

  /** Start queued jobs while their lane has room: yours first, then by age. */
  function pump() {
    if (paused || disposed) return;
    // A job that starts another job from its run: go round again after this.
    if (pumping) {
      pumpAgain = true;
      return;
    }
    pumping = true;
    try {
      do {
        pumpAgain = false;
        pumpOnce();
      } while (pumpAgain && !paused && !disposed);
    } finally {
      pumping = false;
    }
  }

  function pumpOnce() {
    const running = new Map<string, number>();
    const queued: Entry[] = [];
    for (const entry of entries.values()) {
      if (entry.source) continue;
      if (entry.job.state === "running")
        running.set(laneOf(entry), (running.get(laneOf(entry)) ?? 0) + 1);
      else if (entry.job.state === "queued") queued.push(entry);
    }
    queued.sort(
      (a, b) =>
        Number(b.job.origin === "user") - Number(a.job.origin === "user") ||
        a.order - b.order,
    );
    const offline = !network.isOnline();
    for (const entry of queued) {
      if (entry.job.state !== "queued") continue;
      // The model found this: a request that failed when the network went
      // away freed its slot, and the next job started offline.
      if (offline && needsNetwork(entry)) {
        set(entry, {
          state: "waiting",
          waitingFor: "network",
          changedAt: clock.now(),
        });
        continue;
      }
      const lane = laneOf(entry);
      const limit = options.lanes?.[lane] ?? DEFAULT_LANE_LIMIT;
      const count = running.get(lane) ?? 0;
      if (count >= limit) continue;
      running.set(lane, count + 1);
      begin(entry);
    }
  }

  /** One attempt. Its results count only while `epoch` is the entry's. */
  function begin(entry: Entry) {
    const kind = entry.kind!;
    const epoch = ++entry.epoch;
    const controller = new AbortController();
    entry.controller = controller;
    set(entry, {
      state: "running",
      waitingFor: null,
      retryAt: null,
      changedAt: clock.now(),
    });
    const context: JobContext = {
      signal: controller.signal,
      resume: entry.checkpoint,
      progress(update) {
        if (entry.epoch !== epoch || disposed) return;
        entry.pendingProgress = {
          ...(entry.pendingProgress ?? entry.job.progress),
          ...update,
        };
        scheduleProgress();
      },
      checkpoint(data) {
        if (entry.epoch !== epoch || disposed) return;
        entry.checkpoint = data;
        schedulePersist();
      },
    };
    let attempt: Promise<void>;
    try {
      attempt = Promise.resolve(kind.run(entry.job.input, context));
    } catch (error) {
      attempt = Promise.reject(error);
    }
    const settled = attempt.then(
      () => settle(entry, epoch, null),
      (error: unknown) => settle(entry, epoch, { error }),
    );
    inFlight.add(settled);
    void settled.finally(() => inFlight.delete(settled));
  }

  /** An attempt ended. A late end of an interrupted attempt changes nothing. */
  function settle(
    entry: Entry,
    epoch: number,
    outcome: { error: unknown } | null,
  ) {
    if (disposed || entry.epoch !== epoch || entry.job.state !== "running")
      return;
    entry.controller = null;
    flushProgress(entry);
    const now = clock.now();
    if (!outcome) {
      set(entry, {
        state: "done",
        failure: null,
        retryAt: null,
        finishedAt: now,
        changedAt: now,
      });
      forgetLater(entry);
    } else if (needsNetwork(entry) && !network.isOnline()) {
      // The network went away under it: wait for it, and keep the attempts.
      online = false;
      set(entry, { state: "waiting", waitingFor: "network", changedAt: now });
    } else {
      const failure = classify(entry, outcome.error);
      const attempts = entry.job.attempts + 1;
      const limit = entry.kind?.retry?.attempts ?? DEFAULT_RETRY.attempts;
      if (failure.retryable && attempts < limit) {
        const retryAt = now + retryDelay(entry, attempts);
        set(entry, {
          state: "retrying",
          failure,
          attempts,
          retryAt,
          changedAt: now,
        });
        entry.timer = clock.setTimeout(
          () => retryTimerFires(entry, epoch),
          retryAt - now,
        );
      } else {
        set(entry, {
          state: "failed",
          failure,
          attempts,
          retryAt: null,
          finishedAt: now,
          changedAt: now,
        });
      }
    }
    persistNow();
    pump();
    commit();
  }

  function retryTimerFires(entry: Entry, epoch: number) {
    entry.timer = null;
    if (disposed || entry.epoch !== epoch || entry.job.state !== "retrying")
      return;
    requeue(entry);
    pump();
    commit();
  }

  /** Back in the queue at its old place, or waiting while offline. */
  function requeue(entry: Entry) {
    clearTimer(entry);
    const offline = needsNetwork(entry) && !network.isOnline();
    set(entry, {
      state: offline ? "waiting" : "queued",
      waitingFor: offline ? "network" : null,
      retryAt: null,
      changedAt: clock.now(),
    });
  }

  /** Stop the current attempt; its late results are ignored. */
  function interrupt(entry: Entry) {
    entry.epoch++;
    entry.controller?.abort();
    entry.controller = null;
    entry.pendingProgress = null;
    clearTimer(entry);
  }

  function clearTimer(entry: Entry) {
    if (entry.timer === null) return;
    clock.clearTimeout(entry.timer);
    entry.timer = null;
  }

  function retryDelay(entry: Entry, attempts: number) {
    const initial = entry.kind?.retry?.initialMs ?? DEFAULT_RETRY.initialMs;
    const max = entry.kind?.retry?.maxMs ?? DEFAULT_RETRY.maxMs;
    const base = Math.min(max, initial * 2 ** Math.min(attempts - 1, 20));
    return Math.round(base * (0.75 + 0.25 * random()));
  }

  function classify(entry: Entry, error: unknown): JobFailure {
    if (error instanceof JobError) return error.failure;
    return entry.kind?.classify?.(error) ?? classifyJobError(error);
  }

  function forgetLater(entry: Entry) {
    clearTimer(entry);
    const id = entry.job.id;
    entry.timer = clock.setTimeout(() => {
      entry.timer = null;
      if (entries.get(id) !== entry) return;
      if (entry.job.state !== "done" && entry.job.state !== "cancelled") return;
      remove(id);
      commit();
    }, KEEP_FINISHED_MS);
  }

  function remove(id: string) {
    const entry = entries.get(id);
    if (!entry) return;
    clearTimer(entry);
    entries.delete(id);
    changed = true;
  }

  function scheduleProgress() {
    if (progressTimer !== null) return;
    const wait = Math.max(
      0,
      lastProgressAt + PROGRESS_INTERVAL_MS - clock.now(),
    );
    progressTimer = clock.setTimeout(() => {
      progressTimer = null;
      lastProgressAt = clock.now();
      for (const entry of entries.values()) flushProgress(entry);
      commit();
    }, wait);
  }

  function flushProgress(entry: Entry) {
    if (!entry.pendingProgress) return;
    set(entry, { progress: entry.pendingProgress });
    entry.pendingProgress = null;
  }

  function onNetwork(next: boolean) {
    if (disposed) return;
    const was = online;
    online = next;
    if (was !== next) changed = true;
    const now = clock.now();
    for (const entry of entries.values()) {
      if (entry.source || !needsNetwork(entry)) continue;
      const state = entry.job.state;
      if (
        !next &&
        (state === "running" || state === "queued" || state === "retrying")
      ) {
        // Offline is reliable: stop now rather than wait for the request to fail.
        if (state === "running") flushProgress(entry);
        interrupt(entry);
        set(entry, {
          state: "waiting",
          waitingFor: "network",
          retryAt: null,
          changedAt: now,
        });
      } else if (next && state === "waiting") {
        requeue(entry);
      } else if (next && !was && state === "retrying") {
        // A network that came back is worth an attempt now, even in a backoff.
        requeue(entry);
      }
    }
    persistNow();
    pump();
    commit();
  }

  function schedulePersist() {
    if (!options.persist || persistTimer !== null) return;
    const wait = Math.max(0, lastPersistAt + PERSIST_INTERVAL_MS - clock.now());
    persistTimer = clock.setTimeout(() => {
      persistTimer = null;
      persistNow();
    }, wait);
  }

  /** Write every persisted kind's job that still has work, or failed. */
  function persistNow() {
    if (!options.persist || disposed) return;
    if (persistTimer !== null) {
      clock.clearTimeout(persistTimer);
      persistTimer = null;
    }
    lastPersistAt = clock.now();
    const jobs: SavedJob[] = [];
    for (const entry of entries.values()) {
      if (!entry.kind?.persist) continue;
      const { job } = entry;
      if (!ACTIVE.has(job.state) && job.state !== "failed") continue;
      jobs.push({
        id: job.id,
        kind: job.kind,
        input: job.input,
        origin: job.origin,
        title: job.title,
        state: job.state === "failed" ? "failed" : "queued",
        progress: entry.pendingProgress ?? job.progress,
        failure: job.failure,
        attempts: job.attempts,
        checkpoint: entry.checkpoint,
        createdAt: job.createdAt,
      });
    }
    const { storage, key } = options.persist;
    try {
      if (jobs.length === 0) storage.removeItem(key);
      else
        storage.setItem(
          key,
          JSON.stringify({ version: STORAGE_VERSION, jobs }),
        );
    } catch {
      // Full or blocked storage: the jobs still run in this page.
    }
  }

  /** Jobs saved by an earlier page come back queued, or failed as they were. */
  function restore() {
    if (!options.persist) return;
    let saved: SavedJob[] = [];
    try {
      const value = JSON.parse(
        options.persist.storage.getItem(options.persist.key) ?? "null",
      );
      if (value?.version === STORAGE_VERSION && Array.isArray(value.jobs))
        saved = value.jobs;
    } catch {
      return;
    }
    const now = clock.now();
    for (const item of saved) {
      const kind = kinds[item.kind];
      if (!kind?.persist || typeof item.id !== "string") continue;
      const offline = (kind.needsNetwork ?? true) && !online;
      const state: JobState =
        item.state === "failed" ? "failed" : offline ? "waiting" : "queued";
      entries.set(item.id, {
        job: {
          id: item.id,
          kind: item.kind,
          input: item.input,
          origin: item.origin === "app" ? "app" : "user",
          title: item.title ?? item.id,
          state,
          waitingFor: state === "waiting" ? "network" : null,
          progress: { ...EMPTY_PROGRESS, ...item.progress },
          failure: item.failure ?? null,
          attempts: item.attempts ?? 0,
          retryAt: null,
          tracked: false,
          detail: null,
          attention: false,
          createdAt: item.createdAt ?? now,
          changedAt: now,
          finishedAt: state === "failed" ? now : null,
        },
        kind,
        source: null,
        epoch: 0,
        controller: null,
        checkpoint: item.checkpoint,
        order: order++,
        timer: null,
        pendingProgress: null,
      });
      changed = true;
    }
  }

  function start(
    kindName: string,
    input: unknown,
    startOptions: StartOptions = {},
  ): string {
    const kind = kinds[kindName];
    if (!kind) throw new Error(`Unknown job kind: ${kindName}`);
    const id = startOptions.id ?? `${kindName}:${JSON.stringify(input)}`;
    const existing = entries.get(id);
    if (existing?.source)
      throw new Error(`Job ${id} is tracked; it cannot be started`);
    if (existing && ACTIVE.has(existing.job.state)) {
      // You asked for work the app had started: now it is yours, and it shows.
      if (startOptions.origin === "user") set(existing, { origin: "user" });
      commit();
      return id;
    }
    if (existing?.job.state === "failed") {
      if (startOptions.origin === "user") set(existing, { origin: "user" });
      retry(id);
      return id;
    }
    if (existing) remove(id);
    const now = clock.now();
    const offline = (kind.needsNetwork ?? true) && !network.isOnline();
    entries.set(id, {
      job: {
        id,
        kind: kindName,
        input,
        origin: startOptions.origin ?? "user",
        title: startOptions.title ?? kind.title?.(input) ?? id,
        state: offline ? "waiting" : "queued",
        waitingFor: offline ? "network" : null,
        progress: EMPTY_PROGRESS,
        failure: null,
        attempts: 0,
        retryAt: null,
        tracked: false,
        detail: null,
        attention: false,
        createdAt: now,
        changedAt: now,
        finishedAt: null,
      },
      kind,
      source: null,
      epoch: 0,
      controller: null,
      checkpoint: undefined,
      order: order++,
      timer: null,
      pendingProgress: null,
    });
    changed = true;
    persistNow();
    pump();
    commit();
    return id;
  }

  function cancel(id: string) {
    const entry = entries.get(id);
    if (!entry) return;
    if (entry.source) {
      entry.source.cancel?.();
      return;
    }
    if (!ACTIVE.has(entry.job.state) && entry.job.state !== "failed") return;
    const now = clock.now();
    interrupt(entry);
    set(entry, {
      state: "cancelled",
      retryAt: null,
      finishedAt: now,
      changedAt: now,
    });
    forgetLater(entry);
    persistNow();
    pump();
    commit();
  }

  function retry(id: string) {
    const entry = entries.get(id);
    if (!entry) return;
    if (entry.source) {
      entry.source.retry?.();
      return;
    }
    if (entry.job.state === "failed") {
      set(entry, { attempts: 0, failure: null, finishedAt: null });
      requeue(entry);
    } else if (entry.job.state === "retrying") requeue(entry);
    else return;
    persistNow();
    pump();
    commit();
  }

  function dismiss(id: string) {
    const entry = entries.get(id);
    if (!entry || entry.source || ACTIVE.has(entry.job.state)) return;
    remove(id);
    persistNow();
    commit();
  }

  function applyView(entry: Entry, view: TrackedJobView | null) {
    if (!view) {
      if (entry.job.kind !== "") {
        entry.job = { ...entry.job, kind: "" };
        changed = true;
      }
      return;
    }
    const now = clock.now();
    const progress = { ...EMPTY_PROGRESS, ...view.progress };
    const same = entry.job.kind === view.kind && entry.job.state === view.state;
    set(entry, {
      kind: view.kind,
      title: view.title,
      state: view.state,
      origin: view.origin ?? "app",
      waitingFor: view.waitingFor ?? null,
      failure: view.failure ?? null,
      retryAt: view.retryAt ?? null,
      detail: view.detail ?? null,
      attention: view.attention ?? false,
      changedAt: same ? entry.job.changedAt : now,
      finishedAt:
        view.state === "done" || view.state === "failed"
          ? same
            ? (entry.job.finishedAt ?? now)
            : now
          : null,
    });
    const before = entry.job.progress;
    if (
      before.done !== progress.done ||
      before.total !== progress.total ||
      before.bytes !== progress.bytes ||
      before.totalBytes !== progress.totalBytes ||
      before.phase !== progress.phase
    )
      set(entry, { progress });
  }

  function track(id: string, source: TrackedJobSource): () => void {
    if (entries.has(id)) throw new Error(`Job ${id} already exists`);
    const now = clock.now();
    // A tracked job with nothing to show keeps its entry with an empty kind,
    // which the snapshot leaves out.
    const entry: Entry = {
      job: {
        id,
        kind: "",
        input: null,
        origin: "app",
        title: id,
        state: "done",
        waitingFor: null,
        progress: EMPTY_PROGRESS,
        failure: null,
        attempts: 0,
        retryAt: null,
        tracked: true,
        detail: null,
        attention: false,
        createdAt: now,
        changedAt: now,
        finishedAt: null,
      },
      kind: null,
      source,
      epoch: 0,
      controller: null,
      checkpoint: undefined,
      order: order++,
      timer: null,
      pendingProgress: null,
    };
    entries.set(id, entry);
    const sync = () => {
      if (entries.get(id) !== entry) return;
      applyView(entry, source.read());
      commit();
    };
    const unsubscribe = source.subscribe(sync);
    sync();
    const stop = () => {
      unsubscribe();
      stopTracking.delete(id);
      if (entries.get(id) === entry) remove(id);
      commit();
    };
    stopTracking.set(id, stop);
    return stop;
  }

  restore();
  const detachNetwork = network.subscribe(onNetwork);
  pump();
  commit();

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    get: (id) => {
      const job = entries.get(id)?.job;
      return job && job.kind !== "" ? job : undefined;
    },
    start: start as ActivityManager<K>["start"],
    cancel,
    retry,
    dismiss,
    track,
    pause() {
      paused = true;
    },
    resume() {
      if (!paused) return;
      paused = false;
      pump();
      commit();
    },
    async drain() {
      while (inFlight.size > 0) await Promise.allSettled([...inFlight]);
    },
    dispose() {
      if (disposed) return;
      persistNow();
      disposed = true;
      detachNetwork();
      for (const stop of [...stopTracking.values()]) stop();
      for (const entry of entries.values()) interrupt(entry);
      if (progressTimer !== null) clock.clearTimeout(progressTimer);
      if (persistTimer !== null) clock.clearTimeout(persistTimer);
      listeners.clear();
    },
  };
}

/**
 * The default failure for an error: HTTP statuses by class, fetch's
 * TypeError and timeouts as network, a full disk as storage.
 */
export function classifyJobError(error: unknown): JobFailure {
  const message = error instanceof Error ? error.message : String(error);
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? (error as { status: unknown }).status
      : undefined;
  if (typeof status === "number") {
    if (status === 401 || status === 403)
      return { reason: "auth", message, retryable: false };
    if (status === 408 || status === 429 || status >= 500)
      return { reason: "server", message, retryable: true };
    return { reason: "rejected", message, retryable: false };
  }
  const name = error instanceof Error ? error.name : "";
  if (name === "QuotaExceededError")
    return { reason: "storage", message, retryable: false };
  if (
    error instanceof TypeError ||
    name === "TimeoutError" ||
    name === "AbortError"
  )
    return { reason: "network", message, retryable: true };
  return { reason: "other", message, retryable: true };
}
