import { SHARED_API_ORIGIN } from "./shared-api";
import { SyncHttpError } from "@zsh-eng/local-sync";
/** Application lifecycle wrapper around the small sync v2 client. */

import {
  getLabRuntime,
  getRuntimeOnline,
  subscribeRuntimeOnline,
} from "@/features/sync-lab/runtime";
import { getOrCreateDeviceId } from "@/lib/device";
import { getOrCreateSyncClientState } from "@/lib/sync-v2/client-state";
import { syncV2SyncDb } from "@/lib/sync-v2/db";
import {
  SyncV2Client,
  type SyncV2RunResult,
  SyncRemoteRequestError,
} from "@/lib/sync-v2/sync";

const SYNC_INTERVAL_MS = 30_000;
export type SyncServiceResult =
  | { status: "offline" }
  | ({ status: "completed" } & SyncV2RunResult);

export interface SyncServiceState {
  isSyncing: boolean;
  lastSyncedAt: Date | null;
  error: Error | null;
  authRequired: boolean;
}

/** Owns automatic sync and its subscriptions for one application lifetime. */
class SyncService {
  private controller: AbortController | undefined;
  private state: SyncServiceState = {
    isSyncing: false,
    lastSyncedAt: null,
    error: null,
    authRequired: false,
  };
  private readonly listeners = new Set<() => void>();
  private activeRun: Promise<SyncServiceResult> | null = null;
  private sessionId: string | undefined;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.state;
  private publish(update: Partial<SyncServiceState>) {
    this.state = { ...this.state, ...update };
    this.listeners.forEach((listener) => listener());
  }
  private readonly pendingRuns = new Set<Promise<SyncServiceResult>>();
  private isOnline = getRuntimeOnline();
  private syncInterval: number | null = null;
  private requestedInterval: number | null = null;
  private readonly unsubscribers: Array<() => void> = [];

  constructor() {
    getOrCreateSyncClientState(getOrCreateDeviceId());
    if (typeof window === "undefined") return;
    this.unsubscribers.push(subscribeRuntimeOnline(this.handleOnline));
    const lab = getLabRuntime();
    if (lab)
      this.unsubscribers.push(lab.subscribeAutoSync(this.updatePeriodicSync));
  }

  startPeriodicSync(intervalMs = SYNC_INTERVAL_MS): void {
    this.requestedInterval = intervalMs;
    this.updatePeriodicSync();
  }

  /** A confirmed new session can recover 401 failures, including while offline. */
  setSessionIdentity(sessionId: string | undefined): void {
    if (sessionId === undefined || sessionId === this.sessionId) return;
    this.sessionId = sessionId;
    this.publish({ authRequired: false, error: null });
  }

  stopPeriodicSync(): void {
    this.requestedInterval = null;
    this.clearInterval();
    if (SHARED_API_ORIGIN) this.controller?.abort();
  }

  dispose(): void {
    this.stopPeriodicSync();
    for (const unsubscribe of this.unsubscribers) unsubscribe();
  }

  syncAll(): Promise<SyncServiceResult> {
    if (!this.isOnline) return Promise.resolve({ status: "offline" });
    if (this.activeRun) return this.activeRun;
    const sessionId = this.sessionId;
    this.publish({ isSyncing: true, error: null, authRequired: false });
    const controller = new AbortController();
    this.controller = controller;
    const client = new SyncV2Client({
      syncDb: syncV2SyncDb,
      onEvent: getLabRuntime()?.onSyncEvent,
      signal: SHARED_API_ORIGIN ? controller.signal : undefined,
    });
    const run: Promise<SyncServiceResult> = client
      .sync()
      .then((result) => {
        if (SHARED_API_ORIGIN) controller.signal.throwIfAborted();
        this.publish({ lastSyncedAt: new Date(), error: null });
        return { status: "completed" as const, ...result };
      })
      .catch((failure) => {
        const error =
          failure instanceof Error ? failure : new Error(String(failure));
        if (sessionId === this.sessionId)
          this.publish({
            error,
            authRequired:
              (error instanceof SyncRemoteRequestError ||
                error instanceof SyncHttpError) &&
              error.status === 401,
          });
        throw error;
      })
      .finally(() => {
        this.pendingRuns.delete(run);
        this.activeRun = null;
        this.publish({ isSyncing: false });
        // A session change can join an exchange issued with the old credentials.
        if (sessionId !== this.sessionId && this.syncInterval !== null)
          this.runAutomaticSync();
      });
    this.activeRun = run;
    this.pendingRuns.add(run);
    return run;
  }

  /** Call after stopping the scheduler to wait for issued sync exchanges. */
  async drain(): Promise<void> {
    while (this.pendingRuns.size > 0)
      await Promise.allSettled(this.pendingRuns);
  }

  private clearInterval(): void {
    if (this.syncInterval === null) return;
    window.clearInterval(this.syncInterval);
    this.syncInterval = null;
  }

  private updatePeriodicSync = (): void => {
    const enabled = getLabRuntime()?.autoSync() ?? true;
    if (!enabled || this.requestedInterval === null) {
      this.clearInterval();
      return;
    }
    if (this.syncInterval !== null || typeof window === "undefined") return;
    this.syncInterval = window.setInterval(
      this.runAutomaticSync,
      this.requestedInterval,
    );
    this.runAutomaticSync();
  };

  private runAutomaticSync = (): void => {
    if (this.state.authRequired) return;
    void this.syncAll().catch((error) =>
      console.error("Automatic sync failed:", error),
    );
  };

  private handleOnline = (online: boolean): void => {
    this.isOnline = online;
    if (!online || this.syncInterval === null) return;
    this.runAutomaticSync();
  };
}

export const syncService = new SyncService();
export { SyncService };
