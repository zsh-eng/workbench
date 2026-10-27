import {
  sliceShowsBlock,
  type ChapterColumnLayout,
  type ContentAnchor,
  type PageSlice,
  type ResolvedSpread,
  type TextCursorOffset,
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

type TextPageSlice = Extract<PageSlice, { type: "text" }>;
type TablePageSlice = Extract<PageSlice, { type: "table" }>;

/**
 * A table part's own rows (not a repeated header) at column offset `y`,
 * each with its first cell that has lines here. A row is the unit a reader
 * sees at the top of the view.
 */
function tableRowUnits(
  slice: TablePageSlice,
  y: number,
): { y: number; height: number; cell: TextPageSlice | null }[] {
  const units: { y: number; height: number; cell: TextPageSlice | null }[] = [];
  let top = y;
  for (const row of slice.rows) {
    if (!row.repeated) {
      const cell = row.cells.find((candidate) => candidate.slice.lines.length);
      units.push({ y: top, height: row.height, cell: cell?.slice ?? null });
    }
    top += row.height;
  }
  return units;
}

/** The anchor of a table row: its first cell's first line here. */
function tableRowAnchor(
  chapterIndex: number,
  slice: TablePageSlice,
  cell: TextPageSlice | null,
): ContentAnchor {
  const start = cell?.lines[0]?.startOffset;
  return cell && start
    ? {
        type: "text",
        chapterIndex,
        blockId: cell.blockId,
        offset: { ...start },
      }
    : blockAnchor(chapterIndex, slice.blockId);
}

/**
 * The text a row draws, each piece at its column offset: a text slice, or
 * a table part's cells in reading order (not a repeated header's).
 */
function textUnitsOf(row: ScrollRow): { slice: TextPageSlice; y: number }[] {
  const { slice } = row;
  if (slice.type === "text") return [{ slice, y: row.y }];
  if (slice.type !== "table") return [];
  const units: { slice: TextPageSlice; y: number }[] = [];
  let top = row.y;
  for (const tableRow of slice.rows) {
    if (!tableRow.repeated) {
      for (const cell of tableRow.cells)
        units.push({ slice: cell.slice, y: top + slice.cellPaddingY });
    }
    top += tableRow.height;
  }
  return units;
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
    if (slice.type === "table") {
      // Each of the part's rows is a unit, as an image is.
      const unit = tableRowUnits(slice, row.y).find(
        (candidate) => candidate.y >= viewTop - tolerance,
      );
      if (!unit) continue;
      return {
        y: unit.y,
        height: unit.height,
        pageIndex: row.pageIndex,
        anchor: tableRowAnchor(chapterIndex, slice, unit.cell),
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

/** The reading line sits this far down the view. */
export const READING_LINE_FRACTION = 1 / 3;

/**
 * Column offset of the reading line. Rows sit at `paddingTop + y`, so the
 * view's top edge is at column offset `scrollTop - paddingTop`.
 */
export function readingLineOffset(
  scrollTop: number,
  paddingTop: number,
  viewportHeight: number,
): number {
  return scrollTop - paddingTop + viewportHeight * READING_LINE_FRACTION;
}

/** The line that contains `offset`, or the first line below it. */
export function findLineAtOrAfter(
  rows: readonly ScrollRow[],
  chapterIndex: number,
  offset: number,
): ScrollLine | null {
  for (
    let index = findFirstRowEndingAfter(rows, offset);
    index < rows.length;
    index++
  ) {
    const row = rows[index]!;
    const { slice } = row;
    if (slice.type === "spacer") continue;
    if (slice.type === "image") {
      return {
        y: row.y,
        height: row.height,
        pageIndex: row.pageIndex,
        anchor: blockAnchor(chapterIndex, slice.blockId),
      };
    }
    if (slice.type === "table") {
      const unit = tableRowUnits(slice, row.y).find(
        (candidate) => candidate.y + candidate.height > offset,
      );
      if (!unit) continue;
      return {
        y: unit.y,
        height: unit.height,
        pageIndex: row.pageIndex,
        anchor: tableRowAnchor(chapterIndex, slice, unit.cell),
      };
    }
    for (let lineIndex = 0; lineIndex < slice.lines.length; lineIndex++) {
      const top = row.y + lineIndex * slice.lineHeight;
      if (top + slice.lineHeight <= offset) continue;
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
 * Chooses the page that Scroll → Pages snaps to: the page that holds the
 * reading line, a third of the way down the view.
 *
 * A backward snap therefore moves the text at most about two thirds of a
 * page, and a forward snap skips at most the lines above the reading line.
 */
export function resolveSnapPage(options: {
  column: ChapterColumnLayout;
  readingLine: number;
}): number {
  const { column, readingLine } = options;
  return findPageAtOffset(column.pageStarts, Math.max(0, readingLine));
}

function compareCursor(a: TextCursorOffset, b: TextCursorOffset): number {
  if (a.itemIndex !== b.itemIndex) return a.itemIndex - b.itemIndex;
  if (a.segmentIndex !== b.segmentIndex) return a.segmentIndex - b.segmentIndex;
  return a.graphemeIndex - b.graphemeIndex;
}

/**
 * A line named by its block and the characters before it in that block.
 *
 * Cursor offsets count a block's text runs, and a new highlight splits a run
 * in two, which renumbers every offset after it. The characters stay the
 * same, so this survives a highlight relayout; it also survives a font
 * change, where it names the line that now holds the same character.
 */
export interface LineTextPosition {
  blockId: string;
  textOffset: number;
}

function lineTextLength(
  line: Extract<PageSlice, { type: "text" }>["lines"][number],
): number {
  let length = 0;
  for (const fragment of line.fragments) length += fragment.text.length;
  return length;
}

/** The text position of the line that holds column offset `y`. */
export function findLineTextPosition(
  rows: readonly ScrollRow[],
  y: number,
): LineTextPosition | null {
  const target = rows[findFirstRowEndingAfter(rows, y)];
  if (!target || target.slice.type === "spacer") return null;
  if (target.slice.type === "image") {
    return { blockId: target.slice.blockId, textOffset: 0 };
  }
  // In a table part, the text is the first cell of the row that holds `y`.
  let held: TextPageSlice = target.slice as TextPageSlice;
  if (target.slice.type === "table") {
    const units = tableRowUnits(target.slice, target.y);
    const unit =
      units.find((candidate) => candidate.y + candidate.height > y) ??
      units.at(-1);
    if (!unit?.cell) return { blockId: target.slice.blockId, textOffset: 0 };
    held = unit.cell;
  }
  const { blockId } = held;

  let textOffset = 0;
  for (const row of rows) {
    for (const { slice, y: top0 } of textUnitsOf(row)) {
      if (slice.blockId !== blockId) continue;
      for (let lineIndex = 0; lineIndex < slice.lines.length; lineIndex++) {
        const top = top0 + lineIndex * slice.lineHeight;
        if (slice === held && top + slice.lineHeight > y) {
          return { blockId, textOffset };
        }
        textOffset += lineTextLength(slice.lines[lineIndex]!);
      }
      if (slice === held) return { blockId, textOffset };
    }
  }
  return { blockId, textOffset };
}

/** The column offset of the line that holds a text position. */
export function findTextPositionOffset(
  rows: readonly ScrollRow[],
  position: LineTextPosition,
): number | null {
  let textOffset = 0;
  let last: number | null = null;
  for (const row of rows) {
    const { slice } = row;
    if (slice.type === "spacer") continue;
    if (slice.type !== "text" && slice.blockId === position.blockId) {
      return row.y;
    }
    for (const unit of textUnitsOf(row)) {
      if (unit.slice.blockId !== position.blockId) continue;
      const { lines, lineHeight } = unit.slice;
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const top = unit.y + lineIndex * lineHeight;
        const length = lineTextLength(lines[lineIndex]!);
        if (position.textOffset < textOffset + length) return top;
        textOffset += length;
        last = top;
      }
    }
  }
  return last;
}

/**
 * The column offset of the line that holds an anchor. A text anchor inside
 * a line resolves to that line; a block anchor to the block's first row.
 */
export function findAnchorOffset(
  rows: readonly ScrollRow[],
  anchor: ContentAnchor,
): number | null {
  let best: number | null = null;
  for (const row of rows) {
    const { slice } = row;
    if (!sliceShowsBlock(slice, anchor.blockId)) continue;
    if (
      anchor.type === "block" ||
      (slice.type !== "text" && slice.type !== "table")
    ) {
      return row.y;
    }
    if (slice.type === "table" && slice.blockId === anchor.blockId) {
      return row.y;
    }

    // A text slice, or the cell of a table part that holds the anchor.
    for (const unit of textUnitsOf(row)) {
      if (unit.slice.blockId !== anchor.blockId) continue;
      const { lines, lineHeight } = unit.slice;
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const start = lines[lineIndex]?.startOffset;
        if (!start) continue;
        if (compareCursor(start, anchor.offset) > 0) return best ?? unit.y;
        best = unit.y + lineIndex * lineHeight;
      }
    }
  }
  return best;
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

/** A page's place in a spread: slot `index` of `columns` pages. */
export interface SpreadSlotPlace {
  index: number;
  columns: number;
}

/**
 * Where a page lands in the spread that Scroll → Pages opens; the engine
 * goes to the page's own anchor. A two-page spread keeps that anchor's page
 * on the left. Wider spreads follow the book's page order, which needs the
 * page's book page number (1-based).
 */
export function spreadSlotFor(
  columns: number,
  bookPage: number | null,
): SpreadSlotPlace | null {
  if (columns < 2) return null;
  if (columns === 2) return { index: 0, columns };
  if (bookPage === null) return null;
  return { index: (bookPage - 1) % columns, columns };
}

/**
 * A one-page spread of what the view shows, from the top line down. Notes
 * capture a page target from the first line of a spread; in scroll mode
 * that is the line at the top of the view.
 */
export function buildColumnViewSpread(
  column: ChapterColumnLayout,
  topAnchor: ContentAnchor | null,
  pageIndex: number,
): ResolvedSpread {
  let startIndex = column.slices.findIndex(
    (entry) => entry.pageIndex === pageIndex,
  );
  let firstSlice: PageSlice | null = null;
  if (topAnchor) {
    const index = column.slices.findIndex((entry) =>
      sliceShowsBlock(entry.slice, topAnchor.blockId),
    );
    if (index >= 0) {
      startIndex = index;
      const slice = column.slices[index]!.slice;
      if (slice.type === "text" && topAnchor.type === "text") {
        const lineIndex = slice.lines.findIndex(
          (line) =>
            line.startOffset &&
            compareCursor(line.startOffset, topAnchor.offset) >= 0,
        );
        if (lineIndex > 0) {
          firstSlice = { ...slice, lines: slice.lines.slice(lineIndex) };
        }
      }
    }
  }
  const content = column.slices
    .slice(Math.max(0, startIndex), Math.max(0, startIndex) + 24)
    .map((entry, index) =>
      index === 0 && firstSlice ? firstSlice : entry.slice,
    );
  return {
    slots: [
      {
        kind: "page",
        slotIndex: 0,
        page: {
          currentPage: 1,
          totalPages: 1,
          currentPageInChapter: pageIndex + 1,
          totalPagesInChapter: column.pageStarts.length,
          chapterIndex: column.chapterIndex,
          content,
        },
      },
    ],
    intent: { kind: "replace" },
    currentPage: 1,
    totalPages: 1,
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
