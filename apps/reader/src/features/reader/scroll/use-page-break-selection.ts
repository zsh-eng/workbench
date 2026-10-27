import type {
  Block,
  ChapterCanonicalText,
  FontConfig,
  PreparedBlock,
  ResolvedLeafPage,
  ResolvedSpread,
  TextCursorOffset,
} from "@/lib/pagination-v2";
import { textSlicesOf } from "@/lib/pagination-v2";
import { resolveTextAnchorToCanonicalOffset } from "@/lib/pagination-v2/engine/highlight-selection";
import { useEffect, useEffectEvent, useState, type RefObject } from "react";
import type { ReaderSessionChapterAccess } from "../hooks/use-reader-session";
import { preparedChapter } from "../prepared-chapter";
import {
  findPageBreakContinuation,
  type PageBreakContinuation,
  type PageTextBounds,
  type TextBlockRange,
} from "./page-break-continuation";
import { captureSelection, type SelectionLocators } from "./selection-transfer";

/** Waits out a drag of the selection's handles before measuring. */
const SETTLE_MS = 80;

export interface ClientBox {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * A page selection that a page break cuts: what it is missing, and where on
 * screen the cut is.
 */
export interface PageBreakSelection {
  locators: SelectionLocators;
  chapterIndex: number;
  /** The selection's own canonical range. */
  selection: { start: number; end: number };
  continuation: PageBreakContinuation;
  /** The cut page, chapter-local. */
  pageIndex: number;
  /** The cut page's own canonical text bounds. */
  pageText: PageTextBounds;
  /** Book page number of the page the continuation is on. */
  otherPageNumber: number;
  /** The selection's line box at the cut: its last line, or its first. */
  cut: ClientBox;
  /** The cut page's text column; its foot or head is the page edge. */
  page: ClientBox;
  /** The page's text face, so a preview reads like the page. */
  fontFamily: string;
}

export interface ResolvedSelectionRange {
  chapterIndex: number;
  startOffset: number;
  endOffset: number;
}

const blockRangesCache = new WeakMap<ChapterCanonicalText, TextBlockRange[]>();

/** The chapter's blocks in canonical order; each ends where the next starts. */
export function canonicalBlockRanges(
  text: ChapterCanonicalText,
): TextBlockRange[] {
  let ranges = blockRangesCache.get(text);
  if (!ranges) {
    const starts = [...text.blockStarts].sort((a, b) => a[1] - b[1]);
    ranges = starts.map(([blockId, start], index) => ({
      blockId,
      start,
      end: starts[index + 1]?.[1] ?? text.fullText.length,
    }));
    blockRangesCache.set(text, ranges);
  }
  return ranges;
}

function pageTextBounds(
  page: ResolvedLeafPage,
  blocks: Block[],
  prepared: PreparedBlock[],
  text: ChapterCanonicalText,
): PageTextBounds | null {
  const slices = textSlicesOf(page.content).filter(
    (slice) => slice.lines.length > 0,
  );
  const first = slices[0];
  const last = slices.at(-1);
  if (!first || !last) return null;
  const offset = (blockId: string, cursor: TextCursorOffset | undefined) =>
    cursor
      ? resolveTextAnchorToCanonicalOffset({
          anchor: {
            type: "text",
            chapterIndex: page.chapterIndex,
            blockId,
            offset: cursor,
          },
          chapterBlocks: blocks,
          preparedChapter: prepared,
          chapterCanonicalText: text,
        })
      : null;
  const firstLine = first.lines[0]!;
  const lastLine = last.lines.at(-1)!;
  const start = offset(first.blockId, firstLine.startOffset);
  const firstLineEnd = offset(first.blockId, firstLine.endOffset);
  const lastLineStart = offset(last.blockId, lastLine.startOffset);
  const end = offset(last.blockId, lastLine.endOffset);
  if (
    start === null ||
    end === null ||
    firstLineEnd === null ||
    lastLineStart === null
  ) {
    return null;
  }
  return { start, end, firstLineEnd, lastLineStart };
}

const box = (rect: DOMRect): ClientBox => ({
  top: rect.top,
  bottom: rect.bottom,
  left: rect.left,
  right: rect.right,
});

/**
 * A page selection that runs into the page break at the spread's outer
 * edges: the last page's last line, or the first page's first line. A
 * facing page in a two-page spread already shows the text across its
 * break, so the inner edges never count.
 *
 * It reports the rest of the sentence on the other page, so the reader can
 * bring it into the selection without hunting for the handles' limits.
 */
export function usePageBreakSelection({
  enabled,
  stageContentRef,
  spread,
  chapterAccess,
  fontConfig,
  publisherBookStylingEnabled,
  resolveSelectionRange,
}: {
  enabled: boolean;
  stageContentRef: RefObject<HTMLDivElement | null>;
  spread: ResolvedSpread | null;
  chapterAccess: ReaderSessionChapterAccess;
  fontConfig: FontConfig;
  publisherBookStylingEnabled: boolean;
  resolveSelectionRange: (
    selection: Selection,
  ) => ResolvedSelectionRange | null;
}): PageBreakSelection | null {
  const [state, setState] = useState<PageBreakSelection | null>(null);

  const measure = (): PageBreakSelection | null => {
    const layer = stageContentRef.current?.querySelector(
      '[data-reader-spread-layer="current"]',
    );
    const selection = window.getSelection();
    if (!enabled || !layer || !spread || !selection) return null;
    const locators = captureSelection(layer, selection);
    if (!locators) return null;
    const range = resolveSelectionRange(selection);
    if (!range) return null;

    const slots = spread.slots.flatMap((slot) =>
      slot.kind === "page" ? [slot] : [],
    );
    const candidates = [
      { edge: "end" as const, slot: slots.at(-1) },
      { edge: "start" as const, slot: slots[0] },
    ];
    const rects = Array.from(selection.getRangeAt(0).getClientRects()).filter(
      (rect) => rect.width > 0 && rect.height > 0,
    );
    for (const { edge, slot } of candidates) {
      if (!slot || slot.page.chapterIndex !== range.chapterIndex) continue;
      const blocks = chapterAccess.getBlocks(range.chapterIndex);
      const text = chapterAccess.getCanonicalText(range.chapterIndex);
      if (!blocks || !text) continue;
      const bounds = pageTextBounds(
        slot.page,
        blocks,
        preparedChapter(blocks, fontConfig, publisherBookStylingEnabled),
        text,
      );
      if (!bounds) continue;
      // The selection must touch this page, not only a facing one.
      if (range.endOffset <= bounds.start || range.startOffset >= bounds.end) {
        continue;
      }
      const continuation = findPageBreakContinuation({
        fullText: text.fullText,
        blocks: canonicalBlockRanges(text),
        selection: { start: range.startOffset, end: range.endOffset },
        page: bounds,
        edge,
      });
      if (!continuation) continue;

      const slotElement = layer.querySelector(
        `[data-reader-page-slot="${slot.slotIndex}"]`,
      );
      const textSlices = slotElement?.querySelectorAll<HTMLElement>(
        '[data-reader-slice-type="text"]',
      );
      const edgeSlice =
        edge === "end" ? textSlices?.[textSlices.length - 1] : textSlices?.[0];
      if (!slotElement || !edgeSlice) continue;
      const slotRect = slotElement.getBoundingClientRect();
      const onPage = rects.filter(
        (rect) => rect.right > slotRect.left && rect.left < slotRect.right,
      );
      if (!onPage.length) continue;
      // The line box at the cut: the selection's last line, or its first.
      const cutRect =
        edge === "end"
          ? onPage.reduce((last, rect) =>
              rect.bottom > last.bottom + 1 ||
              (Math.abs(rect.bottom - last.bottom) <= 1 &&
                rect.right > last.right)
                ? rect
                : last,
            )
          : onPage.reduce((first, rect) =>
              rect.top < first.top - 1 ||
              (Math.abs(rect.top - first.top) <= 1 && rect.left < first.left)
                ? rect
                : first,
            );
      const sliceRect = edgeSlice.getBoundingClientRect();
      const content =
        slotElement.querySelector("[data-reader-page-content]") ?? slotElement;
      const contentRect = content.getBoundingClientRect();
      const otherPageNumber = slot.page.currentPage + (edge === "end" ? 1 : -1);
      return {
        locators,
        chapterIndex: range.chapterIndex,
        selection: { start: range.startOffset, end: range.endOffset },
        continuation,
        pageIndex: slot.page.currentPageInChapter - 1,
        pageText: bounds,
        otherPageNumber,
        cut: box(cutRect),
        page: {
          top: edge === "start" ? sliceRect.top : contentRect.top,
          bottom: edge === "end" ? sliceRect.bottom : contentRect.bottom,
          left: contentRect.left,
          right: contentRect.right,
        },
        fontFamily: getComputedStyle(edgeSlice).fontFamily,
      };
    }
    return null;
  };

  const evaluate = useEffectEvent(() => {
    const next = measure();
    setState((current) =>
      current &&
      next &&
      current.continuation.start === next.continuation.start &&
      current.continuation.end === next.continuation.end &&
      current.cut.bottom === next.cut.bottom &&
      current.cut.right === next.cut.right &&
      current.cut.left === next.cut.left &&
      current.cut.top === next.cut.top
        ? current
        : next,
    );
  });

  useEffect(() => {
    if (!enabled) {
      setState(null);
      return;
    }
    let timer = 0;
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(evaluate, SETTLE_MS);
    };
    document.addEventListener("selectionchange", schedule);
    window.addEventListener("resize", schedule);
    schedule();
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("selectionchange", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [enabled, spread]);

  return state;
}
