import { DEFAULT_GAP_MS } from "../active-time";
import { ACTIVITY_SESSION_VERSION, type ActivitySession } from "../session";

/** Spaced counts each card's time with two minutes, and keeps at most two minutes per review. */
export const SPACED_GAP_MS = DEFAULT_GAP_MS;

/**
 * The fields of a Spaced review log (a `reviewLog` operation's payload) that
 * hold time: `duration` is the card's active milliseconds, `review` the
 * moment of grading. Synced payloads carry dates as ISO strings.
 */
export interface SpacedReview {
  id: string;
  cardId: string;
  duration: number;
  review: Date | string | number;
}

/**
 * A review as a session on its card. A review log keeps only the grading
 * time and the duration, so the start is the grading time less the duration.
 * Older reviews timed the card from its display and restarted the timer
 * after a two-minute pause; newer ones use the gap rule. Logs do not say which.
 */
export function fromSpacedReview(review: SpacedReview): ActivitySession<null> {
  const endedAt = new Date(review.review).getTime();
  const activeMs = Math.max(0, Math.round(review.duration));
  return {
    v: ACTIVITY_SESSION_VERSION,
    id: review.id,
    app: "spaced",
    subject: { kind: "card", id: review.cardId },
    device: null,
    startedAt: endedAt - activeMs,
    lastActiveAt: endedAt,
    endedAt,
    activeMs,
    gapMs: SPACED_GAP_MS,
    position: null,
  };
}
