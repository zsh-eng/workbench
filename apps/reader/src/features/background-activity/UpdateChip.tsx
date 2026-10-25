import { MOTION } from "@/lib/motion";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { useActivityEnvironment, useUpdateState } from "./ActivityContext";
import { DrawnCheck, ProgressRing } from "./marks";

const UPDATED_MS = 2_000;
/** "Updated" belongs to the reload: a Library opened later stays quiet. */
const UPDATED_WITHIN_MS = 10_000;
const shownFor = new WeakSet<object>();

/**
 * The update's one element: "Restart to update" while a new version waits,
 * a ring while it restarts, and "Updated" with a check for two seconds
 * after the reload.
 */
export function UpdateChip({ className }: { className?: string }) {
  const { update: store, restart } = useActivityEnvironment();
  const update = useUpdateState();
  const [showUpdated, setShowUpdated] = useState(false);
  useEffect(() => {
    if (!update.justUpdated || shownFor.has(store)) return;
    shownFor.add(store);
    if (Date.now() - store.startedAt < UPDATED_WITHIN_MS) setShowUpdated(true);
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

  return (
    <AnimatePresence initial={false}>
      {phase && (
        <motion.button
          key="update"
          type="button"
          disabled={phase !== "ready"}
          onClick={restart}
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1, transition: MOTION.enter }}
          exit={{ opacity: 0, scale: 0.96, transition: MOTION.exit }}
          aria-live="polite"
          title={
            phase === "ready"
              ? "A new version is ready. Restart now, or it switches the next time you come back."
              : undefined
          }
          className={[
            "flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-foreground/[0.06] pr-3 pl-2 text-[13px] text-foreground outline-none transition-colors duration-150 hover:bg-foreground/[0.09] focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none",
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
}
