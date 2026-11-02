import { useCallback, useEffect, useRef, useState } from "react";
import type {
  LivePullRequest,
  PullRequestCheck,
  PullRequestCheckOutcome,
} from "../../shared/protocol";

// The Pull request tab reads GitHub only while someone can see it. A read
// costs several of GitHub's API calls, and the sign-in shares its limit with
// everything else that uses gh, such as the reader's agents.

/** While something changes by itself: checks run, or GitHub works out a merge. */
const BUSY_MS = 30_000;
/** While it waits for people. */
const SETTLED_MS = 2 * 60_000;
/** Once it merged or closed, or when the API limit runs low. */
const SLOW_MS = 5 * 60_000;
const MOST_MS = 15 * 60_000;
/** How often a tab that waits looks again at whether it is on screen. */
const LOOK_MS = 5_000;
/** The share of the API limit under which Med reads slowly. */
const LOW_BUDGET = 0.1;

export const lowBudget = ({ budget }: LivePullRequest) =>
  !!budget && budget.remaining / budget.limit < LOW_BUDGET;

/** How long after `readAt` a tab on screen reads again. Each failed read in a
 * row doubles the wait. */
export function readDelay(pull: LivePullRequest | null, failures: number, readAt: number) {
  const ended = pull?.state === "merged" || pull?.state === "closed";
  const busy =
    !pull ||
    pull.merge.mergeable === "UNKNOWN" ||
    pull.checks.some((check) => check.outcome === "pending");
  const usual = ended ? SLOW_MS : busy ? BUSY_MS : SETTLED_MS;
  const paced = pull && lowBudget(pull) ? Math.max(usual, SLOW_MS) : usual;
  const waiting = Math.min(paced * 2 ** failures, MOST_MS);
  // With no budget left, a read before it fills again can only fail.
  return pull?.budget?.remaining === 0 ? Math.max(waiting, pull.budget.resetAt - readAt) : waiting;
}

export interface LivePullRequestState {
  data: LivePullRequest | null;
  error: string | null;
  loading: boolean;
  /** Reads GitHub now, past the host's short cache. */
  refresh(): void;
}

/**
 * Keeps a pull request current while `active`, and only while `onScreen()`
 * holds: a hidden window or workspace makes no read, and the first look after
 * that reads if the wait is over. A failed read keeps what the tab shows. It
 * holds one pull request: the view mounts anew for another.
 */
export function useLivePullRequest(
  load: (refresh: boolean) => Promise<LivePullRequest>,
  active: boolean,
  onScreen: () => boolean,
  /** Each read starts; the comments follow it. `refresh` skips the host's cache. */
  onRead?: (refresh: boolean) => void,
): LivePullRequestState {
  const [state, setState] = useState<Omit<LivePullRequestState, "refresh">>({
    data: null,
    error: null,
    loading: true,
  });
  const shown = useRef<LivePullRequest | null>(null);
  const failures = useRef(0);
  const readAt = useRef(0);
  const request = useRef(0);
  const reading = useRef(false);
  const read = useCallback(
    (refresh: boolean) => {
      if (reading.current && !refresh) return;
      const id = ++request.current;
      reading.current = true;
      readAt.current = Date.now();
      onRead?.(refresh);
      setState((current) => ({ ...current, loading: true }));
      load(refresh).then(
        (data) => {
          if (request.current !== id) return;
          reading.current = false;
          failures.current = 0;
          shown.current = data;
          setState({ data, error: null, loading: false });
        },
        (error: unknown) => {
          if (request.current !== id) return;
          reading.current = false;
          failures.current += 1;
          setState((current) => ({
            ...current,
            error: error instanceof Error ? error.message : "Could not read the pull request.",
            loading: false,
          }));
        },
      );
    },
    [load, onRead],
  );
  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setTimeout>;
    const look = () => {
      clearTimeout(timer);
      if (
        onScreen() &&
        document.visibilityState === "visible" &&
        Date.now() - readAt.current >= readDelay(shown.current, failures.current, readAt.current)
      )
        read(false);
      timer = setTimeout(look, LOOK_MS);
    };
    look();
    document.addEventListener("visibilitychange", look);
    window.addEventListener("focus", look);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", look);
      window.removeEventListener("focus", look);
    };
  }, [active, onScreen, read]);
  const refresh = useCallback(() => {
    failures.current = 0;
    read(true);
  }, [read]);
  return { ...state, refresh };
}

export type Tone = "good" | "bad" | "warn" | "quiet";

const commits = (count: number) => `${count} ${count === 1 ? "commit" : "commits"}`;

