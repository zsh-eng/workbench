import { useEffect, useMemo, useRef, useState } from "react";
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
// The host keeps which threads are tabs (src/host/thread-store.ts).

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

/** Names a thread in Med; an empty name gives it its agent's title again. */
export const renameThread = (id: string, name: string, fetcher: typeof fetch) =>
  api(fetcher).json(`/api/threads/${id}/name`, z.object({ ok: z.boolean() }), post({ name }));

/** Pins a thread at `at` among the pins (from 0; under the others without
 * it), moves a pinned one there, or unpins it. */
export const pinThread = (id: string, pinned: boolean, fetcher: typeof fetch, at?: number) =>
  api(fetcher).json(
    `/api/threads/${id}/pin`,
    z.object({ ok: z.boolean() }),
    post({ pinned, ...(at !== undefined && { at }) }),
  );

export const deleteThread = (id: string, fetcher: typeof fetch) =>
  api(fetcher).json(`/api/threads/${id}/delete`, z.object({ deleted: z.boolean() }), post());

/** Closed threads and found sessions that are not tabs, newest first. */
export const readHistory = (fetcher: typeof fetch) =>
  api(fetcher)
    .json("/api/threads/history", threadHistorySchema)
    .then((result) => result.threads);

// ------------------------------------------------------------- read state

// The host keeps what the reader saw of each tab, by the tab's `updatedAt`
// (`Thread.seen`, src/host/thread-store.ts), so every window and the CLI agree
// on what is new. This browser keeps marks for subagents' results only. The
// marks that it kept for tabs before go to the host once.

const OLD_SEEN_KEY = "med:thread-seen";
const OLD_SINCE_KEY = "med:thread-seen-since";
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

/** Tells the host that the reader saw a tab's changes up to `at`. */
export const seeThread = (id: string, at: number, fetcher: typeof fetch) =>
  api(fetcher).json(`/api/threads/${id}/seen`, z.object({ ok: z.boolean() }), post({ at }));

/** The marks that this browser kept for tabs before the host kept them, for
 * the tabs listed: a tab without one counts as seen up to the first visit. */
function oldMarks(threads: readonly Thread[]) {
  const first = readJson<number>(OLD_SINCE_KEY, 0);
  if (!first) return undefined;
  const marks = readJson<Record<string, number>>(OLD_SEEN_KEY, {});
  return Object.fromEntries(
    threads
      .filter((thread) => thread.seen !== undefined)
      .map((thread) => [thread.id, marks[thread.id] ?? first]),
  );
}

export interface ReadState {
  /** A result that the reader has not seen: the thread changed since it was shown. */
  isUnread(thread: Thread): boolean;
  setUnread(thread: Thread, unread: boolean): void;
  /** A subagent's finished result that the reader has not seen. */
  isSubagentUnread(subagent: ThreadSubagent): boolean;
  seeSubagent(subagent: ThreadSubagent): void;
}

/** A mark that this window sent, until the host's list has it: `base` is
 * the host's mark when it went. One that the host refused counts no longer,
 * and the window does not send it again. */
interface SentMark {
  at: number;
  base: number | undefined;
  refused?: boolean;
  /** The posts that failed, such as while the host restarted. */
  tries?: number;
}

/** A tab's mark: this window's while the host's list lacks it, else the host's. */
const markOf = (marks: ReadonlyMap<string, SentMark>, thread: Thread) => {
  const mark = marks.get(thread.id);
  return mark && !mark.refused ? mark.at : thread.seen;
};

/**
 * Which tabs and subagents changed since the reader last looked at them. The
 * thread on screen counts as seen once its work stops, with its subagents'
 * results. The host keeps the tabs' marks; a mark that this window sets
 * counts at once, until the host's list carries it or another window's.
 */
