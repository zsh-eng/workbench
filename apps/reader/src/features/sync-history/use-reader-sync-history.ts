import { db } from "@/data/database";
import { syncJournal } from "@/lib/sync-v2/journal";
import { useSyncHistory, useSyncJournal } from "@zsh-eng/local-sync/react";
import type { SyncHistory, SyncPendingChange } from "@zsh-eng/local-sync";
import { useLiveQuery } from "dexie-react-hooks";
import { useMemo } from "react";
import { describeReaderRecord, keysIn, lookUpRecords } from "./reader-describe";

const NO_PENDING: readonly SyncPendingChange[] = [];

/**
 * This device's sync history in Reader's words: the journal, the outbox
 * for what still waits, and the rows behind each key for its book.
 * `loaded` is false until the journal and those rows have been read, so
 * titles do not change under the reader.
 */
export function useReaderSyncHistory(): SyncHistory & { loaded: boolean } {
  const journal = useSyncJournal(syncJournal);
  const outbox = useLiveQuery(() => db._sync_outbox.toArray(), []);
  const pending = useMemo(
    () =>
      outbox?.map((change) => ({
        key: change.key,
        at: change.hlc.wallTimeMs,
        deleted: change.isDeleted,
      })) ?? NO_PENDING,
    [outbox],
  );
  const keys = useMemo(
    () => keysIn(journal.entries, pending),
    [journal.entries, pending],
  );
  const lookup = useLiveQuery(() => lookUpRecords(keys), [keys.join("\n")]);
  const describe = useMemo(() => describeReaderRecord(lookup), [lookup]);
  const history = useSyncHistory(syncJournal, { describe, pending });
  return {
    ...history,
    loaded: history.loaded && outbox !== undefined && lookup !== undefined,
  };
}
