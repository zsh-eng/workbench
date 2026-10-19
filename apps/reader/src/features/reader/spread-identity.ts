import type {
  ResolvedLeafPage,
  ResolvedSpread,
} from "@/lib/pagination-v2/types";

/**
 * Identifies the text a page shows by its chapter and first line. Page and
 * spread numbers can't do this: laying out earlier chapters renumbers the
 * open page without changing it.
 */
export function getPageContentKey(page: ResolvedLeafPage): string {
  const first = page.content[0];
  if (!first) return `${page.chapterIndex}`;
  const start = first.type === "text" ? first.lines[0]?.startOffset : null;
  return start
    ? `${page.chapterIndex}:${first.blockId}:${start.itemIndex}.${start.segmentIndex}.${start.graphemeIndex}`
    : `${page.chapterIndex}:${first.blockId}`;
}

/** Identifies the pages a spread shows; see getPageContentKey. */
export function getSpreadContentKey(spread: ResolvedSpread): string {
  return spread.slots
    .map((slot) => (slot.kind === "gap" ? "gap" : getPageContentKey(slot.page)))
    .join("|");
}
