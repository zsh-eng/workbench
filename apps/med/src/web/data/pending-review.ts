import { createContext } from "react";
import type { Note, PullRequestComments } from "../../shared/protocol";

/** A change to the reader's pending review on GitHub
 * (`POST /api/reviews/:id/pull-request`). */
export type PendingReviewInput =
  | { action: "note"; targetId: string; noteId: string }
  | { action: "reply"; thread: number; body: string }
  | { action: "submit"; event: "COMMENT" | "APPROVE" | "REQUEST_CHANGES"; body?: string }
  | { action: "discard" };

/** The review's pull request, where the reader writes their pending review. */
export interface PendingReviewTarget {
  /** The saved version on screen, when it is the pull request's head: its
   * comments on new lines can go into the pending review. */
  targetId?: string;
  /** What GitHub has, as Med read it last. */
  comments?: PullRequestComments | null;
  /** Rejects with GitHub's or Med's reason. */
  write(input: PendingReviewInput): Promise<void>;
}
export const PendingReviewContext = createContext<PendingReviewTarget | null>(null);

/** Whether GitHub has this comment already, where Med would add it. */
export function onGitHub(comments: PullRequestComments | null | undefined, note: Note) {
  const line = note.endLine ?? note.line;
  return !!comments?.threads.some(
    (thread) =>
      thread.path === note.path &&
      thread.side === note.side &&
      thread.line === line &&
      thread.comments.some((comment) => comment.body.trim() === note.text.trim()),
  );
}
