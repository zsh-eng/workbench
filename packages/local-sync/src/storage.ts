import type {
  SyncPushChange,
  SyncPullBody,
  SyncPullResponse,
  SyncPushResponse,
  SyncRecord,
  SyncScope,
} from "./protocol.js";

export interface SyncRemote {
  /** Authenticated stream identity. Required by namespaced v3 transports. */
  getScope?(): Promise<SyncScope>;
  /** Optional bounded-window stream. Must honor cancellation, including pending reads. */
  pullStream?(
    deviceId: string,
    request: SyncPullBody,
    signal: AbortSignal,
  ): AsyncIterable<SyncPullResponse>;
  /**
   * Optional: the pages of `pullStream`, of only the keys that start with
   * one of `prefixes`. Yields no pages when the server cannot filter, so
   * the caller does a plain pull. Must honor cancellation.
   */
  pullPrefixed?(
    deviceId: string,
    request: SyncPullBody,
    prefixes: readonly string[],
    signal: AbortSignal,
  ): AsyncIterable<SyncPullResponse>;
  pull(deviceId: string, request: SyncPullBody): Promise<SyncPullResponse>;
  push(
    deviceId: string,
    changes: readonly SyncPushChange[],
  ): Promise<SyncPushResponse>;
}

export interface SyncRunResult {
  pulled: number;
  skipped: number;
  pushed: number;
}

/** What one apply committed. */
export interface SyncApplyResult {
  applied: number;
  skipped: number;
  /** Keys a newer pending local edit kept out, when the storage can name them. */
  keptLocal?: readonly string[];
}

/**
 * Hears what a sync pass committed, after each commit: a page of remote
 * records, and a reconciled push batch. A journal keeps their metadata.
 */
export interface SyncPassObserver {
  pulled(page: {
    records: readonly SyncRecord[];
    keptLocal?: readonly string[];
    /** The device's first download: it has not finished a pull before. */
    restoring: boolean;
  }): void;
  pushed(batch: {
    sent: readonly SyncPushChange[];
    results: SyncPushResponse["results"];
  }): void;
  /**
   * A priority pull has committed its last page: every record with one of
   * the client's `priority` prefixes, as of that pull's head, is stored
   * (or kept by a newer local edit). Heard once, before the full pull's
   * first commit. Not heard when no priority pull runs, or when the server
   * refuses or ignores the prefixes; then only the end of the pull says the
   * records are there.
   */
  prioritized?(): void;
}

export interface SyncOptions {
  /** Hears this pass's commits. A call that joins a running pass is not heard. */
  observer?: SyncPassObserver;
}

/** Optional diagnostic events, emitted after storage changes commit. */
export interface SyncEvent {
  phase: "pull" | "push";
  outcome:
    | "applied"
    | "kept-local"
    | "acknowledged"
    | "replaced"
    | "edited-in-flight";
  key: string;
}

/** Storage adapters validate a complete response before committing any rows.
 * Apply and reconcile must commit domain rows and pending changes atomically.
 * Reconciliation must preserve edits made while the request was in flight.
 */
export interface SyncStorage<Prepared> {
  getPendingChanges(): Promise<SyncPushChange[]>;
  prepareRemoteRecords(records: readonly SyncRecord[]): Prepared;
  applyRemoteRecords(
    prepared: Prepared,
    localDeviceId: string,
  ): Promise<SyncApplyResult>;
  reconcilePushResults(
    sent: readonly SyncPushChange[],
    prepared: Prepared,
  ): Promise<number>;
}
