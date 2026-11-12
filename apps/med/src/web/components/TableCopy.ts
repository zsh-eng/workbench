import type { RefObject } from "react";
import { copyTable } from "../markdown/copy";
import { copyFrame, useCopyFrames } from "./CopyFrame";

/**
 * Each table in a frame with its Copy button (CopyFrame.ts), which sits in
 * the margin above the table's right end (MarkdownPreview.css).
 */
function frameTables(host: HTMLElement, note: boolean) {
  for (const table of host.querySelectorAll<HTMLTableElement>("table")) {
    if (table.parentElement?.classList.contains("med-md-table")) continue;
    copyFrame(table, "table", "Copy table", note);
  }
}

/**
 * Copy on the tables of rendered Markdown: as their Markdown, from the lines
 * of `text()` that they came from, and as a table that rich editors and
 * spreadsheets paste. `say` tells the page's own notice what happened;
 * without it, each table's note does.
 */
export function useTableCopy(
  host: RefObject<HTMLElement | null>,
  text: () => string,
  say?: (message: string, failed?: boolean) => void,
) {
  const note = !say;
  useCopyFrames(
    host,
    "table",
    {
      frame: (node) => frameTables(node, note),
      copy: (frame) => copyTable(text(), frame.querySelector<HTMLElement>(":scope > table")!),
      done: "Table copied",
      say,
    },
    note,
  );
}
