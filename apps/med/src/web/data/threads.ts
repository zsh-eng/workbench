import { useEffect, useState } from "react";
import { threadListSchema, type Thread, type ThreadList } from "../../shared/threads";
import { createApi } from "./api";
import { readBrowserToken } from "./auth";
import { noteFoundSettings } from "./found-threads";
import { readServerEvents } from "./sse";
import { reconnectPause } from "./reconnect";

/** The list of a host without threads, such as `med review` alone. */
export const NO_THREADS: ThreadList = { threads: [], repositories: [] };

/**
 * The tabs, in the user's order, and the registered repositories. The host
 * sends the list again when a tab or its agent changes; the stream reconnects
 * with a backoff. `null` until the host answers. History is not in it.
 *
 * A thread that did not change keeps its object, so that its row and its
 * workspace render again only for their own thread's changes.
 */
export function useThreads(fetcher: typeof fetch): ThreadList | null {
  const [list, setList] = useState<ThreadList | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const api = createApi(fetcher, readBrowserToken());
    let known = new Map<string, { text: string; thread: Thread }>();
    const keep = (next: ThreadList): ThreadList => {
      const seen = new Map<string, { text: string; thread: Thread }>();
      const threads = next.threads.map((thread) => {
        const text = JSON.stringify(thread);
        const before = known.get(thread.id);
        const kept = before?.text === text ? before.thread : thread;
        seen.set(thread.id, { text, thread: kept });
        return kept;
      });
      known = seen;
      return { ...next, threads };
    };
    void (async () => {
      let attempt = 0;
      while (!signal.aborted) {
        try {
          const response = await api.stream("/api/threads/events", signal);
          // A host without threads lists none.
          if (response.status === 404) return setList(NO_THREADS);
          if (!response.ok || !response.body) throw new Error("The thread stream closed.");
          attempt = 0;
          await readServerEvents(
            response.body,
            (event) => {
              if (event.event !== "state") return;
              const parsed = threadListSchema.safeParse(JSON.parse(event.data));
              if (!parsed.success) return;
              setList(keep(parsed.data));
              noteFoundSettings(parsed.data);
            },
            signal,
            4 * 1024 * 1024,
          );
        } catch {
          if (signal.aborted) return;
        }
        await reconnectPause(attempt++, signal);
      }
    })();
    return () => controller.abort();
  }, [fetcher]);
  return list;
}

/** A row of the sidebar: one agent session, by the thread that stands for
 * it, and the IDs of all its threads when it handed off several reviews.
 * `owner` is the thread that holds the session's name and pin. */
export type SessionRow = Thread & { members?: readonly string[]; owner?: string };

/** The threads that share an agent session, together, each list newest
 * first. One session often hands off several reviews, one for each branch or
 * part of its task, and the sidebar lists sessions (docs/usage/threads.md). */
export function sessionGroups(threads: readonly Thread[]): Thread[][] {
  const parent = threads.map((_, at) => at);
  const root = (at: number): number => (parent[at] === at ? at : (parent[at] = root(parent[at]!)));
  const owner = new Map<string, number>();
  threads.forEach((thread, at) => {
    for (const session of thread.sessions ?? []) {
      const other = owner.get(session.id);
      if (other === undefined) owner.set(session.id, at);
      else parent[root(at)] = root(other);
    }
  });
  const groups = new Map<number, Thread[]>();
  threads.forEach((thread, at) => {
    const key = root(at);
    groups.set(key, [...(groups.get(key) ?? []), thread]);
  });
  return [...groups.values()].map((group) => group.toSorted((a, b) => b.updatedAt - a.updatedAt));
}

/** The thread that holds a session's name and pin: its pinned one, else the
 * one that the reader named, else the first that it handed off. Which review
 * is on screen does not change it. */
export function sessionOwner(group: readonly Thread[]): Thread {
  const time = (thread: Thread) => Date.parse(thread.createdAt) || 0;
  return (
    group.filter((thread) => thread.pinned).toSorted((a, b) => a.pinned! - b.pinned!)[0] ??
    group.find((thread) => thread.agentTitle !== undefined) ??
    group.toSorted((a, b) => time(a) - time(b) || a.updatedAt - b.updatedAt)[0]!
  );
}

/** One row for each session: the thread on screen when it is one of the
 * session's, else its pinned one, else the newest. The row has the session's
 * name and pin, from its owner, and its newest activity. */
export function sessionRows(threads: readonly Thread[], current?: string | null): SessionRow[] {
  return sessionGroups(threads).map((group) => {
    if (group.length === 1) return group[0]!;
    const owner = sessionOwner(group);
    const lead =
      group.find((thread) => thread.id === current) ?? (owner.pinned ? owner : group[0]!);
    const { agentTitle: _agentTitle, pinned: _pinned, ...rest } = lead;
    return {
      ...rest,
      title: owner.title,
      ...(owner.agentTitle !== undefined && { agentTitle: owner.agentTitle }),
      ...(owner.pinned && { pinned: owner.pinned }),
      updatedAt: Math.max(...group.map((thread) => thread.updatedAt)),
      members: group.map((thread) => thread.id),
      owner: owner.id,
    };
  });
}

/** The sessions in the sidebar's order, which ⌘1–⌘9 follow: the pinned ones
 * in the order they were pinned, then the others, newest activity first. */
export const tabOrder = (threads: readonly Thread[], current?: string | null): SessionRow[] => {
  const rows = sessionRows(threads, current);
  return [
    ...rows.filter((thread) => thread.pinned).toSorted((a, b) => a.pinned! - b.pinned!),
    ...rows.filter((thread) => !thread.pinned).toSorted((a, b) => b.updatedAt - a.updatedAt),
  ];
};

export { needsYou } from "../../shared/threads";

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
