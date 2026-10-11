import { useLocation } from "react-router";
import { useSyncExternalStore, type ReactNode } from "react";
import SyncEngine from "@/lib/sync/engine";

/** The sync state that the boundary reads. The Elements page gives a sample. */
export type SyncStatusSource = Pick<
  typeof SyncEngine,
  "subscribe" | "getSnapshot"
>;

export function SyncBoundary({
  children,
  source = SyncEngine,
}: {
  children: ReactNode;
  source?: SyncStatusSource;
}) {
  const status = useSyncExternalStore(source.subscribe, source.getSnapshot);
  const { pathname } = useLocation();
  if (status.restoring && !["/profile", "/login-success"].includes(pathname))
    return (
      <p role="status" className="col-span-full p-4">
        Restoring your cards and review history…
      </p>
    );
  return children;
}
