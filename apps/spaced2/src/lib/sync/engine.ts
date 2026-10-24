import { createLocalSyncState } from "./local-sync-state";
import { API_BASE, SHARED_API_ORIGIN, SHARED_STORAGE_SUFFIX } from "@/lib/api";
import {
  broadcastRecordsChanged,
  broadcastRecordsCleared,
  listenForRecordChanges,
} from "./broadcast";
import Dexie, { liveQuery } from "dexie";
import {
  SyncClient,
  SyncHttpError,
  SyncScopeError,
  createSyncClientState,
  createSyncController,
  type SyncFailure,
  type SyncRunContext,
  type SyncStatus,
} from "@zsh-eng/local-sync";
import { DexieSyncStorage } from "@zsh-eng/local-sync/dexie";
import {
  db,
  rawDb,
  stateStore,
  ensureSyncState,
  STATE_KEY,
  disableLocalWrites,
} from "../db/persistence";
import MemoryDB, { reloadMemory, memoryReady } from "../db/memory";
import { syncTables } from "./records";
import { createRemote } from "./server";
import { withSyncLock, withNetworkSyncLock } from "./lock";

/** The remembered account and last sync time, per API origin. */
const SYNC_STATUS_KEY = "spaced-sync-status" + SHARED_STORAGE_SUFFIX;

/** The snapshot that SyncBoundary and the debug Sync page read. */
type Status = { syncing: boolean; error: string | null; restoring: boolean };
let snapshot: Status = { syncing: false, error: null, restoring: false };
/** Stays true until the first full download finishes, across failed attempts. */
let restoring = false;
const listeners = new Set<() => void>();
let stopped = false,
  started = false,
  bridged = false;
let pending: Promise<void> | undefined;
let stopPending = () => {};

/** One attempt: confirm the account, then pull and push under the network lock. */
async function runSync({ signal, markRestoring }: SyncRunContext) {
  if (stopped) return;
  await withNetworkSyncLock(async () => {
    if (stopped) return;
    await memoryReady;
    let touched = false;
    let localState: ReturnType<typeof createLocalSyncState> | undefined;
    try {
      const response = await fetch(`${API_BASE}/me`, {
        credentials: "include",
        signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
      });
      signal.throwIfAborted();
      // A 401 is the server's answer: no session. The controller pauses sync.
      if (!response.ok) throw new SyncHttpError(response.status, response);
      const { userId, expiresAt, user } = await response.json();
      if (typeof userId !== "string" || !userId)
        throw new Error("Invalid account identity");
      spacedSync.confirmSignedIn({
        userId,
        name: user?.name ?? undefined,
        email: user?.email ?? undefined,
        image: user?.image ?? undefined,
      });
      const state = await withSyncLock(async () => {
        signal.throwIfAborted();
        const owner = await db.metadataKv.get("owner");
        if (owner && owner.value !== userId) {
          if (SHARED_API_ORIGIN)
            throw new SyncScopeError(
              "This local library belongs to another account. Local data was preserved.",
            );
          await rawDb.transaction("rw", rawDb.tables, async () => {
            for (const table of rawDb.tables) await table.clear();
          });
          stateStore.write(createSyncClientState(crypto.randomUUID()));
          MemoryDB._db.undoGradeStack = [];
          await reloadMemory();
        }
        await db.metadataKv.put({ key: "owner", value: userId });
        const expiry = Date.parse(expiresAt);
        if (Number.isFinite(expiry))
          await db.metadataKv.put({ key: "sessionExpiry", value: expiry });
        const state = ensureSyncState();
        await db.metadataKv.put({ key: "syncState", value: 2 });
        if (!(await db.metadataKv.get("clientId")))
          await db.metadataKv.put({ key: "clientId", value: state.deviceId });
        localState = createLocalSyncState(stateStore);
        return state;
      });
      if (!state.bootstrapped) {
        restoring = true;
        markRestoring();
        refresh();
      }
      const storage = new DexieSyncStorage({
        db: rawDb,
        tables: syncTables,
        onEvent: (event) => {
          if (event.outcome === "applied" || event.outcome === "replaced")
            touched = true;
        },
      });
      const locally = <T>(work: () => Promise<T>) =>
        withSyncLock(async () => {
          signal.throwIfAborted();
          localState!.checkpoint();
          return work();
        });
      const client = new SyncClient({
        storage: {
          getPendingChanges: () => locally(() => storage.getPendingChanges()),
          prepareRemoteRecords: (records) =>
            storage.prepareRemoteRecords(records),
          applyRemoteRecords: (records, deviceId) =>
            locally(() => storage.applyRemoteRecords(records, deviceId)),
          reconcilePushResults: (sent, records) =>
            locally(() => storage.reconcilePushResults(sent, records)),
        },
        stateStore: localState!.store,
        remote: createRemote(signal, localState!.store),
        signal,
      });
      await client.sync();

      // Explicit cutover: only discard the old database after successful bootstrap.
      if (!SHARED_API_ORIGIN) {
        for (const legacy of [
          "SpacedDatabase",
          "SpacedRecordsV2",
          "ImageCache",
        ])
          void Dexie.delete(legacy).catch(() => {});
        localStorage.removeItem("spaced-records-v2-state");
      }
    } finally {
      try {
        if (!stopped && localState) {
          await withSyncLock(async () => {
            if (stopped) return;
            localState!.checkpoint();
            if (touched) {
              await reloadMemory();
              broadcastRecordsChanged();
            }
          });
        }
      } finally {
        restoring = restoring && !stateStore.read()?.bootstrapped;
        refresh();
      }
    }
  });
}

