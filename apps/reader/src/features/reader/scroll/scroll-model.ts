import type {
  ChapterColumnLayout,
  ContentAnchor,
  PageSlice,
  ResolvedSpread,
} from "@/lib/pagination-v2";

/**
 * Geometry for the prototype scroll mode. Every offset here is exact: the
 * column comes from the same layout as the pages, so nothing is measured in
 * the DOM.
 *
 * Offsets are column offsets (0 = top of the chapter's first content) unless
 * a name says otherwise.
 */

/** A text slice taller than this many lines renders as several rows. */
export const SCROLL_ROW_MAX_LINES = 8;

/** One render unit: a block, or a chunk of a long block's lines. */
export interface ScrollRow {
  key: string;
  y: number;
  height: number;
  /** Chapter-local page that holds this row. Rows never cross a page. */
  pageIndex: number;
  slice: PageSlice;
}

/** A line, image or spacer edge that a reader can see at the top of the view. */
export interface ScrollLine {
  y: number;
  height: number;
  pageIndex: number;
  anchor: ContentAnchor;
}

function sliceHeight(slice: PageSlice): number {
  if (slice.type === "text") return slice.lines.length * slice.lineHeight;
  return slice.height;
}

export function buildScrollRows(column: ChapterColumnLayout): ScrollRow[] {
  const rows: ScrollRow[] = [];
  for (const { y, pageIndex, slice } of column.slices) {
    const keyPrefix = `${slice.type}:${slice.blockId}:${pageIndex}`;
    if (slice.type !== "text" || slice.lines.length <= SCROLL_ROW_MAX_LINES) {
      rows.push({
        key: `${keyPrefix}:0`,
        y,
        height: sliceHeight(slice),
        pageIndex,
        slice,
      });
      continue;
    }

    for (
      let start = 0;
      start < slice.lines.length;
      start += SCROLL_ROW_MAX_LINES
    ) {
      const lines = slice.lines.slice(start, start + SCROLL_ROW_MAX_LINES);
      rows.push({
        key: `${keyPrefix}:${start}`,
        y: y + start * slice.lineHeight,
        height: lines.length * slice.lineHeight,
        pageIndex,
        slice: { ...slice, lines },
      });
    }
  }
  return rows;
}

/** Index of the first row whose bottom is below `offset`; rows.length if none. */
export function findFirstRowEndingAfter(
  rows: readonly ScrollRow[],
  offset: number,
): number {
  let low = 0;
  let high = rows.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const row = rows[middle]!;
    if (row.y + row.height > offset) high = middle;
    else low = middle + 1;
  }
  return low;
}

/** Index of the last row whose top is above `offset`; -1 if none. */
export function findLastRowStartingBefore(
  rows: readonly ScrollRow[],
  offset: number,
): number {
  let low = 0;
  let high = rows.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (rows[middle]!.y < offset) low = middle + 1;
    else high = middle;
  }
  return low - 1;
}

/** The page whose start is at or above `offset`. */
export function findPageAtOffset(
  pageStarts: readonly number[],
  offset: number,
): number {
  let low = 0;
  let high = pageStarts.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (pageStarts[middle]! <= offset) low = middle + 1;
    else high = middle;
  }
  return Math.max(0, low - 1);
}

function blockAnchor(chapterIndex: number, blockId: string): ContentAnchor {
  return { type: "block", chapterIndex, blockId };
}

/**
 * The first line (or image) whose top is at or below `viewTop`, which is the
 * first line the reader sees whole. Spacers are not lines.
 */
export function findFirstFullyVisibleLine(
  rows: readonly ScrollRow[],
  chapterIndex: number,
  viewTop: number,
): ScrollLine | null {
  const tolerance = 0.5;
  for (
    let index = findFirstRowEndingAfter(rows, viewTop);
    index < rows.length;
    index++
  ) {
    const row = rows[index]!;
    const { slice } = row;
    if (slice.type === "spacer") continue;
    if (slice.type === "image") {
      if (row.y < viewTop - tolerance) continue;
      return {
        y: row.y,
        height: row.height,
        pageIndex: row.pageIndex,
        anchor: blockAnchor(chapterIndex, slice.blockId),
      };
    }

    for (let lineIndex = 0; lineIndex < slice.lines.length; lineIndex++) {
      const top = row.y + lineIndex * slice.lineHeight;
      if (top < viewTop - tolerance) continue;
      const startOffset = slice.lines[lineIndex]?.startOffset;
      return {
        y: top,
        height: slice.lineHeight,
        pageIndex: row.pageIndex,
        anchor: startOffset
          ? {
              type: "text",
              chapterIndex,
              blockId: slice.blockId,
              offset: { ...startOffset },
            }
          : blockAnchor(chapterIndex, slice.blockId),
      };
    }
  }
  return null;
}

