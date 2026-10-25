import { MOTION } from "@/lib/motion";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { useActivityEnvironment, useUpdateState } from "./ActivityContext";
import { DrawnCheck, ProgressRing } from "./marks";

const UPDATED_MS = 2_000;
/** "Updated" belongs to the reload: a Library opened later stays quiet. */
const UPDATED_WITHIN_MS = 10_000;
/** Pages (by start time) that have said "Updated". */
const shownFor = new Set<number>();

/**
 * The update's one element: "Restart to update" while a new version waits,
 * a ring while it restarts, and "Updated" with a check for two seconds
 * after the reload.
 */
export function UpdateChip({
  className,
  floating = false,
}: {
  className?: string;
  /**
   * A phone's header has no room: the chip floats at the bottom of the
   * Library instead, the page's one floating surface.
   */
  floating?: boolean;
}) {
  const { update: store, restart } = useActivityEnvironment();
  const update = useUpdateState();
  const [showUpdated, setShowUpdated] = useState(false);
  useEffect(() => {
    const startedAt = store.startedAt;
    if (!update.justUpdated || shownFor.has(startedAt)) return;
    shownFor.add(startedAt);
    if (Date.now() - startedAt < UPDATED_WITHIN_MS) setShowUpdated(true);
  }, [store, update.justUpdated]);
  useEffect(() => {
    if (!showUpdated) return;
    const timer = window.setTimeout(() => setShowUpdated(false), UPDATED_MS);
    return () => window.clearTimeout(timer);
  }, [showUpdated]);

  const phase =
    update.status === "applying"
      ? "restarting"
      : update.status === "ready"
        ? "ready"
        : showUpdated
          ? "updated"
          : null;

  const chip = (
    <AnimatePresence initial={false}>
      {phase && (
        <motion.button
          key="update"
          type="button"
          disabled={phase !== "ready"}
          onClick={restart}
          animate={{ opacity: 1, scale: 1, y: 0, transition: MOTION.enter }}
          exit={{
            opacity: 0,
            scale: 0.96,
            y: floating ? 6 : 0,
            transition: MOTION.exit,
          }}
          aria-live="polite"
          title={
            phase === "ready"
              ? "A new version is ready. Restart now, or it switches the next time you come back."
              : undefined
          }
          initial={{ opacity: 0, scale: 0.96, y: floating ? 8 : 0 }}
          className={[
            "flex shrink-0 items-center gap-1.5 rounded-full text-[13px] outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none",
            floating
              ? "pointer-events-auto h-11 bg-[oklch(0.18_0.01_260)] pr-4 pl-3 text-white shadow-[0_18px_40px_-16px_rgb(0_0_0/0.55)]"
              : "h-8 bg-foreground/[0.06] pr-3 pl-2 text-foreground hover:bg-foreground/[0.09]",
            className,
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {phase === "ready" ? (
            <span
              aria-hidden="true"
              className="mx-[5px] size-2 rounded-full bg-[oklch(0.62_0.15_250)]"
            />
          ) : phase === "restarting" ? (
            <ProgressRing fraction={null} size={16} />
          ) : (
            <DrawnCheck size={16} />
          )}
          <span>
            {phase === "ready"
              ? "Restart to update"
              : phase === "restarting"
                ? "Restarting"
                : "Updated"}
          </span>
        </motion.button>
      )}
    </AnimatePresence>
  );
  if (!floating) return chip;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+16px)] z-40 flex justify-center px-4">
      {chip}
    </div>
  );
}
