import { observeAuthSession, useAuth } from "@/hooks/use-auth";
import { db, deleteBook as deleteBookFromDb } from "@/lib/db";
import { syncService } from "@/lib/sync-service";
import { subscribeToQueryInvalidation } from "@/lib/query-invalidation";
import { useQueryClient } from "@tanstack/react-query";
import { useSyncStatus } from "@zsh-eng/local-sync/react";
import { liveQuery } from "dexie";
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";

export class SyncUnavailableError extends Error {}

interface SyncContextValue {
  /** Whether a sync is currently in progress */
  isSyncing: boolean;
  /** Trigger a manual sync */
  triggerSync: () => Promise<void>;
  /** Delete a book (syncs deletion to server) */
  deleteBook: (bookId: string) => Promise<void>;
}

const SyncContext = createContext<SyncContextValue | null>(null);

/**
 * Owns the synchronization lifecycle once.
 *
 * This hook:
 * - Refreshes queries after committed database writes, including offline edits
 * - Passes session answers and the outbox size to the sync controller
 * - Runs automatic sync while this device believes a user is signed in,
 *   including a remembered user while offline
 * - Provides manual sync triggers and book operations
 */
export function SyncProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { isAuthenticated } = useAuth();
  const isSyncing = useSyncStatus(
    syncService.controller,
    (status) => status.running,
  );
  useEffect(() => subscribeToQueryInvalidation(queryClient), [queryClient]);
  useEffect(() => observeAuthSession(), []);
  useEffect(() => {
    const pending = liveQuery(() => db._sync_outbox.count()).subscribe({
      next: (count) => syncService.controller.setPending(count),
      error: (error) => console.error("Could not count pending changes", error),
    });
    return () => pending.unsubscribe();
  }, []);

  // A signed-out or ended session stops automatic sync until the next sign-in.
  useEffect(() => {
    if (!isAuthenticated) {
      syncService.stopPeriodicSync();
      return;
    }
    syncService.startPeriodicSync();
    return () => {
      syncService.stopPeriodicSync();
    };
  }, [isAuthenticated]);

  // Manual sync trigger
  const triggerSync = useCallback(async () => {
    if (!isAuthenticated)
      throw new SyncUnavailableError("Sign in to sync your library.");
    const result = await syncService.syncAll();
    if (result.status === "offline")
      throw new SyncUnavailableError("Connect to the internet to sync.");
  }, [isAuthenticated]);

  // The deletion commits locally; sync sends it soon, or after the backoff.
  const deleteBook = useCallback(async (bookId: string) => {
    await deleteBookFromDb(bookId);
    syncService.controller.requestSync();
  }, []);

  const value = useMemo<SyncContextValue>(
    () => ({ isSyncing, triggerSync, deleteBook }),
    [deleteBook, isSyncing, triggerSync],
  );

  return createElement(SyncContext.Provider, { value }, children);
}

export function useSync(): SyncContextValue {
  const context = useContext(SyncContext);
  if (!context) {
    throw new Error("useSync must be used within SyncProvider");
  }
  return context;
}
