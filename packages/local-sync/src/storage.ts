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
