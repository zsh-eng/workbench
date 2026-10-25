import {
  getAppUpdate,
  startAppUpdate,
  updateContext,
  updateMoment,
  type UpdateMomentEvent,
} from "@/lib/app-update";
import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { toast } from "sonner";

function atMoment(event: UpdateMomentEvent) {
  const update = getAppUpdate();
  if (!update) return;
  const next = updateMoment(update.getSnapshot(), event, updateContext());
  if (next === "apply") update.apply();
  else if (next === "check") void update.check();
}

/**
 * Registers the service worker, says once that the app works offline, and
 * gives a calm update its safe moments: coming back to the app, and leaving
 * a book. See packages/background-activity/docs/MODEL.md.
 */
export function AppUpdateHost() {
  const { pathname } = useLocation();

  useEffect(() => {
    startAppUpdate({
      onOfflineReady: () =>
        toast.success("Reader is ready offline.", {
          id: "pwa-offline-ready",
          duration: 3000,
        }),
    });
  }, []);

  useEffect(() => {
    let hiddenAt = document.hidden ? Date.now() : null;
    const onVisibility = () => {
      if (document.hidden) {
        hiddenAt = Date.now();
        return;
      }
      if (hiddenAt === null) return;
      const awayMs = Date.now() - hiddenAt;
      hiddenAt = null;
      atMoment({ type: "visible", awayMs });
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const previous = useRef(pathname);
  useEffect(() => {
    const from = previous.current;
    previous.current = pathname;
    if (from !== pathname) atMoment({ type: "route", from });
  }, [pathname]);

  return null;
}
