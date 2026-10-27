/**
 * Table layout for pagination, in the worker, without a DOM.
 *
 * Column widths follow CSS automatic table layout in outline: each column
 * has a min-content width (its widest unbreakable word) and a max-content
 * width (its longest cell on one line). A table that fits fills the page; one
 * that does not shrinks its columns towards min-content; one whose
 * min-content is still wider than the page keeps those widths and scrolls
 * sideways. Every cell then lays out with the prose line breaker at its
 * column's width. All cells share one line height, so a row's height is its
 * tallest cell's line count, and a row too tall for a page splits between
 * lines.
 *
 * The page renders a `<table>` with these widths and row heights fixed, so
 * the browser draws exactly what was measured here.
 */
import { layoutPreWrapLines, layoutTextLines } from "./layout-text-lines";
import { getLineHeight } from "./spacing";
import type {
  LayoutTheme,
  PageLine,
  PreparedTableBlock,
  PreparedTextBlock,
  TableCellSpec,
  TableSlice,
  TableSliceCell,
  TableSliceRow,
  TextSlice,
} from "./types";

/** Horizontal cell padding, in ems of the reading size. */
const CELL_PADDING_X_EM = 0.45;
/** Vertical cell padding, in ems of the reading size. */
const CELL_PADDING_Y_EM = 0.3;
/**
 * Width a line keeps free, so a cell's text never wraps again in the page.
 * Matches the prose line breaker's own safety, plus rounding.
 */
const LINE_FIT_SAFETY_PX = 3;
/** A column's min-content width, at most, as a share of the page. */
const MAX_COLUMN_MIN_SHARE = 0.6;
/**
 * A row stays whole on one page unless keeping it whole would leave at
 * least this share of the page empty; then it splits between lines.
 */
const SPLIT_ROOM_SHARE = 0.25;
/** Lines a split row shows, at least, before the page break. */
const MIN_SPLIT_LINES = 2;

interface PlacedCell {
  spec: TableCellSpec;
  row: number;
  column: number;
  lines: PageLine[];
  tag: "td" | "th";
}

interface PlannedRow {
  index: number;
  header: boolean;
  /** Height without the lines of cells that span into later rows. */
  height: number;
  cells: PlacedCell[];
  /** The last row of the group this row starts or belongs to. */
  groupEnd: number;
}

/** A table's widths, lines and row heights at one page width. */
export interface TablePlan {
  tableId: string;
  columnWidths: number[];
  width: number;
  overflows: boolean;
  lineHeight: number;
  paddingX: number;
  paddingY: number;
  rows: PlannedRow[];
  /** Rows at the top that repeat on each continuation page. */
  headerRowCount: number;
}

/** The cells' prepared text blocks that follow a table, by id. */
export function collectTableCells(
  table: PreparedTableBlock,
  blocks: readonly { type: string; id: string }[],
  tableIndex: number,
): { cells: Map<string, PreparedTextBlock>; nextIndex: number } {
  const ids = new Set(
    table.rows.flatMap((row) => row.cells.map((cell) => cell.blockId)),
  );
  const cells = new Map<string, PreparedTextBlock>();
  let index = tableIndex + 1;
  while (index < blocks.length) {
    const block = blocks[index] as PreparedTextBlock | undefined;
    if (!block || block.type !== "text" || !ids.has(block.id)) break;
    cells.set(block.id, block);
    index += 1;
  }
  return { cells, nextIndex: index };
}

function cellContentWidths(block: PreparedTextBlock | undefined): {
  min: number;
  max: number;
} {
  if (!block) return { min: 0, max: 0 };
  let min = 0;
  let max = 0;
  let line = 0;
  for (const item of block.items) {
    if (item.rawText.includes("\n")) {
      max = Math.max(max, line);
      line = 0;
      continue;
    }
    line += item.leadingGap + item.fullWidth + item.chromeWidth;
    const { segments, widths } = item.prepared;
    for (let index = 0; index < segments.length; index++) {
      if (!segments[index]!.trim()) continue;
      min = Math.max(min, (widths[index] ?? 0) + item.chromeWidth);
    }
  }
  return { min, max: Math.max(max, line) };
}

