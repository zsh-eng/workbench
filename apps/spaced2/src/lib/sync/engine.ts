import { createLocalSyncState } from "./local-sync-state";
import { API_BASE, SHARED_API_ORIGIN } from "@/lib/api";
import {
  broadcastRecordsChanged,
  broadcastRecordsCleared,
  listenForRecordChanges,
} from "./broadcast";
import Dexie from "dexie";
import { SyncClient, createSyncClientState } from "@zsh-eng/local-sync";
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

type Status = { syncing: boolean; error: string | null; restoring: boolean };
let status: Status = { syncing: false, error: null, restoring: false };
const listeners = new Set<() => void>();
function setStatus(next: Status) {
  status = next;
  listeners.forEach((fn) => fn());
}
let stopped = false,
  started = false;
let pending: Promise<void> | undefined;
let controller: AbortController | undefined;
let interval: ReturnType<typeof setInterval> | undefined;

function sync(): Promise<void> {
  if (stopped) return Promise.resolve();
  if (pending) return pending;
  pending = withNetworkSyncLock(async () => {
    if (stopped) return;
    await memoryReady;
    controller = new AbortController();

    setStatus({ ...status, syncing: true, error: null });
    let touched = false;
    let localState: ReturnType<typeof createLocalSyncState> | undefined;
    try {
      const response = await fetch(`${API_BASE}/me`, {
        credentials: "include",
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(15000),
        ]),
      });
      controller.signal.throwIfAborted();
      if (response.status === 401) {
        if (await db._sync_outbox.count())
          throw new Error("Sign in to save pending changes");
        return;
      }
      if (!response.ok) throw new Error("Cannot verify sync account");
      const { userId, expiresAt } = await response.json();
      if (typeof userId !== "string" || !userId)
        throw new Error("Invalid account identity");
      const state = await withSyncLock(async () => {
        controller!.signal.throwIfAborted();
        const owner = await db.metadataKv.get("owner");
        if (owner && owner.value !== userId) {
          if (SHARED_API_ORIGIN)
            throw new Error(
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
      setStatus({ ...status, restoring: !state.bootstrapped });
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
          controller!.signal.throwIfAborted();
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
        remote: createRemote(controller.signal, localState!.store),
        signal: controller.signal,
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
    } catch (error) {
      if (!stopped)
        setStatus({
          ...status,
          syncing: false,
          error: error instanceof Error ? error.message : "Sync failed",
        });
      throw error;
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
        setStatus({
          ...status,
          syncing: false,
          restoring: status.restoring && !stateStore.read()?.bootstrapped,
        });
        controller = undefined;
      }
    }
  });
  const reset = () => {
    pending = undefined;
  };
  void pending.then(reset, reset);
  return pending;
}
const background = () => {
  if (navigator.onLine) void sync().catch(() => {});
};
function start() {
  if (started || stopped) return;
  started = true;
  listenForRecordChanges((cleared) => {
    if (cleared) {
      stopped = true;
      disableLocalWrites();
      controller?.abort();
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
  background();
  interval = setInterval(background, 30000);
  window.addEventListener("online", background);
  document.addEventListener("visibilitychange", background);
}
async function wipeDatabase() {
  stopped = true;
  disableLocalWrites();
  controller?.abort();
  if (interval) clearInterval(interval);
  window.removeEventListener("online", background);
  document.removeEventListener("visibilitychange", background);
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
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  getSnapshot: () => status,
};
export default SyncEngine;
