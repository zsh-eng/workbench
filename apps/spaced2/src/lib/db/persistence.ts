import { SHARED_STORAGE_SUFFIX } from "../api";
import { withSyncLock } from "../sync/lock";
import Dexie, { type Table } from "dexie";
import { installSync } from "@zsh-eng/local-sync/dexie";
import {
  createSyncClientState,
  createSyncClientStateStore,
  getOrCreateSyncClientState,
  nextSyncHlcBatch,
  type SyncPushChange,
} from "@zsh-eng/local-sync";
import { syncTables, type StoredOperation } from "../sync/records";

export const DATABASE_NAME = "SpacedRecordsV3" + SHARED_STORAGE_SUFFIX;
export const STATE_KEY = "spaced-records-v3-state" + SHARED_STORAGE_SUFFIX;
export const stateStore = createSyncClientStateStore(localStorage, STATE_KEY);
export function ensureSyncState() {
  return getOrCreateSyncClientState(crypto.randomUUID(), stateStore);
}
export class SpacedDatabase extends Dexie {
  operations!: Table<StoredOperation, string>;
  reviewLogOperations!: Table<StoredOperation, string>;
  _sync_outbox!: Table<SyncPushChange, string>;
  metadataKv!: Table<{ key: string; value: unknown }, string>;
  constructor(name = DATABASE_NAME, captureWrites = false) {
    super(name);
    this.version(1).stores({
      operations: "id, type, timestamp",
      reviewLogOperations: "id, type, timestamp",
      _sync_outbox: "key",
      metadataKv: "key",
    });
    if (captureWrites)
      installSync(this, syncTables, (count) => {
        ensureSyncState();
        return nextSyncHlcBatch(count, stateStore, Date.now());
      });
  }
}
export const db = new SpacedDatabase(DATABASE_NAME, true);
export const rawDb = new SpacedDatabase();

// A cleared IndexedDB must never retain a cursor from an older database.
export const persistenceReady = withSyncLock(async () => {
  if (!(await rawDb.metadataKv.get("syncState"))) {
    stateStore.write(createSyncClientState(crypto.randomUUID()));
    await rawDb.metadataKv.put({ key: "syncState", value: 2 });
  } else {
    ensureSyncState();
  }
});

let writesDisabled = false;
export function disableLocalWrites() {
  writesDisabled = true;
}
export function assertLocalWritesAllowed() {
  if (writesDisabled)
    throw new Error("Local data was cleared. Reload before making changes.");
}
