import { ALL_IMAGES_JOB, imagesActivity } from "@/lib/images/images-activity";
import { cn } from "@/lib/utils";
import { jobFraction } from "@workbench/background-activity";
import { useJob } from "@workbench/background-activity/react";
import { Check, CloudOff } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";

/** A finished download confirms for this long, then the pill leaves. */
const CONFIRM_MS = 1_500;

/** The download's share as a ring that fills; an unknown total sweeps. */
function Ring({ fraction }: { fraction: number | null }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={cn("size-4 -rotate-90", fraction === null && "animate-spin")}
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        fill="none"
        strokeWidth="2.5"
        className="stroke-current opacity-20"
      />
      <circle
        cx="12"
        cy="12"
        r="10"
        fill="none"
        strokeWidth="2.5"
        strokeLinecap="round"
        pathLength={1}
        strokeDasharray="1 1"
        strokeDashoffset={fraction === null ? 0.75 : 1 - fraction}
        className="stroke-current transition-[stroke-dashoffset] duration-200 ease-linear"
      />
    </svg>
  );
}

/**
 * "Download all images" away from the Images page: one small pill above the
 * tab bar that fills as the images arrive. Tap it for the Images page,
 * where the row takes over and the pill steps aside.
 */
export default function ImagesActivityPill() {
  const job = useJob(imagesActivity.manager, ALL_IMAGES_JOB);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const finishedAt = job?.state === "done" ? (job.finishedAt ?? 0) : null;
  const [, setTick] = useState(0);
  useEffect(() => {
    if (finishedAt === null) return;
    const left = finishedAt + CONFIRM_MS - Date.now();
    if (left <= 0) return;
    const timer = setTimeout(() => setTick((tick) => tick + 1), left);
    return () => clearTimeout(timer);
  }, [finishedAt]);
  const confirming =
    finishedAt !== null && Date.now() < finishedAt + CONFIRM_MS;
  const active =
    job &&
    (job.state === "queued" ||
      job.state === "running" ||
      job.state === "retrying" ||
      job.state === "waiting");
  if (!job || (!active && !confirming) || pathname === "/images") return null;
  const { done, total } = job.progress;
  const waiting = job.state === "waiting";
  return (
    <button
      type="button"
      onClick={() => navigate("/images")}
      aria-label={
        waiting
          ? "Images waiting for a connection. Open Images."
          : `Downloading images, ${done} of ${total ?? "?"}. Open Images.`
      }
      className={cn(
        "fixed z-(--z-index-sticky) left-1/2 -translate-x-1/2 md:left-auto md:right-6 md:translate-x-0",
        "bottom-[calc(var(--tabbar-space)+0.75rem)] md:bottom-6",
        "flex items-center gap-2 h-10 pl-3 pr-4 rounded-full",
        "bg-foreground text-background shadow-lg text-sm tabular-nums",
        "animate-fade-in active:scale-95 transition-transform",
      )}
    >
      {confirming ? (
        <Check className="size-4" strokeWidth={2.5} />
      ) : waiting ? (
        <CloudOff className="size-4 opacity-70" />
      ) : (
        <Ring fraction={jobFraction(job)} />
      )}
      <span>
        Images{" "}
        <span className="opacity-60">
          {confirming
            ? "· done"
            : waiting
              ? "· waiting"
              : total === null
                ? "· finding"
                : `· ${done} of ${total}`}
        </span>
      </span>
    </button>
  );
}