export function useReadState(
  threads: readonly Thread[],
  current: string | null,
  fetcher: typeof fetch,
): ReadState {
  const [subagentsSince] = useState(() => since(SUBAGENTS_SINCE_KEY));
  const [agents, setAgents] = useState<Record<string, number>>(() =>
    readJson(SUBAGENTS_SEEN_KEY, {}),
  );
  const [sent, setSent] = useState<ReadonlyMap<string, SentMark>>(() => new Map());
  // A sent mark goes once the host's mark for the tab changes, to it or to
  // another window's, or once the tab leaves.
  let marks = sent;
  for (const [id, mark] of sent) {
    const thread = threads.find((entry) => entry.id === id);
    if (thread && thread.seen === mark.base) continue;
    if (marks === sent) marks = new Map(sent);
    (marks as Map<string, SentMark>).delete(id);
  }
  // The shown thread is seen once its work stops: the unread rule leaves
  // working threads out, so a mark while it works would change nothing.
  const shown = threads.find((thread) => thread.id === current);
  if (
    shown &&
    shown.seen !== undefined &&
    shown.state !== "working" &&
    (markOf(marks, shown) ?? 0) < shown.updatedAt &&
    marks.get(shown.id)?.at !== shown.updatedAt
  ) {
    if (marks === sent) marks = new Map(sent);
    (marks as Map<string, SentMark>).set(shown.id, { at: shown.updatedAt, base: shown.seen });
  }
  if (marks !== sent) setSent(marks);

  // The host gets each mark once, a moment after it is set.
  const posted = useRef(new Map<string, number>());
  useEffect(() => {
    for (const id of [...posted.current.keys()]) if (!sent.has(id)) posted.current.delete(id);
    const due = [...sent].filter(
      ([id, mark]) => !mark.refused && posted.current.get(id) !== mark.at,
    );
    if (!due.length) return;
    const timer = setTimeout(() => {
      for (const [id, mark] of due) {
        posted.current.set(id, mark.at);
        // A failed post goes again later, as when the host restarts; after
        // five tries the mark counts no longer and the host's stands.
        seeThread(id, mark.at, fetcher).catch(() => {
          const tries = (mark.tries ?? 0) + 1;
          setTimeout(
            () => {
              posted.current.delete(id);
              setSent((value) =>
                value.get(id)?.at === mark.at
                  ? new Map(value).set(id, { ...mark, tries, refused: tries >= 5 })
                  : value,
              );
            },
            Math.min(30_000, 1000 * 2 ** tries),
          );
        });
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [fetcher, sent]);

  // Once, the marks that this browser kept before the host kept them.
  const moved = useRef(false);
  useEffect(() => {
    if (moved.current || !threads.some((thread) => thread.seen !== undefined)) return;
    moved.current = true;
    const old = oldMarks(threads);
    if (!old) return;
    void api(fetcher)
      .json("/api/threads/seen", z.object({ ok: z.boolean() }), post({ marks: old }))
      .then(() => {
        try {
          localStorage.removeItem(OLD_SEEN_KEY);
          localStorage.removeItem(OLD_SINCE_KEY);
        } catch {
          /* The host keeps the larger marks: sending them again does no harm. */
        }
      })
      .catch(() => {
        moved.current = false;
      });
  }, [fetcher, threads]);

  // The shown thread's subagents' results are seen as they finish.
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
  useEffect(() => writeJson(SUBAGENTS_SEEN_KEY, agents), [agents]);
  return useMemo<ReadState>(
    () => ({
      isUnread: (thread) => {
        const mark = markOf(marks, thread);
        return (
          thread.id !== current &&
          thread.state !== "working" &&
          mark !== undefined &&
          thread.updatedAt > mark
        );
      },
      setUnread: (thread, unread) =>
        setSent((value) =>
          new Map(value).set(thread.id, {
            at: unread ? thread.updatedAt - 1 : thread.updatedAt,
            base: thread.seen,
          }),
        ),
      isSubagentUnread: (subagent) =>
        subagent.state === "idle" && subagent.updatedAt > (agents[subagent.id] ?? subagentsSince),
      seeSubagent: (subagent) =>
        setAgents((value) => ({ ...value, [subagent.id]: subagent.updatedAt })),
    }),
    [agents, current, marks, subagentsSince],
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
 * pinned, not on screen, does not need the reader, and does not work; and its
 * branch has no commits ahead of its base and no uncommitted changes. A tab
 * whose work Med cannot tell (no `unlanded`) never closes on its own.
 */
export function landed(
  thread: Thread,
  context: { unread: boolean; onScreen: boolean; quietFor: number },
) {
  return (
    !context.unread &&
    thread.pinned === undefined &&
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
