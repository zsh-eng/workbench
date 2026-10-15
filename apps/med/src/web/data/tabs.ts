import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import {
  threadClosedSchema,
  threadHistorySchema,
  threadOpenedSchema,
  type Thread,
  type ThreadSubagent,
} from "../../shared/threads";
import { createApi } from "./api";
import { readBrowserToken } from "./auth";
import { needsYou } from "./threads";

// Open tabs and cold history in the browser: the host's routes, what this
// browser has read, and the rule that closes a tab whose work has landed.
// The host keeps which threads are tabs (src/host/thread-tabs.ts).

const api = (fetcher: typeof fetch) => createApi(fetcher, readBrowserToken());
const post = (body: unknown = {}) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/** Opens a thread as a tab. `restore` puts it back at its old place. */
export const openThread = (id: string, restore: boolean, fetcher: typeof fetch) =>
  api(fetcher)
    .json(`/api/threads/${id}/open`, threadOpenedSchema, post({ restore }))
    .then((result) => result.thread);

/** Sends a tab to history; true when this call closed it. */
export const closeThread = (
  id: string,
  details: { auto?: boolean; removeWorktree?: boolean },
  fetcher: typeof fetch,
) =>
  api(fetcher)
    .json(`/api/threads/${id}/close`, threadClosedSchema, post(details))
    .then((result) => result.closed);

/** Opens the thread that closed last, at its place. */
export const reopenThread = (fetcher: typeof fetch) =>
  api(fetcher)
    .json("/api/threads/reopen", threadOpenedSchema, post())
    .then((result) => result.thread);

export const orderThreads = (order: readonly string[], fetcher: typeof fetch) =>
  api(fetcher).json("/api/threads/order", z.object({ ok: z.boolean() }), post({ order }));

export const deleteThread = (id: string, fetcher: typeof fetch) =>
  api(fetcher).json(`/api/threads/${id}/delete`, z.object({ deleted: z.boolean() }), post());

/** Closed threads and found sessions that are not tabs, newest first. */
export const readHistory = (fetcher: typeof fetch) =>
  api(fetcher)
    .json("/api/threads/history", threadHistorySchema)
    .then((result) => result.threads);

// ------------------------------------------------------------- read state

const SEEN_KEY = "med:thread-seen";
const SINCE_KEY = "med:thread-seen-since";
const SUBAGENTS_SEEN_KEY = "med:subagent-seen";
const SUBAGENTS_SINCE_KEY = "med:subagent-seen-since";

function readJson<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Read marks last for this page. */
  }
}
/** The time of the first visit: what changed before it starts as read. */
function since(key: string) {
  const value = readJson<number>(key, 0);
  if (value) return value;
  const now = Date.now();
  writeJson(key, now);
  return now;
}

export interface ReadState {
  /** A result that the reader has not seen: the thread changed since it was shown. */
  isUnread(thread: Thread): boolean;
  setUnread(thread: Thread, unread: boolean): void;
  /** A subagent's finished result that the reader has not seen. */
  isSubagentUnread(subagent: ThreadSubagent): boolean;
  seeSubagent(subagent: ThreadSubagent): void;
}

/**
 * Which tabs and subagents changed since the reader last looked at them. The
 * thread on screen counts as seen, with its subagents' results. Work from
 * before the first visit starts as seen, so old work does not show as new.
 */
