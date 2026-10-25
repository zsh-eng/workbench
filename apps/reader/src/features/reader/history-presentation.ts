import type { SpreadIntent } from "@/lib/pagination-v2";
import { READER_HISTORY_LIMIT, type ReaderJumpHistory } from "./jump-history";

export interface ReaderHistoryPresentation {
  expanded: boolean;
  preview: boolean;
  firstSlot: number;
}
export const QUIET_HISTORY: ReaderHistoryPresentation = {
  expanded: false,
  preview: false,
  firstSlot: 0,
};

/** Presentation follows confirmed movement, but never enters persisted history.
 * Stable slots keep eviction moving by one place instead of jumping across the strip.
 */
export function updateHistoryPresentation(
  presentation: ReaderHistoryPresentation,
  before: ReaderJumpHistory,
  after: ReaderJumpHistory,
  intent: SpreadIntent,
): ReaderHistoryPresentation {
  const changed = before !== after;
  const evicted =
    changed &&
    before.cursor === before.entries.length - 1 &&
    before.entries.length === READER_HISTORY_LIMIT &&
    after.entries[0] !== before.entries[0];
  const expanded =
    intent.kind === "linear"
      ? false
      : changed && (intent.kind === "jump" || intent.kind === "history")
        ? true
        : presentation.expanded;
  // A page scrub or search preview hides the trail; a history scrub moves
  // along the trail, so it stays.
  const preview = intent.kind === "preview" && intent.source !== "history";
  if (
    !evicted &&
    expanded === presentation.expanded &&
    preview === presentation.preview
  )
    return presentation;
  return {
    expanded,
    preview,
    firstSlot: presentation.firstSlot + (evicted ? 1 : 0),
  };
}
