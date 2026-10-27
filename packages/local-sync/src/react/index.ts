/**
 * React bindings for the sync status store. React is an optional peer; the
 * core entry point has no React import.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { SyncController } from "../controller.js";
import {
  summarizeSyncHistory,
  type SyncHistory,
  type SyncHistoryOptions,
} from "../history.js";
import type { SyncJournal, SyncJournalSnapshot } from "../journal.js";
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

type SyncJournalSource = Pick<SyncJournal, "subscribe" | "getSnapshot">;

/**
 * The journal's entries. Mounting the first view reads the store again, so
 * it includes passes other tabs wrote.
 */
export function useSyncJournal(
  journal: SyncJournalSource,
): SyncJournalSnapshot {
  return useSyncExternalStore(
    journal.subscribe,
    journal.getSnapshot,
    journal.getSnapshot,
  );
}

/**
 * The journal in groups (`summarizeSyncHistory`): lost edits, what waits
 * here, then what came from each device and what this device sent. Pass a
 * stable `describe` and `pending`; a new one regroups.
 */
export function useSyncHistory(
  journal: SyncJournalSource,
  options: Omit<SyncHistoryOptions, "now"> = {},
): SyncHistory & { loaded: boolean } {
  const snapshot = useSyncJournal(journal);
  const { describe, pending, gapMs, kindOf, dayOf } = options;
  return useMemo(
    () => ({
      ...summarizeSyncHistory(snapshot.entries, {
        now: Date.now(),
        ...(describe ? { describe } : {}),
        ...(pending ? { pending } : {}),
        ...(gapMs !== undefined ? { gapMs } : {}),
        ...(kindOf ? { kindOf } : {}),
        ...(dayOf ? { dayOf } : {}),
      }),
      loaded: snapshot.loaded,
    }),
    [snapshot, describe, pending, gapMs, kindOf, dayOf],
  );
}
