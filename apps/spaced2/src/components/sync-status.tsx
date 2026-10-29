import { matchPath, useLocation } from "react-router";
import { useRef, useSyncExternalStore, type ReactNode } from "react";
import { ActivityIsland } from "@workbench/background-activity/island";
import { useSyncStatus } from "@zsh-eng/local-sync/react";
import SyncEngine, { spacedSync } from "@/lib/sync/engine";
import { restoreStage } from "@/lib/sync/restore-island";
import { restoreIsland } from "@workbench/background-activity";
import { cn } from "@/lib/utils";

/** The sync state that the boundary and the island read. The Elements page gives a sample. */
export type SyncStatusSource = Pick<
  typeof SyncEngine,
  "subscribe" | "getSnapshot"
>;

/** Pages that work before the cards are on the device. */
const OPEN_WHILE_RESTORING = ["/profile", "/login-success"];

/**
 * A new device's first download: until its cards are stored, every page
 * but Profile keeps its frame and waits; until its review history is
 * stored, Stats waits. The island beside the icon says what is happening.
 */
export function SyncBoundary({
  children,
  source = SyncEngine,
}: {
  children: ReactNode;
  source?: SyncStatusSource;
}) {
  const restoring = useSyncExternalStore(
    source.subscribe,
    () => source.getSnapshot().restoring,
  );
  const { pathname } = useLocation();
  const stats = matchPath("/stats", pathname) !== null;
  if (restoring === "cards" && !OPEN_WHILE_RESTORING.includes(pathname))
    return (
      <RestoreFrame
        page={stats ? "stats" : matchPath("/", pathname) ? "review" : "list"}
      />
    );
  if (restoring === "history" && stats) return <RestoreFrame page="stats" />;
  return children;
}

/**
 * A page's frame while its records restore: the shape it will have, quiet
 * and still, so nothing moves when the page arrives. No words: the island
 * says what is happening.
 */
export function RestoreFrame({ page }: { page: "review" | "stats" | "list" }) {
  const surface = "rounded-2xl bg-background/60 dark:bg-muted/30 dark:border";
  return (
    <div
      aria-busy="true"
      data-restore-frame={page}
      className="col-span-12 md:col-start-3 md:col-end-11 md:mt-12 mb-6 grid gap-2"
    >
      {page === "review" && (
        <div className={cn(surface, "h-[min(68svh,560px)] medium:shadow-lg")} />
      )}
      {page === "stats" &&
        ["h-24", "h-40", "h-56", "h-56"].map((height, index) => (
          <div key={index} className={cn(surface, height)} />
        ))}
      {page === "list" &&
        Array.from({ length: 5 }, (_, index) => (
          <div key={index} className={cn(surface, "h-16")} />
        ))}
    </div>
  );
}

/** The parts of sync's status that the island reads. */
export type RestoreSync = Parameters<typeof restoreIsland>[0];

/**
 * The restore, as the island at the top centre, which folds into
 * `children` (the Spaced icon and its due count) when the restore is done.
 */
export function RestoreIsland({
  children,
  className,
  source = SyncEngine,
  sync: given,
}: {
  children: ReactNode;
  className?: string;
  source?: SyncStatusSource;
  sync?: RestoreSync;
}) {
  const status = useSyncExternalStore(source.subscribe, source.getSnapshot);
  const connection = useSyncStatus(spacedSync, (sync) => sync.connection);
  const auth = useSyncStatus(spacedSync, (sync) => sync.auth.status);
  const failure = useSyncStatus(
    spacedSync,
    (sync) => sync.failure?.kind ?? null,
  );
  const seen = useRef(false);
  if (status.restoring) seen.current = true;
  const { content, status: words } = restoreIsland(
    given ?? {
      connection,
      auth: { status: auth },
      failure: failure ? { kind: failure } : null,
    },
    restoreStage(status),
    seen.current,
  );
  return (
    <ActivityIsland content={content} status={words} className={className}>
      {children}
    </ActivityIsland>
  );
}