export function useReadState(threads: readonly Thread[], current: string | null): ReadState {
  const [threadsSince] = useState(() => since(SINCE_KEY));
  const [subagentsSince] = useState(() => since(SUBAGENTS_SINCE_KEY));
  const [seen, setSeen] = useState<Record<string, number>>(() => readJson(SEEN_KEY, {}));
  const [agents, setAgents] = useState<Record<string, number>>(() =>
    readJson(SUBAGENTS_SEEN_KEY, {}),
  );
  // The shown thread is seen as it changes, and so are its subagents' results.
  const shown = threads.find((thread) => thread.id === current);
  if (shown && (seen[shown.id] ?? 0) < shown.updatedAt) {
    const next = { ...seen, [shown.id]: shown.updatedAt };
    // Forget threads that are no longer tabs; history reads as seen.
    for (const id of Object.keys(next))
      if (!threads.some((thread) => thread.id === id)) delete next[id];
    setSeen(next);
  }
  const finished = shown?.subagents?.filter(
    (subagent) => subagent.state === "idle" && (agents[subagent.id] ?? 0) < subagent.updatedAt,
  );
  if (finished?.length) {
    const next = { ...agents };
    for (const subagent of finished) next[subagent.id] = subagent.updatedAt;
    // Subagents leave the list after a day; keep the newest marks.
    const kept = Object.entries(next)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 200);
    setAgents(Object.fromEntries(kept));
  }
  useEffect(() => writeJson(SEEN_KEY, seen), [seen]);
  useEffect(() => writeJson(SUBAGENTS_SEEN_KEY, agents), [agents]);
  return useMemo<ReadState>(
    () => ({
      isUnread: (thread) =>
        thread.id !== current &&
        thread.state !== "working" &&
        thread.updatedAt > (seen[thread.id] ?? threadsSince),
      setUnread: (thread, unread) =>
        setSeen((value) => ({
          ...value,
          [thread.id]: unread ? thread.updatedAt - 1 : thread.updatedAt,
        })),
      isSubagentUnread: (subagent) =>
        subagent.state === "idle" && subagent.updatedAt > (agents[subagent.id] ?? subagentsSince),
      seeSubagent: (subagent) =>
        setAgents((value) => ({ ...value, [subagent.id]: subagent.updatedAt })),
    }),
    [agents, current, seen, subagentsSince, threadsSince],
  );
}

/** The subagents that a tab lists: those that work, and finished ones that
 * the reader has not seen. */
export const shownSubagents = (thread: Thread, read: Pick<ReadState, "isSubagentUnread">) =>
  (thread.subagents ?? []).filter(
    (subagent) => subagent.state === "working" || read.isSubagentUnread(subagent),
  );

// ------------------------------------------------------------- auto-close

/** A tab closes on its own only after it has been off screen this long. */
export const AUTO_CLOSE_MS = 5 * 60_000;

/**
 * Whether a tab goes to history on its own: the reader has read it; it is not
 * on screen, does not need the reader, and does not work; and its branch has
 * no commits ahead of its base and no uncommitted changes. A tab whose work
 * Med cannot tell (no `unlanded`) never closes on its own.
 */
export function landed(
  thread: Thread,
  context: { unread: boolean; onScreen: boolean; quietFor: number },
) {
  return (
    !context.unread &&
    !context.onScreen &&
    context.quietFor >= AUTO_CLOSE_MS &&
    !needsYou(thread) &&
    thread.state !== "working" &&
    !!thread.unlanded &&
    thread.unlanded.ahead === 0 &&
    !thread.unlanded.uncommitted
  );
}

// ------------------------------------------------------------- subagents

/** A subagent's tab that the sidebar asks a workspace to show in its Session
 * pane, by the tool call that started it. The workspace takes it once its
 * session has the subagent. */
const subagentRequests = new Map<string, string>();
const subagentListeners = new Set<() => void>();

export function requestSubagentOpen(workspaceId: string, toolCallId: string) {
  subagentRequests.set(workspaceId, toolCallId);
  for (const listener of subagentListeners) listener();
}

/** The workspace's request, without taking it. */
export const peekSubagentOpen = (workspaceId: string) => subagentRequests.get(workspaceId);

/** Takes the workspace's request, once its session shows the subagent. */
export function takeSubagentOpen(workspaceId: string) {
  const request = subagentRequests.get(workspaceId);
  subagentRequests.delete(workspaceId);
  return request;
}

export function subscribeSubagentOpens(listener: () => void) {
  subagentListeners.add(listener);
  return () => {
    subagentListeners.delete(listener);
  };
}
