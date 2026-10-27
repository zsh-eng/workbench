import type { LayoutCursor, PreparedTextWithSegments } from "@chenglou/pretext";

// ---------------------------------------------------------------------------
// Stage 1: Block types (output of parseChapterHtml)
// ---------------------------------------------------------------------------

export type BlockTag =
  | "p"
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "h5"
  | "h6"
  | "li"
  | "blockquote"
  | "pre"
  | "figcaption"
  | "td"
  | "th";

export interface LinkRef {
  href: string;
}

export type InlineRole = "superscript" | "note-ref";

export interface TextRun {
  kind: "text";
  text: string;
  hardBreak?: boolean;
  bold: boolean;
  italic: boolean;
  isCode: boolean;
  publisherInlineStyle?: PublisherInlineStyle;
  inlineRole?: InlineRole;
  link?: LinkRef;
  targetIds?: string[];
  highlightMarks?: HighlightMark[];
}

export type InlineRun = TextRun;

export interface HighlightMark {
  id: string;
  color?: string;
  isStart?: boolean;
  isEnd?: boolean;
}

export interface TextBlock {
  type: "text";
  id: string;
  tag: BlockTag;
  targetIds?: string[];
  pageBreakHints?: BookPageBreakHints;
  publisherStyle?: PublisherTextStyle;
  publisherFontFaces?: PublisherFontFace[];
  runs: InlineRun[];
  /**
   * A table read as one paragraph: where each of its cells starts in the
   * text, numbered as its grid numbers them (`${id}-c${n}`). A reading place
   * saved in a cell maps to the paragraph with it.
   */
  tableCellStarts?: number[];
}

export interface ImageBlock {
  type: "image";
  id: string;
  targetIds?: string[];
  pageBreakHints?: BookPageBreakHints;
  src: string;
  alt?: string;
  intrinsicWidth: number;
  intrinsicHeight: number;
}

export interface SpacerBlock {
  type: "spacer";
  id: string;
  targetIds?: string[];
  pageBreakHints?: BookPageBreakHints;
}

export interface PageBreakBlock {
  type: "page-break";
  id: string;
  targetIds?: string[];
}

/**
 * One cell of a table: the id of the text block that holds its text, which
 * follows the table in the chapter's blocks. An empty cell has an id but no
 * text block.
 */
export interface TableCellSpec {
  blockId: string;
  header: boolean;
  colSpan: number;
  rowSpan: number;
  /** The cell's own or its row's `align` or inline `text-align`. */
  align?: "center" | "right";
  /** The cell's own or its row's `valign` or inline `vertical-align`. */
  valign?: "middle" | "bottom";
}

export interface TableRowSpec {
  /** A `<thead>` row: it repeats at the top of each continuation page. */
  header: boolean;
  cells: TableCellSpec[];
}

/**
 * A table's grid. Its cells' text blocks follow it in row-major order, so
 * anchors, highlights, search and copy treat each cell as a text block.
 */
export interface TableBlock {
  type: "table";
  id: string;
  targetIds?: string[];
  pageBreakHints?: BookPageBreakHints;
  rows: TableRowSpec[];
  /** The table's name for assistive technology: its caption's text. */
  label?: string;
  /**
   * The table as the paragraph Paragraph mode reads, with the same id. A
   * reading place saved in that paragraph maps to the cell that holds it.
   */
  paragraph?: TextBlock;
}

export type Block =
  | TextBlock
  | ImageBlock
  | SpacerBlock
  | PageBreakBlock
  | TableBlock;

// ---------------------------------------------------------------------------
// Stage 2: FontConfig + PreparedBlock types
// ---------------------------------------------------------------------------

export interface FontConfig {
  bodyFamily: string;
  headingFamily: string;
  codeFamily: string;
  baseSizePx: number;
}

export type PublisherBlockRole =
  | "body"
  | "heading"
  | "blockquote"
  | "caption"
  | "epigraph"
  | "comment"
  | "note"
  | "frontBack"
  | "list"
  | "pre";

