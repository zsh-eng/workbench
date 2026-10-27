import {
  textSlicesOf,
  type ResolvedLeafPage,
  type ResolvedSpread,
  type TextCursorOffset,
} from "@/lib/pagination-v2/types";

/**
 * Identifies the text a page shows by its chapter and first line. Page and
 * spread numbers can't do this: laying out earlier chapters renumbers the
 * open page without changing it.
 */
export function getPageContentKey(page: ResolvedLeafPage): string {
  const first = page.content[0];
  if (!first) return `${page.chapterIndex}`;
  const offset = (start: TextCursorOffset) =>
    `${start.itemIndex}.${start.segmentIndex}.${start.graphemeIndex}`;
  if (first.type === "table") {
    // A table part starts at its first own row, maybe partway through it:
    // its first cell with lines on this page tells parts of a row apart.
    const row = first.rows.find((candidate) => !candidate.repeated);
    const base = `${page.chapterIndex}:${first.blockId}:${row?.index ?? 0}`;
    const cell = textSlicesOf([first]).find((slice) => slice.lines.length > 0);
    const start = cell?.lines[0]?.startOffset;
    return cell && start ? `${base}:${cell.blockId}:${offset(start)}` : base;
  }
  const start = first.type === "text" ? first.lines[0]?.startOffset : null;
  return start
    ? `${page.chapterIndex}:${first.blockId}:${offset(start)}`
    : `${page.chapterIndex}:${first.blockId}`;
}

/** Identifies the pages a spread shows; see getPageContentKey. */
export function getSpreadContentKey(spread: ResolvedSpread): string {
  return spread.slots
    .map((slot) => (slot.kind === "gap" ? "gap" : getPageContentKey(slot.page)))
    .join("|");
}
