import {
  textSlicesOf,
  type ResolvedLeafPage,
  type ResolvedSpread,
} from "@/lib/pagination-v2/types";

/**
 * Identifies the text a page shows by its chapter and first line. Page and
 * spread numbers can't do this: laying out earlier chapters renumbers the
 * open page without changing it.
 */
export function getPageContentKey(page: ResolvedLeafPage): string {
  const first = page.content[0];
  if (!first) return `${page.chapterIndex}`;
  // A table part starts at its first own row, and maybe partway through it.
  const firstText =
    first.type === "table" ? textSlicesOf([first])[0] : first;
  const start =
    firstText?.type === "text" ? firstText.lines[0]?.startOffset : null;
  const blockId =
    first.type === "table"
      ? `${first.blockId}:${first.rows.find((row) => !row.repeated)?.index ?? 0}`
      : first.blockId;
  return start
    ? `${page.chapterIndex}:${blockId}:${start.itemIndex}.${start.segmentIndex}.${start.graphemeIndex}`
    : `${page.chapterIndex}:${blockId}`;
}

/** Identifies the pages a spread shows; see getPageContentKey. */
export function getSpreadContentKey(spread: ResolvedSpread): string {
  return spread.slots
    .map((slot) => (slot.kind === "gap" ? "gap" : getPageContentKey(slot.page)))
    .join("|");
}
