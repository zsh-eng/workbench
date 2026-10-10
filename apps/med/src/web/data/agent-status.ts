import { useEffect, useState } from "react";
import { agentStatusesSchema, type AgentStatus } from "../../shared/agent-status";
import { readBrowserToken } from "./auth";
import { createApi } from "./api";
import { readServerEvents } from "./sse";

const NONE: ReadonlyMap<string, AgentStatus> = new Map();

const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });

/** The lead session's state of each saved review, by review ID, while listed. */
export function useAgentStatuses(
  reviewIds: readonly string[],
  fetcher: typeof fetch,
): ReadonlyMap<string, AgentStatus> {
  const key = [...new Set(reviewIds)].sort().join(",");
  const [statuses, setStatuses] = useState<{
    key: string;
    value: ReadonlyMap<string, AgentStatus>;
  }>({ key: "", value: NONE });
  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    const { signal } = controller;
    const api = createApi(fetcher, readBrowserToken());
    void (async () => {
      let delay = 1000;
      while (!signal.aborted) {
        try {
          const response = await api.stream(
            `/api/agent-status/events?reviews=${encodeURIComponent(key)}`,
            signal,
          );
          if (!response.ok || !response.body) throw new Error("The status stream closed.");
          delay = 1000;
          await readServerEvents(
            response.body,
            (event) => {
              if (event.event !== "state") return;
              const parsed = agentStatusesSchema.safeParse(JSON.parse(event.data));
              if (parsed.success)
                setStatuses({
                  key,
                  value: new Map(parsed.data.statuses.map((status) => [status.reviewId, status])),
                });
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
  }, [key, fetcher]);
  return statuses.key === key ? statuses.value : NONE;
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
