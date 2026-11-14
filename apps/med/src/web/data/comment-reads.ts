import { useSyncExternalStore } from "react";
import type { CommentReads, ListedComment } from "./listed-comments";

// Which agents' answers to comments the reader has opened: by comment, the
// time of the newest answer seen. All comments shows a dot on the others.
// Every window of this address shares it; it holds the newest entries only.

const KEY = "med:comment-reads:v1";
const MOST = 2000;

function load(): CommentReads {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return Object.fromEntries(
      Object.entries(raw).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

let reads: CommentReads | undefined;
const listeners = new Set<() => void>();
const current = () => (reads ??= load());

/** Another window opened a comment. */
function follow(event: StorageEvent) {
  if (event.key !== KEY) return;
  reads = load();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) addEventListener("storage", follow);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) removeEventListener("storage", follow);
  };
}

export const useCommentReads = () => useSyncExternalStore(subscribe, current, current);

/** The reader has seen these comments' answers. */
export function markCommentsRead(comments: readonly Pick<ListedComment, "id" | "answeredAt">[]) {
  const answered = comments.filter(
    (comment): comment is { id: string; answeredAt: string } =>
      !!comment.answeredAt && current()[comment.id] !== comment.answeredAt,
  );
  if (!answered.length) return;
  const next: Record<string, string> = { ...current() };
  for (const comment of answered) {
    // The newest go last, so the oldest go first when the list is full.
    delete next[comment.id];
    next[comment.id] = comment.answeredAt;
  }
  const entries = Object.entries(next);
  reads = Object.fromEntries(entries.slice(Math.max(0, entries.length - MOST)));
  try {
    localStorage.setItem(KEY, JSON.stringify(reads));
  } catch {
    /* The reads last for this page. */
  }
  for (const listener of listeners) listener();
}
