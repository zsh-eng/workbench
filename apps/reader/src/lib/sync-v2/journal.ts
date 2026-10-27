/**
 * What each sync pass moved, kept on this device: keys, devices and times,
 * never values. The contract is packages/local-sync/docs/SYNC_HISTORY.md.
 */
import { getLabRuntime } from "@/features/sync-lab/runtime";
import { createSyncJournal } from "@zsh-eng/local-sync";
import { DexieSyncJournalStore } from "@zsh-eng/local-sync/dexie";
import { syncV2SyncDb } from "./db";

export const syncJournal = createSyncJournal({
  store: new DexieSyncJournalStore(syncV2SyncDb),
  now: () => getLabRuntime()?.now() ?? Date.now(),
});
