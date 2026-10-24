/**
 * Reader's record sync on the shared sync controller (`@zsh-eng/local-sync`).
 * The controller decides when to sync, backs off after failures, and holds
 * the connection, account and sync status that the UI shows.
 */
import {
  browserSyncNetwork,
  createSyncController,
  type SyncFailure,
  type SyncNetworkSource,
} from "@zsh-eng/local-sync";
import {
  getLabRuntime,
  getRuntimeOnline,
  getRuntimeStorage,
  subscribeRuntimeOnline,
} from "@/features/sync-lab/runtime";
import { getOrCreateDeviceId } from "@/lib/device";
import { SHARED_STORAGE_SUFFIX } from "@/lib/shared-api";
import {
  getOrCreateSyncClientState,
  readSyncClientState,
} from "@/lib/sync-v2/client-state";
import { syncV2SyncDb } from "@/lib/sync-v2/db";
import { SyncV2Client } from "@/lib/sync-v2/sync";

const SYNC_INTERVAL_MS = 30_000;
/** The remembered account and last sync time, per API origin. */
export const SYNC_STATUS_STORAGE_KEY =
  "epub-reader-sync-status" + SHARED_STORAGE_SUFFIX;

export type SyncServiceResult =
  | { status: "offline" }
  | { status: "cancelled" }
  | { status: "completed" };

/** A manual sync failed; `failure` says why in the controller's terms. */
export class SyncFailedError extends Error {
  readonly failure: SyncFailure;
  constructor(failure: SyncFailure) {
    super(
      "message" in failure ? failure.message : `Sync failed (${failure.kind})`,
    );
    this.name = "SyncFailedError";
    this.failure = failure;
  }
}

/** The browser's network, or the Sync Lab's simulated one inside the lab. */
function readerNetwork(): SyncNetworkSource {
  const browser = browserSyncNetwork();
  return {
    isOnline: getRuntimeOnline,
    subscribe(listener) {
      const stopOnline = subscribeRuntimeOnline((online) =>
        listener(online ? "online" : "offline"),
      );
      const stopVisible = browser.subscribe((event) => {
        if (event === "visible") listener(event);
      });
      return () => {
        stopOnline();
        stopVisible();
      };
    },
  };
}

/** Owns automatic record sync for one application lifetime. */
class SyncService {
  readonly controller = createSyncController({
    run: async ({ signal, markRestoring }) => {
      if (!readSyncClientState()?.bootstrapped) markRestoring();
      await new SyncV2Client({
        syncDb: syncV2SyncDb,
        onEvent: getLabRuntime()?.onSyncEvent,
        signal,
      }).sync();
    },
    network: readerNetwork(),
    intervalMs: SYNC_INTERVAL_MS,
    persist: { storage: getRuntimeStorage(), key: SYNC_STATUS_STORAGE_KEY },
  });
  private requested = false;
  private readonly unsubscribers: Array<() => void> = [];

  constructor() {
    getOrCreateSyncClientState(getOrCreateDeviceId());
    if (typeof window === "undefined") return;
    const lab = getLabRuntime();
    if (!lab) return;
    // Lab clients have a synthetic, always signed-in account (see use-auth).
    this.controller.confirmSignedIn({ userId: "sync-lab-user" });
    this.unsubscribers.push(lab.subscribeAutoSync(this.update));
  }

  subscribe = (listener: () => void) => this.controller.subscribe(listener);
  getSnapshot = () => this.controller.getSnapshot();

  /** Sync now, then periodically, on reconnect and on return to the app. */
  startPeriodicSync(): void {
    this.requested = true;
    this.update();
  }

  stopPeriodicSync(): void {
    this.requested = false;
    this.controller.stop();
  }

  dispose(): void {
    this.stopPeriodicSync();
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.controller.dispose();
  }

  /** A manual sync. Rejects with `SyncFailedError` so the caller can say so. */
  async syncAll(): Promise<SyncServiceResult> {
    const attempt = await this.controller.syncNow();
    if (attempt.outcome === "failed") {
      console.error("Sync failed:", attempt.failure);
      throw new SyncFailedError(attempt.failure);
    }
    return {
      status: attempt.outcome === "synced" ? "completed" : attempt.outcome,
    };
  }

  /** Call after stopping the scheduler to wait for issued sync exchanges. */
  drain(): Promise<void> {
    return this.controller.drain();
  }

  private update = (): void => {
    if (this.requested && (getLabRuntime()?.autoSync() ?? true))
      this.controller.start();
    else this.controller.stop();
  };
}

export const syncService = new SyncService();
export { SyncService };