/** Places cells on the grid, honouring row and column spans. */
function placeCells(table: PreparedTableBlock): {
  placed: PlacedCell[][];
  columnCount: number;
} {
  const occupied: boolean[][] = [];
  const placed: PlacedCell[][] = table.rows.map(() => []);
  let columnCount = 0;
  table.rows.forEach((row, rowIndex) => {
    occupied[rowIndex] ??= [];
    let column = 0;
    for (const spec of row.cells) {
      while (occupied[rowIndex]![column]) column += 1;
      const rowSpan = Math.min(spec.rowSpan, table.rows.length - rowIndex);
      for (let r = rowIndex; r < rowIndex + rowSpan; r++) {
        occupied[r] ??= [];
        for (let c = column; c < column + spec.colSpan; c++)
          occupied[r]![c] = true;
      }
      placed[rowIndex]!.push({
        spec: { ...spec, rowSpan },
        row: rowIndex,
        column,
        lines: [],
        tag: spec.header ? "th" : "td",
      });
      column += spec.colSpan;
      columnCount = Math.max(columnCount, column);
    }
  });
  return { placed, columnCount };
}

/**
 * Column widths in whole pixels, so every browser draws the column edges
 * where the worker put them. A table that fits fills the page.
 */
function distributeWidths(
  mins: number[],
  maxes: number[],
  pageWidth: number,
): number[] {
  const available = Math.floor(pageWidth);
  const sumMin = mins.reduce((a, b) => a + b, 0);
  const sumMax = maxes.reduce((a, b) => a + b, 0);
  // Too wide even at min-content: keep it, and scroll sideways.
  if (sumMin > available) return mins.map((min) => Math.ceil(min));

  const widths =
    sumMax <= available
      ? // Every cell fits on one line: share the page by content.
        maxes.map((max) => (max / sumMax) * available)
      : // Give the spare width to the columns that wrap most.
        mins.map(
          (min, index) =>
            min +
            ((available - sumMin) * (maxes[index]! - min)) / (sumMax - sumMin),
        );
  const rounded = widths.map((width) => Math.floor(width));
  rounded[rounded.length - 1]! +=
    available - rounded.reduce((a, b) => a + b, 0);
  return rounded;
}

export function planTable(
  table: PreparedTableBlock,
  cells: ReadonlyMap<string, PreparedTextBlock>,
  theme: LayoutTheme,
  pageWidth: number,
): TablePlan {
  const lineHeight = getLineHeight("td", theme);
  const paddingX = Math.round(theme.baseFontSizePx * CELL_PADDING_X_EM);
  const paddingY = Math.round(theme.baseFontSizePx * CELL_PADDING_Y_EM);
  const chrome = paddingX * 2 + LINE_FIT_SAFETY_PX;
  const { placed, columnCount } = placeCells(table);
  const columns = Math.max(1, columnCount);
  const minCap = Math.max(chrome + 1, pageWidth * MAX_COLUMN_MIN_SHARE);

  const mins = new Array<number>(columns).fill(chrome);
  const maxes = new Array<number>(columns).fill(chrome);
  const spanning: { cell: PlacedCell; min: number; max: number }[] = [];
  for (const row of placed) {
    for (const cell of row) {
      const content = cellContentWidths(cells.get(cell.spec.blockId));
      const min = Math.min(minCap, Math.ceil(content.min) + chrome);
      const max = Math.max(min, Math.ceil(content.max) + chrome);
      if (cell.spec.colSpan > 1) {
        spanning.push({ cell, min, max });
        continue;
      }
      mins[cell.column] = Math.max(mins[cell.column]!, min);
      maxes[cell.column] = Math.max(maxes[cell.column]!, max);
    }
  }
  // A spanning cell widens the columns it spans evenly, if they are short.
  for (const { cell, min, max } of spanning) {
    const span = Array.from(
      { length: cell.spec.colSpan },
      (_, offset) => cell.column + offset,
    ).filter((column) => column < columns);
    const spanMin = span.reduce((sum, column) => sum + mins[column]!, 0);
    const spanMax = span.reduce((sum, column) => sum + maxes[column]!, 0);
    for (const column of span) {
      if (min > spanMin) mins[column]! += (min - spanMin) / span.length;
      if (max > spanMax) maxes[column]! += (max - spanMax) / span.length;
      maxes[column] = Math.max(maxes[column]!, mins[column]!);
    }
  }

  const columnWidths = distributeWidths(mins, maxes, pageWidth);
  const width = columnWidths.reduce((a, b) => a + b, 0);

  // Lines per cell at its width, then row heights.
  const rows: PlannedRow[] = placed.map((row, index) => ({
    index,
    header: table.rows[index]!.header,
    height: 0,
    cells: row,
    groupEnd: index,
  }));
  for (const row of rows) {
    let maxLines = 1;
    for (const cell of row.cells) {
      const prepared = cells.get(cell.spec.blockId);
      const cellWidth = columnWidths
        .slice(cell.column, cell.column + cell.spec.colSpan)
        .reduce((a, b) => a + b, 0);
      const textWidth = Math.max(1, cellWidth - paddingX * 2);
      cell.lines = prepared
        ? prepared.containsNewlines
          ? layoutPreWrapLines(prepared.items, textWidth)
          : layoutTextLines(prepared.items, textWidth, { textAlign: "left" })
              .lines
        : [];
      const last = cell.lines[cell.lines.length - 1];
      if (last) last.isLastInBlock = true;
      if (cell.spec.rowSpan === 1)
        maxLines = Math.max(maxLines, cell.lines.length);
    }
    row.height = paddingY * 2 + maxLines * lineHeight;
  }
  // Cells that span rows: the group of rows stays on one page, and its last
  // row grows if the spanning cell needs more room.
  for (const row of rows) {
    for (const cell of row.cells) {
      if (cell.spec.rowSpan === 1) continue;
      const end = row.index + cell.spec.rowSpan - 1;
      const spanned = rows.slice(row.index, end + 1);
      const available = spanned.reduce((sum, r) => sum + r.height, 0);
      const needed = paddingY * 2 + cell.lines.length * lineHeight;
      if (needed > available) rows[end]!.height += needed - available;
      for (const r of spanned) r.groupEnd = Math.max(r.groupEnd, end);
    }
  }
  for (let index = rows.length - 2; index >= 0; index--) {
    const row = rows[index]!;
    if (row.groupEnd > index)
      row.groupEnd = Math.max(row.groupEnd, rows[index + 1]!.groupEnd);
  }

  let headerRowCount = 0;
  while (headerRowCount < rows.length && rows[headerRowCount]!.header)
    headerRowCount += 1;
  // A table that is all header has nothing to repeat it over.
  if (headerRowCount === rows.length) headerRowCount = 0;

  return {
    tableId: table.id,
    columnWidths,
    width,
    overflows: width > Math.floor(pageWidth),
    lineHeight,
    paddingX,
    paddingY,
    rows,
    headerRowCount,
  };
}

