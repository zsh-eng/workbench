import { EASE_OUT, MOTION } from "@/lib/motion";
import { cn } from "@/lib/utils";
import {
  formatProgress,
  jobFraction,
  type Job,
} from "@workbench/background-activity";
import { useActivitySummary } from "@workbench/background-activity/react";
import { RotateCcw } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useActivityEnvironment, useUpdateState } from "../ActivityContext";
import { ActivitySheetBody } from "../ActivitySheet";
import { DrawnCheck, ProgressRing } from "../marks";
import type { Simulation } from "./simulation";
import { SimCover } from "./SimCover";

interface CoverLook {
  title: string;
  author: string;
  coverUrl?: string;
  tone?: string;
}

const bookOf = (job: Job) => job.id.replace(/^book:/, "");

/** Says "Updated" for two seconds after a restart. */
function useJustUpdated(): boolean {
  const { update: store } = useActivityEnvironment();
  const update = useUpdateState();
  const [shown, setShown] = useState<number | null>(null);
  useEffect(() => {
    if (!update.justUpdated) return;
    const startedAt = store.startedAt;
    if (Date.now() - startedAt > 2_000) return;
    setShown(startedAt);
    const timer = window.setTimeout(() => setShown(null), 2_000);
    return () => window.clearTimeout(timer);
  }, [store, update.justUpdated]);
  return shown !== null;
}

/**
 * A cover flies from the grid into the island when its download starts:
 * the island's mini cover is the same subject, so it must visibly be the
 * same thing. The flight is a clone; the grid keeps its cover.
 */
function useCoverFlights(ids: readonly string[], reduceMotion: boolean) {
  const seen = useRef(new Set<string>());
  useLayoutEffect(() => {
    for (const id of ids) {
      if (seen.current.has(id)) continue;
      seen.current.add(id);
      if (reduceMotion) continue;
      const from = document.querySelector<HTMLElement>(
        `[data-sim-cover="${CSS.escape(id)}"]`,
      );
      const to = document.querySelector<HTMLElement>(
        `[data-island-slot="${CSS.escape(id)}"]`,
      );
      if (!from || !to) continue;
      const a = from.getBoundingClientRect();
      const b = to.getBoundingClientRect();
      if (a.bottom < 0 || a.top > window.innerHeight) continue;
      const clone = from.cloneNode(true) as HTMLElement;
      Object.assign(clone.style, {
        position: "fixed",
        left: `${a.left}px`,
        top: `${a.top}px`,
        width: `${a.width}px`,
        height: `${a.height}px`,
        margin: "0",
        zIndex: "60",
        pointerEvents: "none",
        transformOrigin: "0 0",
        borderRadius: "3px",
        boxShadow: "0 10px 30px -10px rgb(0 0 0 / 0.45)",
      });
      document.body.appendChild(clone);
      to.style.opacity = "0";
      const dx = b.left - a.left;
      const dy = b.top - a.top;
      const scale = b.width / a.width;
      const flight = clone.animate(
        [
          { transform: "translate(0, 0) scale(1)" },
          { transform: `translate(${dx}px, ${dy}px) scale(${scale})` },
        ],
        { duration: 440, easing: `cubic-bezier(${EASE_OUT.join(",")})` },
      );
      flight.onfinish = flight.oncancel = () => {
        clone.remove();
        to.style.opacity = "";
      };
    }
    for (const id of seen.current)
      if (!ids.includes(id)) seen.current.delete(id);
  }, [ids, reduceMotion]);
}

/**
 * One floating surface at the bottom of the Library for everything in the
 * background. Downloads show as a stack of the covers that flew in and one
 * ring; the update, a restore, offline changes and a failure take the same
 * island in turn. Tap to open it into the list; it closes back into itself.
 */
