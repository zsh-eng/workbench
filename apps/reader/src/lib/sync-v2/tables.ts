import {
  assertBookSyncValue,
  normalizeBookFileReferences,
} from "@/lib/book-file-references";
import { decodeSyncValue } from "@zsh-eng/local-sync";
import type { SyncTableMap } from "@zsh-eng/local-sync/dexie";

/**
 * Reader owns the table set and its domain-specific wire conversions. The
 * middleware rejects a value that one record cannot hold with a typed
 * SyncValueTooLargeError; `syncedBookRow` keeps Book rows within it.
 */
export const READER_SYNC_TABLES = {
  books: {
    schemaVersion: 1,
    encode(row) {
      assertBookSyncValue(row);
      return JSON.stringify(row);
    },
    decode(value) {
      return normalizeBookFileReferences(decodeSyncValue(value));
    },
  },
  readingCheckpoints: { schemaVersion: 1 },
  readingSessions: { schemaVersion: 1 },
  highlights: { schemaVersion: 1 },
  readingSettings: { schemaVersion: 1 },
  readingState: { schemaVersion: 1 },
  notes: { schemaVersion: 1 },
} satisfies SyncTableMap;

export const SYNC_V2_SYNCED_TABLES = Object.keys(
  READER_SYNC_TABLES,
) as (keyof typeof READER_SYNC_TABLES)[];
