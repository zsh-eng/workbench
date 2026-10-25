/**
 * A job is one subject of background work: a book's download, "all images",
 * a sync pass or the app update. See docs/MODEL.md for what shows, and
 * docs/STATES.md for the states and their rules.
 */

/**
 * - `queued`: ready, waiting for a free slot in its lane.
 * - `waiting`: held by something outside the job; `waitingFor` says what.
 * - `running`: an attempt is in progress.
 * - `retrying`: an attempt failed and another starts at `retryAt`.
 * - `failed`: it gave up, or the failure cannot fix itself. Retry restarts it.
 * - `done`, `cancelled`: finished.
 */
export type JobState =
  | "queued"
  | "waiting"
  | "running"
  | "retrying"
  | "failed"
  | "done"
  | "cancelled";

/** What a waiting job needs: the network, a safe moment (an update), or a sign-in. */
export type JobWait = "network" | "moment" | "sign-in";

/**
 * `user`: someone asked for it, or is waiting for it; it shows. `app`: the
 * app started it on its own; it stays quiet unless it needs attention.
 */
export type JobOrigin = "user" | "app";

export interface JobProgress {
  /** Items finished, such as images or files. */
  done: number;
  /** Items in all, when known. */
  total: number | null;
  bytes: number;
  totalBytes: number | null;
  /** A short phase, such as "preparing" after a download. */
  phase: string | null;
}

export type JobFailureReason =
  | "network"
  | "auth"
  | "storage"
  | "server"
  | "rejected"
  | "other";

export interface JobFailure {
  reason: JobFailureReason;
  message: string;
  /** Retryable failures retry by themselves until the attempts run out. */
  retryable: boolean;
}

export interface Job<Input = unknown> {
  /** One id per subject, such as `book:<id>`. Starting it again joins this job. */
  id: string;
  kind: string;
  input: Input;
  origin: JobOrigin;
  /** The subject's name, for the activity sheet. */
  title: string;
  state: JobState;
  waitingFor: JobWait | null;
  progress: JobProgress;
  failure: JobFailure | null;
  /** Failed attempts that count toward the kind's limit. */
  attempts: number;
  retryAt: number | null;
  /** A tracked job is owned elsewhere (sync, the update); the manager only shows it. */
  tracked: boolean;
  /** Words from a tracked job's owner, such as "4 changes saved on this device". */
  detail: string | null;
  /** Worth showing even though the app started it: it needs you. */
  attention: boolean;
  createdAt: number;
  /** When the current run of states began: queued, running, or waiting. */
  changedAt: number;
  finishedAt: number | null;
}

export interface ActivitySnapshot {
  /** Oldest first. A job keeps its object until it changes. */
  jobs: readonly Job[];
  online: boolean;
}

export interface JobContext {
  /** Aborted when the job is cancelled, goes offline, or the manager stops. */
  signal: AbortSignal;
  /** Report progress. Calls are cheap; the manager publishes at most every 100 ms. */
  progress(update: Partial<JobProgress>): void;
  /** Save resume data with the job, for the next attempt or a reload. */
  checkpoint(data: unknown): void;
  /** The last checkpoint, from an earlier attempt or before a reload. */
  resume: unknown;
}

export interface JobKind<Input = unknown> {
  /** Jobs in one lane share its concurrency limit. Default `default`. */
  lane?: string;
  /** Wait while the device is offline. Default true. */
  needsNetwork?: boolean;
  /** Keep the job across reloads. Its input and checkpoints must be JSON. */
  persist?: boolean;
  /** Automatic retries for retryable failures. Default 3 attempts, 2 s doubling to 60 s. */
  retry?: { attempts?: number; initialMs?: number; maxMs?: number };
  /** The subject's name. Start options can override it. */
  title?(input: Input): string;
  /** Turn an error into a failure. The default treats fetch's TypeError as network. */
  classify?(error: unknown): JobFailure;
  /** One attempt. Resolve when done; throw on failure; honour `signal`. */
  run(input: Input, context: JobContext): Promise<void>;
}

/** What a tracked job's owner says now, or null when there is nothing to show. */
export interface TrackedJobView {
  kind: string;
  title: string;
  state: JobState;
  origin?: JobOrigin;
  waitingFor?: JobWait | null;
  progress?: Partial<JobProgress>;
  failure?: JobFailure | null;
  retryAt?: number | null;
  detail?: string | null;
  attention?: boolean;
}

/** A job that something else owns, such as the sync controller or the update. */
export interface TrackedJobSource {
  subscribe(listener: () => void): () => void;
  read(): TrackedJobView | null;
  cancel?(): void;
  retry?(): void;
}

/** The device's network. Trust `false`; `true` is a hint. */
export interface ActivityNetwork {
  isOnline(): boolean;
  subscribe(listener: (online: boolean) => void): () => void;
}

/** localStorage, or a stand-in. */
export interface ActivityStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Timers and time, so tests can run the manager on a fake clock. */
export interface ActivityClock {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export type JobKinds = Record<string, JobKind<any>>;

export type InputOf<K> = K extends JobKind<infer Input> ? Input : never;

export interface StartOptions {
  /** The subject's id. Default: the kind and the input's JSON. */
  id?: string;
  origin?: JobOrigin;
  title?: string;
}
