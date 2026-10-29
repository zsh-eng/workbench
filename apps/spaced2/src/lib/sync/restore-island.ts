import type { RestoreStage } from "@workbench/background-activity";
import type { Status } from "./engine";

/**
 * Spaced's words for a restore's stage: the cards (their share is not
 * known), then the review history with the full pull's share. The waits
 * and "Restored" are the shared island's (`restoreIsland`).
 */
export function restoreStage(
  status: Pick<Status, "restoring" | "fraction">,
): RestoreStage | null {
  const { restoring, fraction } = status;
  if (restoring === "cards")
    return {
      progress: { mark: "progress", fraction, label: "Restoring cards" },
      status: "Restoring your cards…",
    };
  if (restoring === "history")
    return {
      progress: {
        mark: "progress",
        fraction,
        label: "Restoring history",
        detail:
          fraction === null ? undefined : `${Math.floor(fraction * 100)}%`,
      },
      status: "Restoring your review history…",
    };
  return null;
}
