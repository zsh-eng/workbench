import type { AppUpdateState } from "@workbench/background-activity/service-worker";

/**
 * When a downloaded version of Spaced takes over: never while you review a
 * card, by itself at a launch or when you come back to anything else, and
 * at once when you tap Restart. See src/lib/app-update.ts for the wiring.
 */

/** A page this new, that you have not touched, has shown you nothing yet. */
export const LAUNCH_MS = 5_000;
/** Away this long, coming back to the app is a safe moment to switch. */
export const AWAY_FOR_UPDATE_MS = 2 * 60_000;
/** Away this long, coming back also asks for a new version. */
export const AWAY_FOR_CHECK_MS = 15 * 60_000;

export interface UpdateContext {
  /** A card is on the review screen: the review is in progress. */
  reviewing: boolean;
  /**
   * Something a reload would lose is under way: a download you asked for,
   * an open dialog, or an import.
   */
  busy: boolean;
  /** Time since this page started. */
  pageAgeMs: number;
  /** A tap or key press since this page started. */
  touched: boolean;
  /** Sync says this version can no longer sync (410). */
  required: boolean;
}

/**
 * Whether a ready update switches at once: only at a launch, before your
 * first tap. The review screen is the first screen, so a card may already
 * show; you have not started on it. Everything else waits for
 * `updateMoment`.
 */
export function updatePolicy(context: UpdateContext): "now" | "wait" {
  return context.pageAgeMs < LAUNCH_MS && !context.touched && !context.busy
    ? "now"
    : "wait";
}

export type UpdateMomentEvent =
  | { type: "visible"; awayMs: number }
  | { type: "route" };

/**
 * What a waiting update does at a moment: switch (`apply`), look for a new
 * version (`check`), or nothing. Never while a card is on the review screen,
 * and never while `busy`.
 */
export function updateMoment(
  update: Pick<AppUpdateState, "status" | "takenOver">,
  event: UpdateMomentEvent,
  context: UpdateContext,
): "apply" | "check" | null {
  if (update.status === "ready" && !context.reviewing && !context.busy) {
    // Another tab switched, so this page runs old code on the new files; or
    // sync needs the new version. The first moment outside a review.
    if (update.takenOver || context.required) return "apply";
    if (event.type === "visible" && event.awayMs >= AWAY_FOR_UPDATE_MS)
      return "apply";
  }
  if (
    (update.status === "idle" || update.status === "failed") &&
    (context.required ||
      (event.type === "visible" && event.awayMs >= AWAY_FOR_CHECK_MS))
  )
    return "check";
  return null;
}