/**
 * When Spaced syncs (every 30 s while healthy, on reconnect, on return to the
 * page, with backoff after failures) and what the UI can say about the
 * connection, the account and sync. Read it with `useSyncStatus` or
 * `useSyncSummary` from `@zsh-eng/local-sync/react`.
 */
export const spacedSync = createSyncController({
  run: runSync,
  intervalMs: 30_000,
  persist: { storage: localStorage, key: SYNC_STATUS_KEY },
});

function errorOf(status: SyncStatus): string | null {
  const failure = status.failure;
  if (!failure) return null;
  if (failure.kind === "unauthorized")
    return status.pending ? "Sign in to save pending changes" : null;
  return failureMessage(failure);
}

function failureMessage(failure: SyncFailure): string {
  return "message" in failure
    ? failure.message
    : `Sync failed (${failure.kind})`;
}

/** Keeps the boundary's snapshot stable until one of its fields changes. */
function refresh() {
  const status = spacedSync.getSnapshot();
  const next: Status = {
    syncing: status.running,
    error: errorOf(status),
    restoring,
  };
  if (
    next.syncing === snapshot.syncing &&
    next.error === snapshot.error &&
    next.restoring === snapshot.restoring
  )
    return;
  snapshot = next;
  listeners.forEach((fn) => fn());
}

/** A manual sync. Rejects when it fails, is cancelled, or the device is offline. */
function sync(): Promise<void> {
  if (stopped) return Promise.resolve();
  if (pending) return pending;
  pending = spacedSync.syncNow().then((attempt) => {
    if (attempt.outcome === "offline") throw new Error("Offline");
    if (attempt.outcome === "cancelled")
      throw new DOMException("Sync was cancelled", "AbortError");
    if (attempt.outcome === "failed")
      throw new Error(failureMessage(attempt.failure));
  });
  const reset = () => {
    pending = undefined;
  };
  void pending.then(reset, reset);
  return pending;
}

function start() {
  if (started || stopped) return;
  started = true;
  listenForRecordChanges((cleared) => {
    if (cleared) {
      stopped = true;
      disableLocalWrites();
      spacedSync.stop();
      location.reload();
      return;
    }
    void withSyncLock(async () => {
      if (!stopped) {
        await reloadMemory();
        MemoryDB._db.undoGradeStack = [];
      }
    }).catch(() => {});
  });
  const outbox = liveQuery(() => db._sync_outbox.count()).subscribe({
    next: (count) => spacedSync.setPending(count),
    error: () => {},
  });
  stopPending = () => outbox.unsubscribe();
  spacedSync.start();
}
async function wipeDatabase() {
  stopped = true;
  disableLocalWrites();
  stopPending();
  spacedSync.stop();
  spacedSync.signOut();
  await withSyncLock(async () => {
    rawDb.close();
    await db.delete();
    if (!SHARED_API_ORIGIN)
      for (const legacy of ["SpacedDatabase", "SpacedRecordsV2", "ImageCache"])
        await Dexie.delete(legacy);
    localStorage.removeItem(STATE_KEY);
    broadcastRecordsCleared();
    MemoryDB._db.cards = {};
    MemoryDB._db.decks = {};
    MemoryDB._db.decksToCards = {};
    MemoryDB._db.noteIdToCardIds = {};
    MemoryDB._db.undoGradeStack = [];
    MemoryDB.notify();
  });
}
const SyncEngine = {
  syncToServer: sync,
  syncFromServer: sync,
  start,
  wipeDatabase,
  subscribe(fn: () => void) {
    if (!bridged) {
      bridged = true;
      spacedSync.subscribe(refresh);
    }
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  getSnapshot: () => snapshot,
};
export default SyncEngine;