export interface PublisherTextStyle {
  role: PublisherBlockRole;
  fontFamily?: string;
  fontScale?: number;
  fontWeight?: number;
  fontStyle?: "normal" | "italic" | "oblique";
  lineHeightFactor?: number;
  textAlign?: "left" | "center" | "right" | "justify";
  textIndent?: PublisherLength;
  margin?: PublisherBox;
}

export interface PublisherInlineStyle {
  fontFamily?: string;
  fontScale?: number;
  fontWeight?: number;
  fontStyle?: "normal" | "italic" | "oblique";
  displayBlock?: boolean;
}

export interface PublisherLength {
  em?: number;
  percent?: number;
}

export interface PublisherBox {
  before?: PublisherLength;
  after?: PublisherLength;
  left?: PublisherLength;
  right?: PublisherLength;
}

export interface BookStylesheet {
  cssText: string;
  basePath: string;
  resourcePath?: string;
}

export interface PublisherFontFace {
  family: string;
  src: string;
  descriptors: FontFaceDescriptors;
}

export interface PublisherStyleOptions {
  publisherBookStylingEnabled?: boolean;
  matchPublisherBodyTextSize?: boolean;
  publisherBodyFontScale?: number;
}

export interface BookPageBreakHints {
  breakBefore?: "page";
  breakAfter?: "page" | "avoid";
  breakInside?: "avoid";
}

export interface PreparedTextItem {
  kind: "text";
  font: string;
  fontScale: number;
  inlineRole?: InlineRole;
  link?: LinkRef;
  targetIds?: string[];
  isCode: boolean;
  highlightMarks?: HighlightMark[];
  chromeWidth: number;
  prepared: PreparedTextWithSegments;
  rawText: string;
  fullText: string;
  fullWidth: number;
  endCursor: LayoutCursor;
  leadingGap: number;
}

export type PreparedInlineItem = PreparedTextItem;

export interface PreparedTextBlock {
  type: "text";
  id: string;
  tag: BlockTag;
  targetIds?: string[];
  pageBreakHints?: BookPageBreakHints;
  publisherStyle?: PublisherTextStyle;
  items: PreparedInlineItem[];
  containsNewlines: boolean;
}

export interface PreparedImageBlock {
  type: "image";
  id: string;
  targetIds?: string[];
  pageBreakHints?: BookPageBreakHints;
  src: string;
  alt?: string;
  intrinsicWidth: number;
  intrinsicHeight: number;
}

export interface PreparedSpacerBlock {
  type: "spacer";
  id: string;
  targetIds?: string[];
  pageBreakHints?: BookPageBreakHints;
}

export interface PreparedPageBreakBlock {
  type: "page-break";
  id: string;
  targetIds?: string[];
}

/** A table passes through preparation; its cells are prepared text blocks. */
export type PreparedTableBlock = TableBlock;

export type PreparedBlock =
  | PreparedTextBlock
  | PreparedImageBlock
  | PreparedSpacerBlock
  | PreparedPageBreakBlock
  | PreparedTableBlock;

export interface ChapterCanonicalText {
  fullText: string;
  blockStarts: ReadonlyMap<string, number>;
}

// ---------------------------------------------------------------------------
// Stage 3: LayoutTheme + output types
// ---------------------------------------------------------------------------

export interface LayoutTheme {
  lineHeightFactor: number;
  paragraphSpacingFactor: number;
  textAlign: "left" | "center" | "right" | "justify" | "justify-knuth-plass";
  baseFontSizePx: number;
}

export interface PaginationConfig {
  fontConfig: FontConfig;
  layoutTheme: LayoutTheme;
  publisherBookStylingEnabled?: boolean;
  viewport: { width: number; height: number };
}

export interface PageFragment {
  kind: "text" | "space";
  text: string;
  font: string;
  leadingGap: number;
  inlineRole?: InlineRole;
  link?: LinkRef;
  isCode: boolean;
  highlightMarks?: HighlightMark[];
  marginRightPx?: number;
  anchorStart?: TextCursorOffset;
  anchorEnd?: TextCursorOffset;
}

export interface TextCursorOffset {
  itemIndex: number;
  segmentIndex: number;
  graphemeIndex: number;
}