/** What GitHub says of merging, a line for each fact, the most urgent first.
 * GitHub's merge state can read CLEAN on a draft and UNKNOWN once merged, so
 * the pull request's own state goes first. */
export function mergeLines(pull: LivePullRequest): { tone: Tone; text: string }[] {
  const { base, merge, state, checks } = pull;
  if (state === "merged")
    return [
      {
        tone: "good",
        text: `Merged into ${base}${merge.mergedBy ? ` by ${merge.mergedBy}` : ""}.`,
      },
    ];
  if (state === "closed") return [{ tone: "quiet", text: "Closed without merging." }];
  const lines: { tone: Tone; text: string }[] = [];
  const conflicts = merge.mergeable === "CONFLICTING" || merge.status === "DIRTY";
  if (conflicts) lines.push({ tone: "bad", text: `Conflicts with ${base}.` });
  if (merge.status === "BEHIND")
    lines.push({
      tone: "warn",
      text: merge.behindBy
        ? `${commits(merge.behindBy)} behind ${base}. Update the branch to merge.`
        : `Behind ${base}. Update the branch to merge.`,
    });
  else if (merge.behindBy)
    lines.push({ tone: "quiet", text: `${commits(merge.behindBy)} behind ${base}.` });
  if (state === "draft") {
    lines.push({ tone: "quiet", text: "A draft: it cannot merge until it is ready." });
    return lines;
  }
  if (conflicts || merge.status === "BEHIND") return lines;
  if (merge.mergeable === "UNKNOWN" || merge.status === "UNKNOWN")
    lines.unshift({ tone: "quiet", text: "GitHub is working out if it can merge." });
  else if (merge.status === "CLEAN") lines.unshift({ tone: "good", text: "Ready to merge." });
  else if (merge.status === "HAS_HOOKS")
    lines.unshift({ tone: "good", text: "Ready to merge. Hooks run first." });
  else if (merge.status === "UNSTABLE")
    lines.unshift({ tone: "warn", text: "It can merge, but some checks did not pass." });
  else if (merge.status === "BLOCKED")
    lines.unshift({
      tone: "warn",
      text:
        merge.decision === "CHANGES_REQUESTED"
          ? "Blocked: changes requested."
          : checks.some((check) => check.outcome === "failed")
            ? "Blocked: checks did not pass."
            : merge.decision === "REVIEW_REQUIRED"
              ? "Blocked: it needs a review."
              : "Blocked by a branch rule.",
    });
  else lines.unshift({ tone: "quiet", text: `GitHub says: ${wordOf(merge.status)}.` });
  return lines;
}

/** GitHub's word in a sentence's case: IN_PROGRESS reads "In progress". */
function wordOf(word: string) {
  const text = word.toLowerCase().replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const STATE_WORDS: Record<string, string> = {
  FAILURE: "Failed",
  SUCCESS: "Passed",
  IN_PROGRESS: "Running",
  CANCELLED: "Cancelled",
};
export const checkWord = (check: PullRequestCheck) =>
  STATE_WORDS[check.state] ?? wordOf(check.state);

/** The check's time, as "2m 49s"; while it runs, how long so far. A skipped
 * check that GitHub stamps with its end before its start has no time. */
export function checkTime(check: PullRequestCheck, now: number) {
  if (!check.startedAt || check.outcome === "skipped") return "";
  const end = check.completedAt ? Date.parse(check.completedAt) : undefined;
  if (end === undefined && check.outcome !== "pending") return "";
  const seconds = Math.round(((end ?? now) - Date.parse(check.startedAt)) / 1000);
  if (!(seconds > 0)) return "";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

const COUNT_WORDS: Record<PullRequestCheckOutcome, string> = {
  failed: "failed",
  pending: "running",
  cancelled: "cancelled",
  passed: "passed",
  skipped: "skipped",
};
/** "2 failed, 1 running, 9 passed": each kind of check that the list has. */
export function checkCounts(checks: readonly PullRequestCheck[]) {
  return (Object.keys(COUNT_WORDS) as PullRequestCheckOutcome[])
    .map(
      (outcome) => [outcome, checks.filter((check) => check.outcome === outcome).length] as const,
    )
    .filter(([, count]) => count)
    .map(([outcome, count]) => `${count} ${COUNT_WORDS[outcome]}`)
    .join(", ");
}

/** The URL of an image of the description, which the host reads from GitHub. */
export const descriptionImageUrl = (reviewId: string, src: string) =>
  `/api/reviews/${encodeURIComponent(reviewId)}/pull-request-image?src=${encodeURIComponent(src)}`;