/**
 * Chooses the page that Scroll → Pages snaps to.
 *
 * The page that holds the first fully visible line wins, so the snap never
 * skips text the reader has not seen. The next page wins only when its start
 * is within about two lines of the top of the view: the lines above it are
 * the ones the reader just finished.
 */
export function resolveSnapPage(options: {
  column: ChapterColumnLayout;
  rows: readonly ScrollRow[];
  viewTop: number;
  bodyLineHeight: number;
}): number {
  const { column, rows, viewTop, bodyLineHeight } = options;
  const line = findFirstFullyVisibleLine(rows, column.chapterIndex, viewTop);
  if (!line) return findPageAtOffset(column.pageStarts, viewTop);

  const nextStart = column.pageStarts[line.pageIndex + 1];
  const slack = 2 * Math.max(bodyLineHeight, 1) + 0.5;
  if (nextStart !== undefined && nextStart - viewTop <= slack) {
    return line.pageIndex + 1;
  }
  return line.pageIndex;
}

/** The column offset of an anchor, for keeping it in place after relayout. */
export function findAnchorOffset(
  rows: readonly ScrollRow[],
  anchor: ContentAnchor,
): number | null {
  for (const row of rows) {
    const { slice } = row;
    if (slice.blockId !== anchor.blockId) continue;
    if (anchor.type === "block" || slice.type !== "text") return row.y;

    for (let lineIndex = 0; lineIndex < slice.lines.length; lineIndex++) {
      const offset = slice.lines[lineIndex]?.startOffset;
      if (
        offset &&
        offset.itemIndex === anchor.offset.itemIndex &&
        offset.segmentIndex === anchor.offset.segmentIndex &&
        offset.graphemeIndex === anchor.offset.graphemeIndex
      ) {
        return row.y + lineIndex * slice.lineHeight;
      }
    }
  }
  return null;
}

/**
 * A one-page spread that holds the whole column. Selection code resolves DOM
 * endpoints against spread slices, so a highlight made in the column gets the
 * same canonical offsets as one made on a page.
 */
export function buildColumnSelectionSpread(
  column: ChapterColumnLayout,
): ResolvedSpread {
  return {
    slots: [
      {
        kind: "page",
        slotIndex: 0,
        page: {
          currentPage: 1,
          totalPages: 1,
          currentPageInChapter: 1,
          totalPagesInChapter: column.pageStarts.length,
          chapterIndex: column.chapterIndex,
          content: column.slices.map((entry) => entry.slice),
        },
      },
    ],
    intent: { kind: "replace" },
    currentPage: 1,
    totalPages: 1,
    // A spread id that no paged spread uses.
    currentSpread: -1 - column.chapterIndex,
    totalSpreads: 1,
    chapterIndexStart: column.chapterIndex,
    chapterIndexEnd: column.chapterIndex,
  };
}

const wordCounts = new WeakMap<object, number>();

/** Words in a chapter's canonical text, cached per text, for time estimates. */
export function countChapterWords(canonical: { fullText: string }): number {
  const cached = wordCounts.get(canonical);
  if (cached !== undefined) return cached;
  const count = countWords(canonical.fullText);
  wordCounts.set(canonical, count);
  return count;
}

function countWords(text: string): number {
  let count = 0;
  let inWord = false;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    const isSpace = code === 32 || code === 10 || code === 9 || code === 13;
    if (isSpace) inWord = false;
    else if (!inWord) {
      inWord = true;
      count++;
    }
  }
  return count;
}

export const READING_WORDS_PER_MINUTE = 238;

export function formatMinutes(minutes: number): string {
  if (minutes < 0.5) return "under 1 min";
  const rounded = Math.round(minutes);
  if (rounded < 60) return `${rounded} min`;
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}
