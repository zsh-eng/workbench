import { restoreIsland } from "@workbench/background-activity";
import { ActivityIsland } from "@workbench/background-activity/island";
import { useSyncStatus } from "@zsh-eng/local-sync/react";
import { useRef, type ReactNode } from "react";
import { useLinksRestored, useSession } from "./state";

const links = (count: number) =>
  `${count.toLocaleString()} ${count === 1 ? "link" : "links"}`;

/**
 * A new device's first pull, as the shared island (packages/background-
 * activity/docs/MODEL.md): it grows out of the mark it wraps, the count by
 * the title or a phone's account button, and says "Getting your library"
 * with the links on this device so far (the library's size is not known
 * until the last page). It waits for a connection or a sign-in, says
 * "Library ready" once the links are in, and folds back into the mark.
 * `align` is the side of the mark it grows from (docs/FIRST_SYNC.md).
 */
export function RestoreIsland({
  count,
  align,
  children,
}: {
  count: number;
  align: "start" | "end";
  children: ReactNode;
}) {
  const { controller } = useSession();
  const restored = useLinksRestored();
  const connection = useSyncStatus(controller, (sync) => sync.connection);
  const auth = useSyncStatus(controller, (sync) => sync.auth.status);
  const failure = useSyncStatus(
    controller,
    (sync) => sync.failure?.kind ?? null,
  );
  const seen = useRef(false);
  if (!restored) seen.current = true;
  const { content, status } = restoreIsland(
    {
      connection,
      auth: { status: auth },
      failure: failure ? { kind: failure } : null,
    },
    restored
      ? null
      : {
          progress: {
            mark: "progress",
            fraction: null,
            label: "Getting your library",
            detail: count > 0 ? links(count) : undefined,
          },
          status: "Getting your library…",
        },
    seen.current,
    "Library ready",
  );
  return (
    <ActivityIsland
      content={content}
      status={status}
      className={`restore-island ${align}`}
    >
      {children}
    </ActivityIsland>
  );
}
