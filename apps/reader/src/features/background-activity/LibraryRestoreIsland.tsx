import { syncService } from "@/lib/sync-service";
import { readSyncClientState } from "@/lib/sync-v2/client-state";
import { restoreIsland } from "@workbench/background-activity";
import { ActivityIsland } from "@workbench/background-activity/island";
import { useSyncStatus } from "@zsh-eng/local-sync/react";
import { useRef, type ReactNode } from "react";

const books = (count: number) =>
  `${count.toLocaleString()} ${count === 1 ? "book" : "books"}`;

/**
 * A new device's restore, as the shared island (packages/background-activity
 * /docs/MODEL.md): it grows out of the activity glyph, says "Restoring
 * library" with the books on this device so far (the restore's size is not
 * known), waits for a connection or a sign-in, says "Restored" once the
 * pull has reached the end, and folds back into the glyph. `align` is the side of the glyph it grows from.
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
  const restoring = useSyncStatus(controller, (sync) => sync.restoring);
  const connection = useSyncStatus(controller, (sync) => sync.connection);
  const auth = useSyncStatus(controller, (sync) => sync.auth.status);
  const failure = useSyncStatus(
    controller,
    (sync) => sync.failure?.kind ?? null,
  );
  const seen = useRef(false);
  if (restoring) seen.current = true;
  // A restore that this page saw start lasts until a pull reaches the end,
  // also while a failed one waits to try again: offline, or signed out.
  const unfinished =
    restoring || (seen.current && !readSyncClientState()?.bootstrapped);
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
