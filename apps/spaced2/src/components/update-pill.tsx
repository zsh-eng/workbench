import {
  applyUpdate,
  atUpdateMoment,
  startAppUpdate,
  useAppUpdate,
} from "@/lib/app-update";
import { ALL_IMAGES_JOB, imagesActivity } from "@/lib/images/images-activity";
import { reviewSession } from "@/lib/review/session";
import { cn } from "@/lib/utils";
import { useJob } from "@workbench/background-activity/react";
import { Loader2 } from "lucide-react";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { useLocation } from "react-router";
import { toast } from "sonner";

/**
 * Registers the service worker and gives a waiting update its moments:
 * coming back to the app, and moving between pages. After an update it
 * says "Updated" once.
 */
export function UpdateHost() {
  const { pathname } = useLocation();

  useEffect(() => {
    const update = startAppUpdate();
    if (update?.getSnapshot().justUpdated)
      toast.success("Updated", { id: "app-updated" });
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
      atUpdateMoment({ type: "visible", awayMs });
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const previous = useRef(pathname);
  useEffect(() => {
    if (previous.current === pathname) return;
    previous.current = pathname;
    atUpdateMoment({ type: "route" });
  }, [pathname]);

  return null;
}

export type UpdatePillPhase = "ready" | "restarting";

/** "Restart to update", and a short spinner while it restarts. */
export function UpdatePillButton({
  phase,
  onRestart,
  className,
}: {
  phase: UpdatePillPhase;
  onRestart: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onRestart}
      disabled={phase !== "ready"}
      title={
        phase === "ready"
          ? "A new version is ready. Restart now, or it switches by itself the next time you come back."
          : undefined
      }
      className={cn(
        "flex items-center gap-2 h-10 pl-3 pr-4 rounded-full",
        "bg-background dark:bg-muted text-foreground shadow-sm text-sm",
        "animate-fade-in active:scale-95 transition-transform disabled:active:scale-100",
        className,
      )}
    >
      {phase === "ready" ? (
        <span
          aria-hidden="true"
          className="mx-1 size-2 rounded-full bg-primary"
        />
      ) : (
        <Loader2 aria-hidden="true" className="size-4 animate-spin" />
      )}
      <span>{phase === "ready" ? "Restart to update" : "Restarting"}</span>
    </button>
  );
}

/**
 * A waiting update, as one small pill above the tab bar. It stays out of a
 * review: while a card is on the review screen nothing shows, and the update
 * waits. "Download all images" has the same place and goes first.
 */
export default function UpdatePill() {
  const update = useAppUpdate();
  const reviewing = useSyncExternalStore(
    reviewSession.subscribe,
    () => reviewSession.getSnapshot() !== undefined,
  );
  const images = useJob(imagesActivity.manager, ALL_IMAGES_JOB);
  const { pathname } = useLocation();
  const imagesPill =
    images !== undefined &&
    pathname !== "/images" &&
    images.state !== "failed" &&
    images.state !== "cancelled";
  const phase: UpdatePillPhase | null =
    update.status === "applying"
      ? "restarting"
      : update.status === "ready"
        ? "ready"
        : null;
  if (!phase || reviewing || imagesPill) return null;
  return (
    <UpdatePillButton
      phase={phase}
      onRestart={applyUpdate}
      className={cn(
        "fixed z-(--z-index-sticky) left-1/2 -translate-x-1/2 md:left-auto md:right-6 md:translate-x-0",
        "bottom-[calc(var(--tabbar-space)+0.75rem)] md:bottom-6",
      )}
    />
  );
}