export interface PageLine {
  fragments: PageFragment[];
  startOffset?: TextCursorOffset;
  endOffset?: TextCursorOffset;
  isLastInBlock: boolean;
  wordSpacingPx?: number;
  indentPx?: number;
}

export type TextRenderMode = "native" | "manual-justify";

export interface TextSlice {
  type: "text";
  blockId: string;
  tag: BlockTag;
  publisherStyle?: PublisherTextStyle;
  lineHeight: number;
  textAlign: "left" | "center" | "right" | "justify" | "justify-knuth-plass";
  renderMode: TextRenderMode;
  marginLeftPx?: number;
  marginRightPx?: number;
  lines: PageLine[];
}

export interface ImageSlice {
  type: "image";
  blockId: string;
  src: string;
  alt?: string;
  width: number;
  height: number;
}

export interface SpacerSlice {
  type: "spacer";
  blockId: string;
  height: number;
}

/** One cell on a page: its text slice (no lines when empty) and place. */
export interface TableSliceCell {
  slice: TextSlice;
  column: number;
  colSpan: number;
  rowSpan: number;
  header: boolean;
  valign?: "middle" | "bottom";
}

export interface TableSliceRow {
  /** The row's index in the table. */
  index: number;
  /** A header row (`<thead>`, or a first row of header cells). */
  header: boolean;
  height: number;
  /**
   * A header row shown again at the top of a continuation page. Its text
   * belongs to the first page, so it carries no anchors.
   */
  repeated: boolean;
  /** The row continues from the page before, split at a line. */
  continued: boolean;
  cells: TableSliceCell[];
}

/** The rows of a table that fit one page, at the widths the worker chose. */
export interface TableSlice {
  type: "table";
  blockId: string;
  columnWidths: number[];
  /** Sum of the column widths; wider than the page when `overflows`. */
  width: number;
  height: number;
  /** The table cannot fit the page and scrolls sideways. */
  overflows: boolean;
  cellPaddingX: number;
  cellPaddingY: number;
  rows: TableSliceRow[];
  /** The table's caption text, as its accessible name. */
  label?: string;
}

export type PageSlice = TextSlice | ImageSlice | SpacerSlice | TableSlice;

/**
 * The text slices a page shows, with each table's cells in reading order.
 * Repeated header rows are left out: their text belongs to an earlier page.
 */
export function textSlicesOf(slices: readonly PageSlice[]): TextSlice[] {
  const result: TextSlice[] = [];
  for (const slice of slices) {
    if (slice.type === "text") result.push(slice);
    if (slice.type !== "table") continue;
    for (const row of slice.rows) {
      if (row.repeated) continue;
      for (const cell of row.cells) result.push(cell.slice);
    }
  }
  return result;
}

/** Whether a slice is, or holds, the block `blockId`. */
export function sliceShowsBlock(slice: PageSlice, blockId: string): boolean {
  if (slice.blockId === blockId) return true;
  if (slice.type !== "table") return false;
  return slice.rows.some(
    (row) =>
      !row.repeated && row.cells.some((cell) => cell.slice.blockId === blockId),
  );
}

export interface Page {
  index: number;
  slices: PageSlice[];
}

export interface PaginationDiagnostics {
  blockCount: number;
  lineCount: number;
  computeMs: number;
  stage2PrepareMs?: number;
  stage3LayoutMs?: number;
  totalMs?: number;
  chapterCount?: number;
  chapterTimings?: PaginationChapterDiagnostics[];
}

export interface PaginationChapterDiagnostics {
  chapterIndex: number;
  blockCount: number;
  lineCount: number;
  pageCount: number;
  stage2PrepareMs?: number;
  stage3LayoutMs?: number;
  totalMs?: number;
}

export interface PaginationResult {
  pages: Page[];
  diagnostics: PaginationDiagnostics;
}

export function areFontConfigsEqual(a: FontConfig, b: FontConfig): boolean {
  return (
    a.bodyFamily === b.bodyFamily &&
    a.headingFamily === b.headingFamily &&
    a.codeFamily === b.codeFamily &&
    a.baseSizePx === b.baseSizePx
  );
}
