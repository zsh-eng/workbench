import { bookJobId } from "@/lib/background-activity";
import { cn } from "@/lib/utils";
import {
  DONE_LINGER_MS,
  describeJob,
  jobFraction,
  type Job,
} from "@workbench/background-activity";
import { useJob } from "@workbench/background-activity/react";
import { CloudOff, RotateCcw } from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";
import { useActivityEnvironment } from "./ActivityContext";
import { DrawnCheck, ProgressRing } from "./marks";

/** True until a finished job has confirmed itself. */
function useStillConfirming(job: Job | undefined): boolean {
  const finishedAt = job?.state === "done" ? (job.finishedAt ?? 0) : null;
  const [, setTick] = useState(0);
  useEffect(() => {
    if (finishedAt === null) return;
    const left = finishedAt + DONE_LINGER_MS - Date.now();
    if (left <= 0) return;
    const timer = window.setTimeout(() => setTick((tick) => tick + 1), left);
    return () => window.clearTimeout(timer);
  }, [finishedAt]);
  return finishedAt !== null && Date.now() < finishedAt + DONE_LINGER_MS;
}

/**
 * A book's download, on its own cover: the cover rests dim while it waits
 * its turn, fills from the bottom as the bytes arrive, holds where it is
 * offline, and draws a check once. A failure leaves a retry mark. Place it
 * over the cover, in the cover's box.
 */
export function CoverActivity({
  bookId,
  className,
  compact = false,
}: {
  bookId: string;
  className?: string;
  /** A list row's small cover: the mark only, no veil. */
  compact?: boolean;
}) {
  const { source } = useActivityEnvironment();
  const job = useJob(source, bookJobId(bookId));
  const confirming = useStillConfirming(job);
  if (!job || job.state === "cancelled") return null;
  if (job.state === "done" && !confirming) return null;
  const fraction = jobFraction(job);
  // A retry looks like the download it continues.
  const state = job.state === "retrying" ? "running" : job.state;
  const label = `${job.title}: ${describeJob(job, Date.now())}`;
  // The fill is the progress. The cover carries a mark only for what the
  // fill cannot say: an unknown size, a wait, a failure, the check.
  const mark =
    compact ||
    state === "done" ||
    state === "failed" ||
    state === "waiting" ||
    (state === "running" && fraction === null);
  return (
    <span
      className={cn("pointer-events-none absolute", className)}
      data-cover-activity={state}
    >
      {!compact && (
        <span
          aria-hidden="true"
          className="ba-cover-veil"
          data-state={state}
          style={
            {
              "--ba-fraction":
                state === "done" ? 1 : state === "queued" ? 0 : (fraction ?? 0),
            } as CSSProperties
          }
        />
      )}
      <span
        role="status"
        aria-label={label}
        className={cn(
          "absolute grid place-items-center rounded-full bg-background/90 text-foreground shadow-[0_1px_3px_rgb(0_0_0/0.16)] backdrop-blur transition-opacity duration-150",
          compact
            ? "-right-1.5 -bottom-1.5 size-4"
            : "right-1.5 bottom-1.5 size-6",
          !mark && "opacity-0",
        )}
      >
        {state === "done" ? (
          <DrawnCheck size={compact ? 10 : 14} />
        ) : state === "failed" ? (
          <button
            type="button"
            aria-label={`Retry ${job.title}`}
            onClick={(event) => {
              event.preventDefault();
              source.retry(job.id);
            }}
            className="pointer-events-auto grid size-full place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <RotateCcw
              className={compact ? "size-2.5" : "size-3.5"}
              strokeWidth={2}
            />
          </button>
        ) : state === "waiting" ? (
          <CloudOff
            className={cn(
              "text-muted-foreground",
              compact ? "size-2.5" : "size-3.5",
            )}
            strokeWidth={2}
          />
        ) : (
          <ProgressRing
            fraction={state === "queued" ? 0 : fraction}
            size={compact ? 10 : 16}
          />
        )}
      </span>
    </span>
  );
}
