import { useSyncExternalStore } from "react";
import { z } from "zod";
import {
  commentReplyNotificationsSchema,
  type CommentReplyNotification,
} from "../../shared/notifications";
import type { PullInbox, PullInboxRow } from "../../shared/pull-inbox";
import { needsYou, type Thread } from "../../shared/threads";
import { createApi } from "./api";
import { readBrowserToken } from "./auth";
import type { CommentReads } from "./listed-comments";
import { browserFetch } from "./live";
import { question } from "./signals";

export type NotificationKind = "needs-you" | "pull" | "comment" | "thread";

export interface SidebarNotification {
  id: string;
  kind: NotificationKind;
  unread: boolean;
  /** Epoch ms for chronological ordering and compact age labels. */
  at: number;
  title: string;
  /** Single-line quiet detail shown under the title in the sidebar. */
  detail: string;
  /** Status dot kind, matching SessionSidebar's RowDot vocabulary. */
  dot?: "needs" | "halted" | "fresh";
  agent?: Thread["agent"];
  thread?: Thread;
  comment?: CommentReplyNotification;
  pull?: PullInboxRow;
}

export interface NotificationStoreState {
  read: Record<string, string>;
  dismissed: Record<string, string>;
}

const KEY = "med:notification-reads:v1";
const MAX_ENTRIES = 500;

function loadStore(): NotificationStoreState {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { read: {}, dismissed: {} };
    const record = raw as Record<string, unknown>;
    const clean = (value: unknown): Record<string, string> => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return {};
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      );
    };
    return { read: clean(record.read), dismissed: clean(record.dismissed) };
  } catch {
    return { read: {}, dismissed: {} };
  }
}

let state: NotificationStoreState | undefined;
const listeners = new Set<() => void>();
const snapshot = () => (state ??= loadStore());

function persist(next: NotificationStoreState) {
  const trim = (map: Record<string, string>) => {
    const entries = Object.entries(map);
    return entries.length > MAX_ENTRIES
      ? Object.fromEntries(entries.slice(entries.length - MAX_ENTRIES))
      : map;
  };
  state = { read: trim(next.read), dismissed: trim(next.dismissed) };
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* Keep in memory for this window when storage is full. */
  }
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent) {
  if (event.key !== KEY && event.key !== null) return;
  state = loadStore();
  for (const listener of listeners) listener();
}

/** Resets the in-memory cache so tests can isolate storage state. */
export function resetNotificationReadsCache() {
  state = undefined;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) removeEventListener("storage", onStorage);
  };
}

export const useNotificationReads = () => useSyncExternalStore(subscribe, snapshot, snapshot);

export function setNotificationRead(id: string, version: string, read: boolean) {
  const current = snapshot();
  const nextRead = { ...current.read };
  if (read) {
    delete nextRead[id];
    nextRead[id] = version;
  } else {
    delete nextRead[id];
  }
  persist({ ...current, read: nextRead });
}

export function dismissNotification(id: string, version: string) {
  const current = snapshot();
  const nextDismissed = { ...current.dismissed };
  delete nextDismissed[id];
  nextDismissed[id] = version;
  persist({ ...current, dismissed: nextDismissed });
}

export async function readCommentReplyNotifications(
  signal?: AbortSignal,
  fetcher = browserFetch,
): Promise<CommentReplyNotification[]> {
  const data = await createApi(fetcher, readBrowserToken()).json(
    "/api/notifications/comments",
    commentReplyNotificationsSchema,
    { signal },
  );
  return data.replies;
}

/** Marks the latest version of each listed saved review as read on the host. */
export async function markReviewsRead(
  reviewIds: readonly string[],
  fetcher = browserFetch,
): Promise<void> {
  if (!reviewIds.length) return;
  const api = createApi(fetcher, readBrowserToken());
  await Promise.allSettled(
    reviewIds.map((id) =>
      api.json(`/api/reviews/${encodeURIComponent(id)}/read`, z.unknown(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }),
    ),
  );
}

function parseTime(value: number | string | undefined): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function shortFile(path: string, line: number): string {
  const name = path.split("/").at(-1) ?? path;
  return `${name}:${line}`;
}

