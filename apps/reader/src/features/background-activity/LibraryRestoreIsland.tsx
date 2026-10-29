import { syncService } from "@/lib/sync-service";
import { readSyncClientState } from "@/lib/sync-v2/client-state";
import { restoreIsland } from "@workbench/background-activity";
import { ActivityIsland } from "@workbench/background-activity/island";
import { useSyncStatus } from "@zsh-eng/local-sync/react";
import { useRef, type ReactNode } from "react";

const books = (count: number) =>
  `${count.toLocaleString()} ${count === 1 ? "book" : "books"}`;

/**
 * Whether this device's restore has not reached its end: a pull that
 * restores now, or one that a reload, an offline start, an ended session
 * or a failed pull left unfinished. Only the account signed in on this
 * device restores, also offline (the remembered user) or once its session
 * has ended. A library without an account, or after a sign-out, is local
 * and does not restore: sign-out keeps the sync state and its scope, so
 * the scope does not say.
 */
export function useRestoreUnfinished(): boolean {
  const { controller } = syncService;
  const restoring = useSyncStatus(controller, (sync) => sync.restoring);
  const auth = useSyncStatus(controller, (sync) => sync.auth.status);
  if (restoring) return true;
  if (auth !== "signed-in" && auth !== "expired") return false;
  // A pull's end, failed or not, publishes `restoring`: read the state then.
  const state = readSyncClientState();
  return state !== null && !state.bootstrapped;
}

/**
 * A new device's restore, as the shared island (packages/background-activity
 * /docs/MODEL.md) at the top centre: it says "Restoring library" with the
 * books on this device so far (the restore's size is not known), waits for
 * a connection or a sign-in, says "Restored" once a pull has reached the
 * end, and folds away, into the activity glyph when it is near.
 */
export function LibraryRestoreIsland({
  count,
  children,
}: {
  count: number;
  children: ReactNode;
}) {
  const { controller } = syncService;
  const unfinished = useRestoreUnfinished();
  const connection = useSyncStatus(controller, (sync) => sync.connection);
  const auth = useSyncStatus(controller, (sync) => sync.auth.status);
  const failure = useSyncStatus(
    controller,
    (sync) => sync.failure?.kind ?? null,
  );
  const seen = useRef(false);
  if (unfinished) seen.current = true;
  // "Restored" only once a pull has reached the end, not after a sign-out.
  const ended =
    seen.current && !unfinished && !!readSyncClientState()?.bootstrapped;
  const { content, status } = restoreIsland(
    {
      connection,
      auth: { status: auth },
      failure: failure ? { kind: failure } : null,
    },
    unfinished
      ? {
          progress: {
            mark: "progress",
            fraction: null,
            label: "Restoring library",
            detail: count > 0 ? books(count) : undefined,
          },
          status: "Restoring your library…",
        }
      : null,
    ended,
  );
  return (
    <ActivityIsland content={content} status={status}>
      {children}
    </ActivityIsland>
  );
}
