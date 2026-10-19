import type { FontConfig, ResolvedSpread } from "@/lib/pagination-v2";
import { useEffect, useEffectEvent, useRef, type RefObject } from "react";
import type { ReaderSessionChapterAccess } from "../hooks/use-reader-session";
import { createColumnTextPoints, wordEnds } from "./column-text-points";
import {
  findCutSentence,
  type PageTextBounds,
} from "./page-break-continuation";
import {
  canonicalBlockRanges,
  readPageTextBounds,
} from "./use-page-break-selection";

/** Pages to look through for a sentence the break cuts. */
const MAX_PAGES = 30;
/** A demo selection reaches back at most this far into the sentence. */
const MAX_SELECTION_CHARS = 140;

/**
 * For Design ideas (`?selectDemo=1`): opens the first page from here whose
 * last sentence runs onto the next page, and selects the part on this page,
 * so each idea's affordance shows at once. Pages are previewed, so the
 * book's reading position and history stay where they were.
 *
 * `stopShort` ends the selection a few words before the break, for the
 * hold idea, where the reader drags the handle the rest of the way.
 */
export function useSelectAcrossDemo({
  enabled,
  ready,
  spread,
  chapterAccess,
  fontConfig,
  publisherBookStylingEnabled,
  stageContentRef,
  previewPage,
  refreshSelection,
  stopShort,
}: {
  enabled: boolean;
  ready: boolean;
  spread: ResolvedSpread | null;
  chapterAccess: ReaderSessionChapterAccess;
  fontConfig: FontConfig;
  publisherBookStylingEnabled: boolean;
  stageContentRef: RefObject<HTMLDivElement | null>;
  previewPage: (page: number) => void;
  refreshSelection: () => void;
  stopShort: boolean;
}) {
  const state = useRef<{ tries: number; done: boolean }>({
    tries: 0,
    done: false,
  });

  const step = useEffectEvent(() => {
    if (state.current.done || !spread) return;
    const slot = spread.slots
      .flatMap((candidate) => (candidate.kind === "page" ? [candidate] : []))
      .at(-1);
    if (!slot) return;
    const { page } = slot;
    const blocks = chapterAccess.getBlocks(page.chapterIndex);
    const text = chapterAccess.getCanonicalText(page.chapterIndex);
    const bounds: PageTextBounds | null =
      blocks && text
        ? readPageTextBounds(
            page,
            blocks,
            text,
            fontConfig,
            publisherBookStylingEnabled,
          )
        : null;
    const cut =
      bounds && text
        ? findCutSentence(text.fullText, canonicalBlockRanges(text), bounds)
        : null;
    const layer = stageContentRef.current?.querySelector(
      '[data-reader-spread-layer="current"]',
    );
    if (!cut || !bounds || !text || !layer) {
      if (state.current.tries++ >= MAX_PAGES) {
        state.current.done = true;
        return;
      }
      previewPage(page.currentPage + 1);
      return;
    }
    state.current.done = true;
    // From the sentence's start on this page, or a few lines up a long one.
    const lower = Math.max(bounds.start, bounds.end - MAX_SELECTION_CHARS);
    let start = Math.max(cut.start, lower);
    if (start > cut.start) {
      // The next word's start.
      while (start < bounds.end && /\S/.test(text.fullText[start - 1] ?? " "))
        start++;
      while (start < bounds.end && /\s/.test(text.fullText[start] ?? ""))
        start++;
    }
    const ends = wordEnds(text.fullText, start, bounds.end);
    // The hold idea leaves the last few words for the reader to drag to.
    const end = stopShort ? (ends.at(-3) ?? bounds.end) : bounds.end;
    const points = createColumnTextPoints(layer, {
      fullText: text.fullText,
      blocks: canonicalBlockRanges(text),
    });
    const anchor = points.start(start);
    const focus = points.end(end);
    const selection = window.getSelection();
    if (!anchor || !focus || !selection) return;
    selection.setBaseAndExtent(
      anchor.node,
      anchor.offset,
      focus.node,
      focus.offset,
    );
    refreshSelection();
  });

  // Each new page gets a moment to paint before it is read.
  useEffect(() => {
    if (!enabled || !ready || !spread) return;
    const timer = window.setTimeout(step, 320);
    return () => window.clearTimeout(timer);
  }, [enabled, ready, spread]);
}
