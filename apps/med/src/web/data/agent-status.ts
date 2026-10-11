import { useEffect, useState } from "react";
import { agentStatusesSchema, type AgentStatus } from "../../shared/agent-status";
import { sessionSummariesSchema, type SessionSummary } from "../../shared/session-summary";
import { readBrowserToken } from "./auth";
import { createApi } from "./api";
import { readServerEvents } from "./sse";

const NONE: ReadonlyMap<string, unknown> = new Map();

const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });

/**
 * A host stream that sends one value for each listed review, such as its lead
 * session's state, by review ID while listed. It reconnects with a backoff.
 */
function useReviewStream<T extends { reviewId: string }>(
  path: string,
  reviewIds: readonly string[],
  read: (data: unknown) => T[] | undefined,
  fetcher: typeof fetch,
): { values: ReadonlyMap<string, T>; loaded: boolean } {
  const key = [...new Set(reviewIds)].sort().join(",");
  const [values, setValues] = useState<{ key: string; value: ReadonlyMap<string, T> }>({
    key: "",
    value: new Map(),
  });
  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    const { signal } = controller;
    const api = createApi(fetcher, readBrowserToken());
    void (async () => {
      let delay = 1000;
      while (!signal.aborted) {
        try {
          const response = await api.stream(`${path}?reviews=${encodeURIComponent(key)}`, signal);
          if (!response.ok || !response.body) throw new Error("The status stream closed.");
          delay = 1000;
          await readServerEvents(
            response.body,
            (event) => {
              if (event.event !== "state") return;
              const list = read(JSON.parse(event.data));
              if (list)
                setValues({ key, value: new Map(list.map((value) => [value.reviewId, value])) });
            },
            signal,
            1024 * 1024,
          );
        } catch {
          if (signal.aborted) return;
        }
        await pause(delay, signal);
        delay = Math.min(delay * 2, 30_000);
      }
    })();
    return () => controller.abort();
  }, [path, key, read, fetcher]);
  // With no reviews, there is nothing to wait for.
  return values.key === key
    ? { values: values.value, loaded: true }
    : { values: NONE as ReadonlyMap<string, T>, loaded: !key };
}

const readStatuses = (data: unknown) => agentStatusesSchema.safeParse(data).data?.statuses;
const readSummaries = (data: unknown) => sessionSummariesSchema.safeParse(data).data?.sessions;

/** The lead session's state of each saved review, by review ID, while listed. */
export function useAgentStatuses(
  reviewIds: readonly string[],
  fetcher: typeof fetch,
): ReadonlyMap<string, AgentStatus> {
  return useReviewStream("/api/agent-status/events", reviewIds, readStatuses, fetcher).values;
}

/** Each saved review's lead session with its current turn, for the Sessions page,
 * and whether the host has sent them. */
export function useSessionSummaries(reviewIds: readonly string[], fetcher: typeof fetch) {
  const { values, loaded } = useReviewStream<SessionSummary>(
    "/api/sessions/events",
    reviewIds,
    readSummaries,
    fetcher,
  );
  return { summaries: values, loaded };
}

const SEEN_KEY = "med:agent-seen";

/** The last update of each review's lead session that the user saw. */
export function readSeen(): Record<string, number> {
  try {
    const value = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "{}") as unknown;
    return value && typeof value === "object" ? (value as Record<string, number>) : {};
  } catch {
    return {};
  }
}
export function writeSeen(seen: Record<string, number>) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch {
    /* Storage is full or blocked; unread marks then last for this page only. */
  }
}

/**
 * Which listed reviews have an agent turn that ended after the user last saw
 * the review. The active review counts as seen. A review seen for the first
 * time starts from its current update, so old work does not show as new.
 */
export function finishedUnseen(
  statuses: ReadonlyMap<string, AgentStatus>,
  reviews: { reviewId: string; active: boolean }[],
  seen: Record<string, number>,
) {
  const next: Record<string, number> = {};
  const finished: string[] = [];
  for (const { reviewId, active } of reviews) {
    const status = statuses.get(reviewId);
    const last = seen[reviewId];
    if (!status) {
      if (last !== undefined) next[reviewId] = last;
      continue;
    }
    if (last === undefined || active) next[reviewId] = status.updatedAt;
    else if (status.state === "idle" && status.updatedAt > last) {
      finished.push(reviewId);
      next[reviewId] = status.updatedAt;
    } else next[reviewId] = last;
  }
  return { seen: next, finished };
}