function groupHeight(plan: TablePlan, first: number): number {
  const end = plan.rows[first]!.groupEnd;
  let height = 0;
  for (let index = first; index <= end; index++)
    height += plan.rows[index]!.height;
  return height;
}

function headerHeight(plan: TablePlan): number {
  let height = 0;
  for (let index = 0; index < plan.headerRowCount; index++)
    height += plan.rows[index]!.height;
  return height;
}

/**
 * The least height of a group's part on a page with `room` left: the whole
 * group, or the first lines of a single row that may split there.
 */
function leastGroupHeight(
  plan: TablePlan,
  first: number,
  room: { remaining: number; pageHeight: number } | undefined,
): number {
  const whole = groupHeight(plan, first);
  if (!room || plan.rows[first]!.groupEnd !== first) return whole;
  if (room.remaining < room.pageHeight * SPLIT_ROOM_SHARE) return whole;
  return Math.min(whole, plan.paddingY * 2 + MIN_SPLIT_LINES * plan.lineHeight);
}

/**
 * The least height a table needs at the foot of a page: its header and its
 * first group of body rows, or with `room`, that group's first lines where
 * it may split. A caption kept with the table uses it without `room`.
 */
export function getTableStartHeight(
  plan: TablePlan,
  room?: { remaining: number; pageHeight: number },
): number {
  if (plan.rows.length === 0) return 0;
  const header = headerHeight(plan);
  // The split rule applies to the room left under the header.
  const bodyRoom = room && { ...room, remaining: room.remaining - header };
  const firstBody =
    plan.headerRowCount < plan.rows.length
      ? leastGroupHeight(plan, plan.headerRowCount, bodyRoom)
      : 0;
  return header + firstBody;
}

function cellSlice(
  plan: TablePlan,
  cell: PlacedCell,
  lines: PageLine[],
): TextSlice {
  return {
    type: "text",
    blockId: cell.spec.blockId,
    tag: cell.tag,
    lineHeight: plan.lineHeight,
    textAlign: "left",
    renderMode: "native",
    lines,
  };
}

function sliceRow(
  plan: TablePlan,
  row: PlannedRow,
  options: {
    repeated: boolean;
    continued: boolean;
    height: number;
    lines?: { from: number; count: number };
    /** Rows of this part from this row on, to clip row spans. */
    rowsLeftInPart: number;
  },
): TableSliceRow {
  const cells: TableSliceCell[] = row.cells.map((cell) => ({
    slice: cellSlice(
      plan,
      cell,
      options.lines
        ? cell.lines.slice(
            options.lines.from,
            options.lines.from + options.lines.count,
          )
        : cell.lines,
    ),
    column: cell.column,
    colSpan: cell.spec.colSpan,
    rowSpan: Math.min(cell.spec.rowSpan, options.rowsLeftInPart),
    header: cell.spec.header,
  }));
  return {
    index: row.index,
    header: row.header,
    height: options.height,
    repeated: options.repeated,
    continued: options.continued,
    cells,
  };
}

