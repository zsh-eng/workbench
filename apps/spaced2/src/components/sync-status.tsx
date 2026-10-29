import { useLocation } from "react-router";
import { useSyncExternalStore, type ReactNode } from "react";
import SyncEngine from "@/lib/sync/engine";

/** The sync state that the boundary reads. The Elements page gives a sample. */
export type SyncStatusSource = Pick<
  typeof SyncEngine,
  "subscribe" | "getSnapshot"
>;

/** Pages that work before the cards are on the device. */
const OPEN_WHILE_RESTORING = ["/profile", "/login-success"];

/**
 * A new device's first download: until its cards are stored, every page
 * but Profile waits; until its review history is stored, Stats waits.
 */
export function SyncBoundary({
  children,
  source = SyncEngine,
}: {
  children: ReactNode;
  source?: SyncStatusSource;
}) {
  const { restoring } = useSyncExternalStore(
    source.subscribe,
    source.getSnapshot,
  );
  const { pathname } = useLocation();
  if (restoring === "cards" && !OPEN_WHILE_RESTORING.includes(pathname))
    return (
      <p role="status" className="col-span-full p-4">
        Restoring your cards…
      </p>
    );
  if (restoring === "history" && pathname === "/stats")
    return (
      <p role="status" className="col-span-full p-4">
        Restoring your review history…
      </p>
    );
  return children;
}

/**
 * On Review while the history restores: what is not yet on the device. At
 * phone width it sits in the card's corner, so the card does not move when
 * it goes; wider, it joins the count badges.
 */
export function HistoryRestoreNote({
  source = SyncEngine,
}: {
  source?: SyncStatusSource;
}) {
  const { restoring } = useSyncExternalStore(
    source.subscribe,
    source.getSnapshot,
  );
  if (restoring !== "history") return null;
  return (
    <p
      role="status"
      className="absolute left-4 top-2 sm:static text-xs text-muted-foreground"
    >
      Restoring review history…
    </p>
  );
}
