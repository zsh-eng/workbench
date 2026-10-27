/**
 * How a chapter reads its tables (docs/0005-tables.md): as grids of rows
 * and cells, or each as one paragraph of its text. Grid costs grow with a
 * chapter's table cells, so Auto keeps Paragraph for a chapter with more
 * than `GRID_TABLE_CELL_LIMIT` of them. Debug mode can choose either for
 * every chapter.
 */
export type ReaderTablesMode = "auto" | "grid" | "flat";

/**
 * The most table cells a chapter reads as grids in Auto: the largest count
 * measured within the agreed cost (docs/0005-tables.md). The body cache
 * stores each chapter's canonical text for this choice, so a change here
 * needs a `READER_BODY_CACHE_SCHEMA_VERSION` bump.
 */
export const GRID_TABLE_CELL_LIMIT = 700;

/** Whether a chapter with `cellCount` table cells reads them as grids. */
export function chapterTablesAsGrid(
  cellCount: number,
  mode: ReaderTablesMode,
): boolean {
  if (cellCount === 0) return false;
  if (mode === "auto") return cellCount <= GRID_TABLE_CELL_LIMIT;
  return mode === "grid";
}

/** The table cells in a chapter's body: every `td` and `th`. */
export function countTableCells(body: Element): number {
  return body.querySelectorAll("td, th").length;
}