/** Where `layoutTablePages` puts the parts of a table. */
export interface TablePageCursor {
  /** Height left on the current page. */
  remaining: () => number;
  /** The current page holds nothing yet. */
  isEmpty: () => boolean;
  /** Full height of a page. */
  pageHeight: number;
  place: (slice: TableSlice) => void;
  breakPage: () => void;
}

/**
 * Lays a planned table across pages: whole groups of rows where they fit,
 * the header again at the top of each continuation page, and a row split
 * between its lines where it is too tall for a page, or where keeping it
 * whole would leave much of the page empty.
 */
export function layoutTablePages(plan: TablePlan, page: TablePageCursor): void {
  const header = headerHeight(plan);
  let rows: TableSliceRow[] = [];
  let partHeight = 0;
  let partHasBody = false;
  let headerShown = false;

  const flush = () => {
    if (rows.length === 0) return;
    page.place({
      type: "table",
      blockId: plan.tableId,
      columnWidths: plan.columnWidths,
      width: plan.width,
      height: partHeight,
      overflows: plan.overflows,
      cellPaddingX: plan.paddingX,
      cellPaddingY: plan.paddingY,
      rows,
    });
    rows = [];
    partHeight = 0;
    partHasBody = false;
  };

  const pushRow = (
    row: PlannedRow,
    options: Parameters<typeof sliceRow>[2],
  ) => {
    rows.push(sliceRow(plan, row, options));
    partHeight += options.height;
  };

  /** Whether a page break now moves anything: this page holds or will hold content. */
  const canBreak = () =>
    partHasBody || rows.some((row) => !row.repeated) || !page.isEmpty();

  const startContinuation = () => {
    flush();
    page.breakPage();
    // Repeat a header already shown, where it leaves room for body rows.
    if (!headerShown || header * 2 > page.pageHeight) return;
    for (let index = 0; index < plan.headerRowCount; index++) {
      const row = plan.rows[index]!;
      pushRow(row, {
        repeated: true,
        continued: false,
        height: row.height,
        rowsLeftInPart: plan.headerRowCount - index,
      });
    }
  };

  const available = () => page.remaining() - partHeight;
  const room = () => ({ remaining: available(), pageHeight: page.pageHeight });

  let index = 0;
  while (index < plan.rows.length) {
    const isHeader = index < plan.headerRowCount;
    const end = isHeader ? plan.headerRowCount - 1 : plan.rows[index]!.groupEnd;
    const height = isHeader ? header : groupHeight(plan, index);
    // The header goes with the first body group, or its first lines where
    // the room left under the header lets that group split.
    const needed =
      isHeader && end + 1 < plan.rows.length
        ? height +
          leastGroupHeight(plan, end + 1, {
            remaining: available() - height,
            pageHeight: page.pageHeight,
          })
        : height;

    if (needed <= available() || (height <= available() && !canBreak())) {
      for (let r = index; r <= end; r++) {
        const row = plan.rows[r]!;
        pushRow(row, {
          repeated: false,
          continued: false,
          height: row.height,
          rowsLeftInPart: end - r + 1,
        });
      }
      if (isHeader) headerShown = true;
      else partHasBody = true;
      index = end + 1;
      continue;
    }
    const least = isHeader ? height : leastGroupHeight(plan, index, room());
    const splitsHere = least < height && least <= available();
    if (!splitsHere && canBreak()) {
      startContinuation();
      continue;
    }

    // Split the group's rows between lines, one row at a time: a single row
    // where the page has room, or any group taller than an empty page. Row
    // spans in the group are clipped to each piece.
    for (let r = index; r <= end; r++) {
      const row = plan.rows[r]!;
      const lineCount = Math.max(1, ...row.cells.map((c) => c.lines.length));
      let from = 0;
      while (from < lineCount) {
        const fit = Math.floor(
          (available() - plan.paddingY * 2) / plan.lineHeight,
        );
        const left = lineCount - from;
        if (fit < Math.min(left, MIN_SPLIT_LINES) && canBreak()) {
          startContinuation();
          continue;
        }
        const count = Math.max(1, Math.min(left, fit));
        pushRow(row, {
          repeated: false,
          continued: from > 0,
          // The lines this piece shows, row spans clipped to it included.
          height: plan.paddingY * 2 + count * plan.lineHeight,
          lines: { from, count },
          rowsLeftInPart: 1,
        });
        if (isHeader) headerShown = true;
        else partHasBody = true;
        from += count;
        if (from < lineCount) startContinuation();
      }
    }
    index = end + 1;
  }
  flush();
}