function shortRepo(repository: string): string {
  return repository.split("/").at(-1) ?? repository;
}

export function compactAge(at: number, now: number): string {
  if (!at) return "";
  const seconds = Math.max(0, Math.floor((now - at) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export function versionOfNotification(item: SidebarNotification): string {
  if (item.pull) return item.pull.updatedAt;
  if (item.comment) return item.comment.answeredAt;
  if (item.thread) return String(item.thread.updatedAt);
  return String(item.at);
}

export function buildSidebarNotifications({
  tabs,
  isUnread,
  commentReplies,
  commentReads,
  pulls,
  notifReads,
}: {
  tabs: readonly Thread[];
  isUnread: (thread: Thread) => boolean;
  commentReplies: readonly CommentReplyNotification[];
  commentReads: CommentReads;
  pulls: PullInbox | null;
  notifReads: NotificationStoreState;
}): SidebarNotification[] {
  const items: SidebarNotification[] = [];

  for (const thread of tabs) {
    const id = `thread:${thread.id}`;
    if (notifReads.dismissed[id] === String(thread.updatedAt)) continue;
    const at = parseTime(thread.turn?.endedAt ?? thread.updatedAt);

    if (needsYou(thread)) {
      const detail =
        thread.halt?.detail ??
        question(thread) ??
        (thread.state === "waiting" ? "Waiting for approval" : "Asked a question");
      items.push({
        id,
        kind: "needs-you",
        unread: true,
        at,
        title: thread.title,
        detail,
        dot: thread.halt ? "halted" : "needs",
        agent: thread.agent,
        thread,
      });
      continue;
    }

    const unreadReview = thread.reviews.some((review) => review.unread);
    const unread = isUnread(thread) || unreadReview;
    if (thread.state === "working" || (!unread && !thread.turn?.said)) continue;

    items.push({
      id,
      kind: "thread",
      unread,
      at,
      title: thread.title,
      detail: unreadReview ? "New review ready" : (thread.turn?.said ?? "Replied in thread"),
      ...(unread ? { dot: "fresh" as const } : {}),
      agent: thread.agent,
      thread,
    });
  }

  for (const reply of commentReplies) {
    const id = `comment:${reply.threadId}:${reply.commentId}`;
    if (notifReads.dismissed[id] === reply.answeredAt) continue;
    const seenAt = commentReads[reply.commentId];
    const unread = !seenAt || parseTime(seenAt) < parseTime(reply.answeredAt);
    items.push({
      id,
      kind: "comment",
      unread,
      at: parseTime(reply.answeredAt),
      title: shortFile(reply.path, reply.line),
      detail: reply.answer || reply.threadTitle,
      ...(unread ? { dot: "fresh" as const } : {}),
      comment: reply,
    });
  }

  if (pulls) {
    const seen = new Set<string>();
    const addPull = (row: PullInboxRow, waitingOnYou: boolean) => {
      if (seen.has(row.url)) return;
      seen.add(row.url);
      const id = `pull:${row.url}`;
      if (notifReads.dismissed[id] === row.updatedAt) return;
      const seenAt = notifReads.read[id];
      const unread = !seenAt || parseTime(seenAt) < parseTime(row.updatedAt);
      const reason =
        row.why ??
        (row.checks === "fail"
          ? "checks failing"
          : row.conflicts
            ? "conflicts"
            : row.review === "changes-requested"
              ? "changes requested"
              : waitingOnYou
                ? "review requested"
                : "open");
      items.push({
        id,
        kind: "pull",
        unread,
        at: parseTime(row.updatedAt),
        title: row.title,
        detail: `${shortRepo(row.repository)}#${row.number} · ${reason}`,
        ...(unread ? { dot: "fresh" as const } : {}),
        pull: row,
      });
    };

    for (const row of pulls.waiting) addPull(row, true);
    for (const row of pulls.yours) {
      if (row.review === "changes-requested" || row.checks === "fail" || row.conflicts) {
        addPull(row, false);
      }
    }
  }

  return items.sort((a, b) => {
    if (a.unread !== b.unread) return a.unread ? -1 : 1;
    return b.at - a.at;
  });
}
