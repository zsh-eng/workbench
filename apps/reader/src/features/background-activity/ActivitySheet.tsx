import { cn } from "@/lib/utils";
import {
  describeJob,
  jobFraction,
  type Job,
} from "@workbench/background-activity";
import { useActivity, useNow } from "@workbench/background-activity/react";
import { CircleAlert, CloudOff, RotateCcw, X } from "lucide-react";
import type { ReactNode } from "react";
import { useActivityEnvironment, useUpdateState } from "./ActivityContext";
import { DrawnCheck, ProgressRing } from "./marks";

function JobMark({ job }: { job: Job }) {
  if (job.state === "done") return <DrawnCheck size={18} />;
  if (job.state === "failed" || (job.state === "waiting" && job.attention))
    return (
      <CircleAlert
        className="size-[18px] text-[oklch(0.62_0.16_55)]"
        strokeWidth={1.8}
      />
    );
  // A new version waits for you: the update's own blue dot.
  if (job.state === "waiting" && job.waitingFor === "moment")
    return <span className="size-2 rounded-full bg-[oklch(0.62_0.15_250)]" />;
  if (job.state === "waiting")
    return (
      <CloudOff
        className="size-[18px] text-muted-foreground"
        strokeWidth={1.8}
      />
    );
  return (
    <ProgressRing
      fraction={job.state === "queued" ? 0 : jobFraction(job)}
      size={18}
      className={job.state === "queued" ? "opacity-50" : undefined}
    />
  );
}

const ACTION =
  "grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground outline-none transition-colors duration-150 hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring";

function JobRow({ job, now }: { job: Job; now: number }) {
  const { source, restart } = useActivityEnvironment();
  const update = useUpdateState();
  const isUpdate = job.kind === "app-update";
  const line = describeJob(job, now);
  let action: ReactNode = null;
  if (isUpdate && update.status === "ready")
    action = (
      <button
        type="button"
        data-activity-restart=""
        onClick={restart}
        className="h-8 shrink-0 rounded-full bg-foreground px-3 text-[13px] font-medium text-background outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Restart
      </button>
    );
  else if (job.state === "failed" && !job.tracked)
    action = (
      <>
        <button
          type="button"
          aria-label={`Retry ${job.title}`}
          onClick={() => source.retry(job.id)}
          className={ACTION}
        >
          <RotateCcw className="size-4" strokeWidth={1.8} />
        </button>
        <button
          type="button"
          aria-label={`Dismiss ${job.title}`}
          onClick={() => source.dismiss(job.id)}
          className={ACTION}
        >
          <X className="size-4" strokeWidth={1.8} />
        </button>
      </>
    );
  else if (!job.tracked && job.state !== "done" && job.state !== "cancelled")
    action = (
      <button
        type="button"
        aria-label={`Cancel ${job.title}`}
        onClick={() => source.cancel(job.id)}
        className={ACTION}
      >
        <X className="size-4" strokeWidth={1.8} />
      </button>
    );
  return (
    <li className="flex min-h-14 items-center gap-3 py-2">
      <span className="grid size-8 shrink-0 place-items-center">
        <JobMark job={job} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] text-foreground">
          {job.title}
        </span>
        <span
          className={cn(
            "block truncate text-[12.5px] text-muted-foreground tabular-nums",
            (job.state === "failed" || job.attention) &&
              "text-[oklch(0.55_0.14_55)]",
          )}
        >
          {line}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-0.5">{action}</span>
    </li>
  );
}

function Section({
  title,
  jobs,
  now,
}: {
  title: string;
  jobs: readonly Job[];
  now: number;
}) {
  if (jobs.length === 0) return null;
  return (
    <section className="mt-3 first:mt-0">
      <h3 className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
        {title}
      </h3>
      <ul className="divide-y divide-border/60">
        {jobs.map((job) => (
          <JobRow key={job.id} job={job} now={now} />
        ))}
      </ul>
    </section>
  );
}

/**
 * Everything in the background, in words: Now, Waiting, Couldn't finish,
 * Done, and This app (sync and the update). Retry and cancel live here.
 */
export function ActivitySheetBody() {
  const { source } = useActivityEnvironment();
  const snapshot = useActivity(source);
  const now = useNow(true, 1_000);
  const own = snapshot.jobs.filter((job) => !job.tracked);
  const app = snapshot.jobs.filter((job) => job.tracked);
  const groups = {
    now: own.filter(
      (job) =>
        job.state === "running" ||
        job.state === "retrying" ||
        job.state === "queued",
    ),
    waiting: own.filter((job) => job.state === "waiting"),
    failed: own.filter((job) => job.state === "failed"),
    done: own.filter((job) => job.state === "done"),
  };
  const empty = own.length === 0 && app.length === 0;
  return (
    <div className="px-1 pb-2">
      {!snapshot.online && (
        <p className="mb-3 rounded-xl bg-foreground/[0.04] px-3 py-2 text-[12.5px] text-muted-foreground">
          Offline. Downloads continue when you are back online.
        </p>
      )}
      {empty ? (
        <p className="py-8 text-center text-[13px] text-muted-foreground">
          Nothing in the background. Everything is on this device and synced.
        </p>
      ) : (
        <>
          <Section title="Now" jobs={groups.now} now={now} />
          <Section title="Waiting" jobs={groups.waiting} now={now} />
          <Section title="Couldn't finish" jobs={groups.failed} now={now} />
          <Section title="Done" jobs={groups.done} now={now} />
          <Section title="This app" jobs={app} now={now} />
        </>
      )}
    </div>
  );
}
