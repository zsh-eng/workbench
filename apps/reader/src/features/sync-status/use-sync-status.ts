import { useEffect, useState, useSyncExternalStore } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { files } from "@/lib/files";
import { syncService } from "@/lib/sync-service";
import {
  getRuntimeOnline,
  subscribeRuntimeOnline,
} from "@/features/sync-lab/runtime";

/** Record acknowledgement and file transfer are separate completion scopes. */
export function useSyncStatus() {
  const record = useSyncExternalStore(
    syncService.subscribe,
    syncService.getSnapshot,
  );
  const transfer = useSyncExternalStore(files.subscribe, files.getSnapshot);
  const counts = useLiveQuery(async () => {
    const [pending, uploads] = await Promise.all([
      db._sync_outbox.count(),
      db.fileUploadOperations.toArray(),
    ]);
    return {
      pending,
      uploads: uploads.length,
      failedUploads: uploads.filter(
        (item) => item.lastFailure.kind === "failed",
      ).length,
    };
  }, []);
  const [online, setOnline] = useState(getRuntimeOnline);
  useEffect(() => subscribeRuntimeOnline(setOnline), []);
  const active =
    record.isSyncing ||
    transfer.uploading !== null ||
    transfer.downloading.length > 0;
  // Small background exchanges should not flash a spinner in the navigation.
  const [busyVisible, setBusyVisible] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setBusyVisible(active), active ? 200 : 300);
    return () => clearTimeout(timer);
  }, [active]);
  const authRequired = record.authRequired || transfer.authRequired;
  const label = !online
    ? "Offline"
    : authRequired
      ? "Sign in again"
      : busyVisible && record.isSyncing
        ? "Syncing reading data…"
        : busyVisible && transfer.uploading
          ? "Uploading files…"
          : busyVisible && transfer.downloading.length
            ? "Downloading files…"
            : record.error
              ? "Retry reading data sync"
              : counts?.pending
                ? `${counts.pending} changes pending`
                : counts?.failedUploads
                  ? "Retry file uploads"
                  : counts?.uploads
                    ? `${counts.uploads} files waiting`
                    : counts && record.lastSyncedAt
                      ? "Reading data synced"
                      : "Sync now";
  const detail = counts
    ? `Reading data: ${counts.pending} pending · Files: ${counts.uploads} awaiting upload${transfer.downloading.length ? ` · ${transfer.downloading.length} downloading` : ""}`
    : "Reading local sync state…";
  return {
    label,
    detail,
    online,
    authRequired,
    /** Offline, signed out, or failing: worth a word in the navigation. */
    attention:
      !online ||
      authRequired ||
      Boolean(record.error) ||
      Boolean(counts?.failedUploads),
    isSyncing: record.isSyncing,
    busyVisible: busyVisible && online && !authRequired,
  };
}
