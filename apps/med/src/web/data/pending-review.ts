import { createContext } from "react";

/** A change to the reader's pending review on GitHub
 * (`POST /api/reviews/:id/pull-request`). */
export type PendingReviewInput =
  | { action: "note"; targetId: string; noteId: string }
  | { action: "reply"; thread: number; body: string }
  | { action: "submit"; event: "COMMENT" | "APPROVE" | "REQUEST_CHANGES"; body?: string }
  | { action: "discard" };

/** The review's pull request, where the reader writes their pending review. */
export interface PendingReviewTarget {
  /** The saved version on screen: its comments can go into the pending review. */
  targetId?: string;
  /** Rejects with GitHub's or Med's reason. */
  write(input: PendingReviewInput): Promise<void>;
}
export const PendingReviewContext = createContext<PendingReviewTarget | null>(null);
