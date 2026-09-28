import { useLocation } from "react-router";
import { useSyncExternalStore, type ReactNode } from "react";
import SyncEngine from "@/lib/sync/engine";
export function SyncBoundary({ children }: { children: ReactNode }) {
  const status = useSyncExternalStore(
    SyncEngine.subscribe,
    SyncEngine.getSnapshot,
  );
  const { pathname } = useLocation();
  if (status.restoring && !["/profile", "/login-success"].includes(pathname))
    return (
      <p role="status" className="col-span-full p-4">
        Restoring your cards and review history…
      </p>
    );
  return children;
}