export function ActivityIsland({
  sim,
  looks,
}: {
  sim: Simulation;
  looks: ReadonlyMap<string, CoverLook>;
}) {
  const { source, restart } = useActivityEnvironment();
  const summary = useActivitySummary(source);
  const update = useUpdateState();
  const world = useSyncExternalStore(sim.subscribe, sim.getWorld);
  const justUpdated = useJustUpdated();
  const reduceMotion = useReducedMotion() ?? false;
  const [open, setOpen] = useState(false);

  const books = summary.shown.filter((job) => job.kind === "book-download");
  const failed = books.find((job) => job.state === "failed");
  const active = books.filter(
    (job) => job.state !== "done" && job.state !== "failed",
  );
  const done = books.filter((job) => job.state === "done");
  const restoring = summary.shown.find(
    (job) => job.kind === "sync" && job.progress.phase === "restoring",
  );
  const pending = [...world.pending.values()].reduce((sum, n) => sum + n, 0);
  const stackIds = active.map(bookOf).slice(0, 3);
  useCoverFlights(stackIds, reduceMotion);

  let key: string | null = null;
  let mark: ReactNode = null;
  let label: ReactNode = null;
  let action: ReactNode = null;
  let stack: string[] = [];
  if (failed) {
    key = "failed";
    stack = [bookOf(failed)];
    label = (
      <>
        Couldn’t download <span className="font-medium">{failed.title}</span>
      </>
    );
    action = (
      <IslandButton
        data-island-retry=""
        onClick={() => source.retry(failed.id)}
        label="Retry"
      >
        <RotateCcw className="size-3.5" strokeWidth={2} />
        Retry
      </IslandButton>
    );
  } else if (update.status === "ready" || update.status === "applying") {
    key = "update";
    mark =
      update.status === "applying" ? (
        <ProgressRing fraction={null} size={18} />
      ) : (
        <span className="mx-[5px] size-2 rounded-full bg-[oklch(0.7_0.14_250)]" />
      );
    label = update.status === "applying" ? "Restarting" : "Update ready";
    if (update.status === "ready")
      action = (
        <IslandButton data-island-restart="" onClick={restart} label="Restart">
          Restart
        </IslandButton>
      );
  } else if (justUpdated) {
    key = "updated";
    mark = <DrawnCheck size={18} />;
    label = "Updated";
  } else if (active.length > 0) {
    key = "downloads";
    stack = stackIds;
    const fractions = active
      .map(jobFraction)
      .filter((value): value is number => value !== null);
    const fraction =
      fractions.length > 0
        ? fractions.reduce((sum, value) => sum + value, 0) / fractions.length
        : null;
    const waiting = active.every((job) => job.state === "waiting");
    mark = (
      <ProgressRing
        fraction={fraction}
        size={18}
        className={waiting ? "opacity-50" : undefined}
      />
    );
    label =
      active.length === 1 ? (
        <>
          <span className="font-medium">{active[0]!.title}</span>
          <span className="text-white/60">
            {" "}
            · {waiting ? "waiting" : (formatProgress(active[0]!) ?? "")}
          </span>
        </>
      ) : (
        <>
          <span className="font-medium">{active.length} books</span>
          <span className="text-white/60">
            {" "}
            ·{" "}
            {waiting
              ? "waiting for a connection"
              : fraction !== null
                ? `${Math.round(fraction * 100)}%`
                : "downloading"}
          </span>
        </>
      );
  } else if (restoring) {
    key = "restoring";
    mark = <ProgressRing fraction={null} size={18} />;
    label = (
      <>
        Restoring your library
        <span className="text-white/60">
          {" "}
          · {world.arrived?.length ?? 0} books
        </span>
      </>
    );
  } else if (pending > 0) {
    key = "offline";
    mark = (
      <svg viewBox="0 0 24 16" className="h-[11px] w-[17px]" aria-hidden="true">
        <path
          d="M2.5 8.5 6 12 12.5 4.5"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.9}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
    label = (
      <>
        Offline
        <span className="text-white/60">
          {" "}
          · {pending} {pending === 1 ? "change" : "changes"} saved here
        </span>
      </>
    );
  } else if (done.length > 0) {
    key = "done";
    stack = done.map(bookOf).slice(0, 3);
    mark = <DrawnCheck size={18} />;
    label = (
      <span className="font-medium">
        {done.length === 1 ? done[0]!.title : `${done.length} books`} on this
        device
      </span>
    );
  }

  const visible = key !== null || open;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+16px)] z-50 flex justify-center px-4">
      <AnimatePresence>
        {visible && (
          <motion.div
            key="island"
            layout
            data-activity-island={key ?? "open"}
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1, transition: MOTION.enter }}
            exit={{ opacity: 0, y: 8, scale: 0.96, transition: MOTION.exit }}
            transition={{ layout: MOTION.shape }}
            style={{ borderRadius: open ? 26 : 24 }}
            className={cn(
              "pointer-events-auto overflow-hidden bg-[oklch(0.18_0.01_260)] text-white shadow-[0_18px_40px_-16px_rgb(0_0_0/0.55)]",
              open ? "w-full max-w-[380px]" : "max-w-full",
            )}
          >
            {open ? (
              <motion.div
                key="list"
                initial={{ opacity: 0 }}
                animate={{
                  opacity: 1,
                  transition: { duration: 0.15, delay: 0.08 },
                }}
                className="dark max-h-[60vh] overflow-y-auto p-3 text-foreground"
              >
                <div className="mb-1 flex items-center justify-between px-1">
                  <span className="text-[13px] font-medium text-white">
                    Activity
                  </span>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="h-8 rounded-full px-3 text-[13px] text-white/70 outline-none hover:text-white focus-visible:ring-2 focus-visible:ring-white/60"
                  >
                    Done
                  </button>
                </div>
                <ActivitySheetBody />
              </motion.div>
            ) : (
              <motion.div
                layout="position"
                className="flex h-12 items-center gap-2.5 pr-2 pl-3"
              >
                <button
                  type="button"
                  aria-label="Open activity"
                  onClick={() => setOpen(true)}
                  className="flex min-w-0 items-center gap-2.5 rounded-full text-left outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                >
                  {stack.length > 0 && (
                    <span className="flex shrink-0 items-center">
                      {stack.map((id, index) => {
                        const look = looks.get(id);
                        return (
                          <span
                            key={id}
                            data-island-slot={id}
                            className="block h-[30px] w-[20px] overflow-hidden rounded-[2px] ring-[1.5px] ring-[oklch(0.18_0.01_260)] transition-opacity duration-150"
                            style={{
                              marginLeft: index ? -7 : 0,
                              zIndex: 3 - index,
                            }}
                          >
                            {look && (
                              <SimCover
                                {...look}
                                compact
                                className="size-full"
                              />
                            )}
                          </span>
                        );
                      })}
                    </span>
                  )}
                  <AnimatePresence mode="popLayout" initial={false}>
                    <motion.span
                      key={key ?? "none"}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1, transition: { duration: 0.15 } }}
                      exit={{ opacity: 0, transition: { duration: 0.1 } }}
                      className="flex min-w-0 items-center gap-2"
                    >
                      {mark && (
                        <span className="grid size-[18px] shrink-0 place-items-center">
                          {mark}
                        </span>
                      )}
                      <span className="truncate text-[13.5px] whitespace-nowrap tabular-nums">
                        {label}
                      </span>
                    </motion.span>
                  </AnimatePresence>
                </button>
                {action ?? <span className="w-1" />}
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function IslandButton({
  children,
  label,
  onClick,
  ...data
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
} & Record<`data-${string}`, string>) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-white px-3 text-[13px] font-medium text-[oklch(0.18_0.01_260)] outline-none focus-visible:ring-2 focus-visible:ring-white/60"
      {...data}
    >
      {children}
    </button>
  );
}
