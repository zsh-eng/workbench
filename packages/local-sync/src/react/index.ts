/**
 * React bindings for the sync status store. React is an optional peer; the
 * core entry point has no React import.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { SyncController } from "../controller.js";
import {
  describeSyncStatus,
  type SyncStatus,
  type SyncSummary,
} from "../status.js";

type SyncStatusSource = Pick<SyncController, "subscribe" | "getSnapshot">;

/** The controller's current status; re-renders on every change. */
export function useSyncStatus(controller: SyncStatusSource): SyncStatus;
/**
 * One part of the status, such as `(status) => status.auth`; re-renders only
 * when that part changes. Unchanged parts keep their object identity.
 */
export function useSyncStatus<T>(
  controller: SyncStatusSource,
  select: (status: SyncStatus) => T,
): T;
export function useSyncStatus<T>(
  controller: SyncStatusSource,
  select?: (status: SyncStatus) => T,
): SyncStatus | T {
  const read = () => {
    const status = controller.getSnapshot();
    return select ? select(status) : status;
  };
  return useSyncExternalStore(controller.subscribe, read, read);
}

/**
 * The status in words. Re-renders each second while a retry countdown shows,
 * and every 30 s while "Synced N min ago" shows.
 */
export function useSyncSummary(controller: SyncStatusSource): SyncSummary {
  const status = useSyncStatus(controller);
  const tick =
    status.retryAt !== null
      ? 1_000
      : status.lastSyncedAt !== null
        ? 30_000
        : null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (tick === null) return;
    const timer = setInterval(() => setNow(Date.now()), tick);
    return () => clearInterval(timer);
  }, [tick, status]);
  return useMemo(() => describeSyncStatus(status, now), [status, now]);
}
