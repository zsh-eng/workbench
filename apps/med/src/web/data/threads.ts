import { useEffect, useState } from "react";
import { threadListSchema, type Thread, type ThreadList } from "../../shared/threads";
import { createApi } from "./api";
import { orderAttempts } from "./attempts";
import { readBrowserToken } from "./auth";
import { noteFoundSettings } from "./found-threads";
import { readServerEvents } from "./sse";

const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });

/** The list of a host without threads, such as `med review` alone. */
export const NO_THREADS: ThreadList = { threads: [], repositories: [] };

/**
 * The tabs, in the user's order, and the registered repositories. The host
 * sends the list again when a tab or its agent changes; the stream reconnects
 * with a backoff. `null` until the host answers. History is not in it.
 */
export function useThreads(fetcher: typeof fetch): ThreadList | null {
  const [list, setList] = useState<ThreadList | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const api = createApi(fetcher, readBrowserToken());
    void (async () => {
      let delay = 1000;
      while (!signal.aborted) {
        try {
          const response = await api.stream("/api/threads/events", signal);
          // A host without threads lists none.
          if (response.status === 404) return setList(NO_THREADS);
          if (!response.ok || !response.body) throw new Error("The thread stream closed.");
          delay = 1000;
          await readServerEvents(
            response.body,
            (event) => {
              if (event.event !== "state") return;
              const parsed = threadListSchema.safeParse(JSON.parse(event.data));
              if (!parsed.success) return;
              setList(parsed.data);
              noteFoundSettings(parsed.data);
            },
            signal,
            4 * 1024 * 1024,
          );
        } catch {
          if (signal.aborted) return;
        }
        await pause(delay, signal);
        delay = Math.min(delay * 2, 30_000);
      }
    })();
    return () => controller.abort();
  }, [fetcher]);
  return list;
}

export interface ThreadGroup {
  /** The repository's ID, or the checkout for a thread outside a registered one. */
  key: string;
  name: string;
  threads: Thread[];
}

/**
 * Tabs by repository, in the user's order: a group shows where its first tab
 * is, and keeps its tabs' order. The attempts of one task stay together
 * (data/attempts.ts). A tab never moves when its agent's state changes.
 */
export function groupThreads(threads: readonly Thread[]): ThreadGroup[] {
  const groups = new Map<string, ThreadGroup>();
  for (const thread of threads) {
    const key = thread.repository?.id ?? thread.checkout ?? "other";
    const name =
      thread.repository?.name ?? thread.checkout?.split("/").filter(Boolean).at(-1) ?? "Other";
    let group = groups.get(key);
    if (!group) groups.set(key, (group = { key, name, threads: [] }));
    group.threads.push(thread);
  }
  for (const group of groups.values()) group.threads = orderAttempts(group.threads);
  return [...groups.values()];
}

/** The tabs in the sidebar's order, which ⌘1–⌘9 follow. */
export const tabOrder = (threads: readonly Thread[]) =>
  groupThreads(threads).flatMap((group) => group.threads);

/** The user sent a message from Med after the turn ended. */
const answered = (thread: Thread) =>
  !!thread.replied && thread.replied.at > (thread.turn?.endedAt ?? 0);

/** A permission request, `med review wait`, or a question that waits for an answer. */
export const needsYou = (thread: Thread) =>
  thread.state === "waiting" || (!!thread.turn?.asks && !answered(thread));

/** A short age: now, 4m, 3h, 2d, then the date. */
export function shortAge(at: number, now: number) {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
