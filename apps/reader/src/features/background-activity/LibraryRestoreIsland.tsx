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
 * restores now, or one that an account began here and that a reload, an
 * offline start, a sign-in or a failed pull left unfinished. Only an
 * account restores: one that this device has begun to sync with (the
 * state's scope), or the one signed in now. A library without an account
 * is local and never restores.
 */
export function useRestoreUnfinished(): boolean {
  const { controller } = syncService;
  const restoring = useSyncStatus(controller, (sync) => sync.restoring);
  const auth = useSyncStatus(controller, (sync) => sync.auth.status);
  if (restoring) return true;
  // A pull's end, failed or not, publishes `restoring`: read the state then.
  const state = readSyncClientState();
  return (
    state !== null &&
    !state.bootstrapped &&
    (state.scope !== undefined || auth === "signed-in" || auth === "expired")
  );
}

/**
 * A new device's restore, as the shared island (packages/background-activity
 * /docs/MODEL.md): it grows out of the activity glyph, says "Restoring
 * library" with the books on this device so far (the restore's size is not
 * known), waits for a connection or a sign-in, says "Restored" once a pull
 * has reached the end, and folds back into the glyph. `align` is the side
 * of the glyph it grows from.
 */
export function LibraryRestoreIsland({
  count,
  align,
  children,
}: {
  count: number;
  align: "start" | "end";
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
    seen.current,
  );
  return (
    <ActivityIsland
      content={content}
      status={status}
      className={
        align === "end"
          ? "[--ba-island-left:100%] [--ba-island-shift:-100%]"
          : "[--ba-island-left:0] [--ba-island-shift:0]"
      }
    >
      {children}
    </ActivityIsland>
  );
}
