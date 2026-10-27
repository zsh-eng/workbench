import type { Dexie, Table } from "dexie";
import type { SyncJournalEntry, SyncJournalStore } from "../journal.js";

/**
 * Add `_sync_journal: "id"` to the application's schema. It is local only:
 * keep it out of the synced table map.
 */
export const SYNC_JOURNAL_TABLE = "_sync_journal";
export const SYNC_JOURNAL_SCHEMA = "id";

/** The journal in the application's own database, beside its outbox. */
export class DexieSyncJournalStore implements SyncJournalStore {
  private readonly db: Dexie;

  constructor(db: Dexie) {
    this.db = db;
  }

  private get table(): Table<SyncJournalEntry, string> {
    return this.db.table(SYNC_JOURNAL_TABLE);
  }

  load(): Promise<SyncJournalEntry[]> {
    return this.table.toArray();
  }

  async put(entry: SyncJournalEntry): Promise<void> {
    await this.table.put(entry);
  }

  compact(
    decide: (entries: SyncJournalEntry[]) => {
      put: SyncJournalEntry[];
      remove: string[];
    },
  ): Promise<SyncJournalEntry[]> {
    const table = this.table;
    return this.db.transaction("rw", table, async () => {
      const { put, remove } = decide(await table.toArray());
      await table.bulkDelete(remove);
      await table.bulkPut(put);
      return table.toArray();
    });
  }
}
