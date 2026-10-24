import { useEffect, useState, useSyncExternalStore } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  useSyncStatus as useControllerStatus,
  useSyncSummary,
} from "@zsh-eng/local-sync/react";
import { db } from "@/lib/db";
import { files } from "@/lib/files";
import { syncService } from "@/lib/sync-service";

/** Record sync owns the words; file transfer refines them only while records are quiet. */
const QUIET = new Set(["pending", "synced", "idle"]);

/**
 * Record acknowledgement and file transfer are separate completion scopes.
 * The record summary comes from the shared sync controller, so offline,
 * unreachable, ended-session and retry states read the same in every app.
 */
export function useSyncStatus() {
  const summary = useSyncSummary(syncService.controller);
  const online = useControllerStatus(
    syncService.controller,
    (status) => status.connection !== "offline",
  );
  const transfer = useSyncExternalStore(files.subscribe, files.getSnapshot);
  const uploads = useLiveQuery(async () => {
    const operations = await db.fileUploadOperations.toArray();
    return {
      waiting: operations.length,
      failed: operations.filter((item) => item.lastFailure.kind === "failed")
        .length,
    };
  }, []);
  const active =
    summary.busy ||
    transfer.uploading !== null ||
    transfer.downloading.length > 0;
  // Small background exchanges should not flash a spinner in the navigation.
  const [busyVisible, setBusyVisible] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setBusyVisible(active), active ? 200 : 300);
    return () => clearTimeout(timer);
  }, [active]);
  const quiet = QUIET.has(summary.kind);
  const signInAgain = transfer.authRequired && quiet;
  const label = signInAgain
    ? "Sign in again to sync"
    : !quiet
      ? summary.label
      : transfer.uploading
        ? "Uploading files…"
        : transfer.downloading.length
          ? "Downloading files…"
          : uploads?.failed
            ? "Retry file uploads"
            : uploads?.waiting
              ? `${uploads.waiting} files waiting`
              : summary.label;
  const fileDetail = uploads
    ? `Files: ${uploads.waiting} awaiting upload${transfer.downloading.length ? ` · ${transfer.downloading.length} downloading` : ""}.`
    : "";
  return {
    label,
    detail: [summary.detail, fileDetail].filter(Boolean).join(" "),
    online,
    /** What the sync row does: sign in, or sync (retry included). */
    action: signInAgain ? ("sign-in" as const) : summary.action,
    /** Offline, signed out, or failing: worth a word in the navigation. */
    attention: summary.attention || signInAgain || Boolean(uploads?.failed),
    isSyncing: summary.busy,
    busyVisible: busyVisible && active && online,
  };
}
