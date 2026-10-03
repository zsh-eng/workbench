import { SHARED_STORAGE_SUFFIX } from "../shared-api";
import { getRuntimeStorage } from "@/features/sync-lab/runtime";
import {
  createSyncClientStateStore,
  getOrCreateSyncClientState as initializeState,
  nextSyncHlcBatch as reserveClocks,
  observeSyncHlcBatch as observeClocks,
  type SyncClientState,
  type SyncHlc,
  type SyncKeyValueStorage,
} from "@zsh-eng/local-sync";

export { createSyncClientState } from "@zsh-eng/local-sync";
export type SyncClientStateStorage = SyncKeyValueStorage;
// Preserve the production storage key through the package extraction.
export const SYNC_CLIENT_STATE_STORAGE_KEY =
  "epub-reader-sync-v2-state" + SHARED_STORAGE_SUFFIX;

export function readerSyncStateStore(
  storage: SyncClientStateStorage = getRuntimeStorage(),
) {
  return createSyncClientStateStore(storage, SYNC_CLIENT_STATE_STORAGE_KEY);
}
export function readSyncClientState(
  storage: SyncClientStateStorage = getRuntimeStorage(),
) {
  return readerSyncStateStore(storage).read();
}
export function writeSyncClientState(
  state: SyncClientState,
  storage: SyncClientStateStorage = getRuntimeStorage(),
): void {
  readerSyncStateStore(storage).write(state);
}
export function getOrCreateSyncClientState(
  deviceId: string,
  storage: SyncClientStateStorage = getRuntimeStorage(),
) {
  return initializeState(deviceId, readerSyncStateStore(storage));
}
export function nextSyncHlcBatch(
  count: number,
  storage: SyncClientStateStorage = getRuntimeStorage(),
  now = Date.now(),
) {
  return reserveClocks(count, readerSyncStateStore(storage), now);
}
export function observeSyncHlcBatch(
  timestamps: readonly SyncHlc[],
  storage: SyncClientStateStorage = getRuntimeStorage(),
): void {
  observeClocks(timestamps, readerSyncStateStore(storage));
}
