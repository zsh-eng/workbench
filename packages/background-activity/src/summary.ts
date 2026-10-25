/**
 * What to show, from a snapshot and the time. These are the rules in
 * docs/MODEL.md: work you asked for shows after a short delay and confirms
 * once; work the app started stays quiet unless it needs you; a failure
 * stays until you retry or dismiss it.
 */
import type { ActivitySnapshot, Job } from "./types";

/** Nothing shows for the first half second, so short work never flickers. */
export const SHOW_AFTER_MS = 500;
/** A job that showed while it ran confirms for this long once it is done. */
export const DONE_LINGER_MS = 1_500;

export interface SummaryOptions {
  showAfterMs?: number;
  doneLingerMs?: number;
}

export interface ActivitySummary {
  /** Jobs to show now, most urgent first: failed, needs you, running, waiting, done. */
  shown: readonly Job[];
  /** Shown jobs that still have work to do. */
  active: readonly Job[];
  /** The shown jobs' progress together, 0 to 1, or null when no size is known. */
  fraction: number | null;
  /** Something needs you: a failure, or work that is only on this device. */
  attention: boolean;
  /** An attempt is running, shown or not. */
  busy: boolean;
  /** When the summary next changes by time alone, or null. */
  nextChangeAt: number | null;
}

const RANK: Record<Job["state"], number> = {
  failed: 0,
  waiting: 2,
  running: 3,
  retrying: 3,
  queued: 4,
  done: 5,
  cancelled: 6,
};

/** True for work someone asked for or is waiting for, and for work that needs them. */
export function isNotable(job: Job): boolean {
  return job.origin === "user" || job.attention;
}

/** A job's own progress, 0 to 1, or null when it does not know its size. */
export function jobFraction(job: Job): number | null {
  if (job.state === "done") return 1;
  const { bytes, totalBytes, done, total } = job.progress;
  if (totalBytes !== null && totalBytes > 0)
    return Math.min(1, bytes / totalBytes);
  if (total !== null && total > 0) return Math.min(1, done / total);
  return null;
}

export function summarizeActivity(
  snapshot: ActivitySnapshot,
  now: number,
  options: SummaryOptions = {},
): ActivitySummary {
  const showAfter = options.showAfterMs ?? SHOW_AFTER_MS;
  const linger = options.doneLingerMs ?? DONE_LINGER_MS;
  const shown: Job[] = [];
  let nextChangeAt: number | null = null;
  const later = (at: number) => {
    if (at > now && (nextChangeAt === null || at < nextChangeAt))
      nextChangeAt = at;
  };
  let busy = false;
  for (const job of snapshot.jobs) {
    if (job.state === "running") busy = true;
    if (!isNotable(job) || job.state === "cancelled") continue;
    // Something that needs you shows at once; work shows after the delay.
    const visibleAt = job.attention ? job.createdAt : job.createdAt + showAfter;
    if (job.state === "failed") {
      shown.push(job);
      continue;
    }
    if (job.state === "done") {
      const finishedAt = job.finishedAt ?? job.changedAt;
      // Confirm only what was on screen while it ran.
      if (finishedAt < visibleAt) continue;
      if (now < finishedAt + linger) {
        shown.push(job);
        later(finishedAt + linger);
      }
      continue;
    }
    if (now >= visibleAt) shown.push(job);
    else later(visibleAt);
  }
  shown.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      a.createdAt - b.createdAt ||
      a.id.localeCompare(b.id),
  );
  const active = shown.filter(
    (job) => job.state !== "done" && job.state !== "failed",
  );
  const fractions = shown
    .filter((job) => job.state !== "failed")
    .map(jobFraction)
    .filter((value): value is number => value !== null);
  return {
    shown,
    active,
    fraction:
      active.length === 0 || fractions.length === 0
        ? null
        : fractions.reduce((sum, value) => sum + value, 0) / fractions.length,
    attention: shown.some((job) => job.state === "failed" || job.attention),
    busy,
    nextChangeAt,
  };
}

function rank(job: Job): number {
  if (job.state === "waiting" && job.attention) return 1;
  return RANK[job.state];
}

/** "1.2 MB", "840 KB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${Math.round(bytes / 1_000)} KB`;
  const megabytes = bytes / 1_000_000;
  return `${megabytes < 10 ? megabytes.toFixed(1) : Math.round(megabytes)} MB`;
}

/** "2.1 of 4.6 MB", "12 of 140", or null when nothing is known. */
export function formatProgress(job: Job): string | null {
  const { bytes, totalBytes, done, total } = job.progress;
  if (totalBytes !== null && totalBytes > 0) {
    const of = formatBytes(totalBytes);
    const unit = of.split(" ")[1];
    const part = formatBytes(bytes);
    return part.endsWith(` ${unit}`)
      ? `${part.split(" ")[0]} of ${of}`
      : `${part} of ${of}`;
  }
  if (total !== null && total > 0) return `${done} of ${total}`;
  if (bytes > 0) return formatBytes(bytes);
  return null;
}

/**
 * The state in words, for the activity sheet: "Downloading · 2.1 of 4.6 MB",
 * "Waiting for a connection", "Retrying in 8 s", "Couldn't download".
 */
export function describeJob(job: Job, now: number): string {
  if (job.detail && job.tracked && job.state !== "running") return job.detail;
  switch (job.state) {
    case "queued":
      return "Waiting to start";
    case "waiting":
      return job.waitingFor === "sign-in"
        ? "Sign in to finish"
        : job.waitingFor === "moment"
          ? "Waiting for a good moment"
          : "Waiting for a connection";
    case "running": {
      // The phase names the step ("downloading", "preparing"); a tracked
      // job's owner can say it instead.
      const verb = job.progress.phase
        ? capitalize(job.progress.phase)
        : (job.detail ?? "In progress");
      // A finished transfer followed by a local step shows no count.
      const progress = jobFraction(job) === 1 ? null : formatProgress(job);
      return progress ? `${verb} · ${progress}` : verb;
    }
    case "retrying": {
      const seconds = Math.max(
        1,
        Math.ceil(((job.retryAt ?? now) - now) / 1_000),
      );
      return `Retrying in ${seconds} s`;
    }
    case "failed":
      return job.failure?.reason === "auth"
        ? "Sign in to download"
        : job.failure?.reason === "storage"
          ? "This device is out of space"
          : job.failure?.reason === "network"
            ? "Couldn't reach the server"
            : "Couldn't finish";
    case "done":
      return "Done";
    case "cancelled":
      return "Cancelled";
  }
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
