import type { NoteAnchor, NoteTarget } from "@/types/note";
import type { Highlight } from "@/types/highlight";
import {
  prepareBlocks,
  type ContentAnchor,
  type ResolvedSpread,
  type PaginationConfig,
} from "@/lib/pagination-v2";
import {
  canonicalOffsetToContentAnchor,
  resolveTextAnchorToCanonicalOffset,
} from "@/lib/pagination-v2/engine/highlight-selection";
import type { ReaderSessionChapterAccess } from "./hooks/use-reader-session";
import type { ChapterEntry } from "./types";

export function highlightNoteTarget(
  highlight: Highlight,
  existing: boolean,
): NoteTarget {
  const { spineItemId, startOffset, endOffset, textBefore, textAfter } =
    highlight;
  const anchor = { spineItemId, startOffset, endOffset, textBefore, textAfter };
  return existing
    ? {
        kind: "highlight",
        anchor,
        highlightId: highlight.id,
        quote: { text: highlight.selectedText, color: highlight.color },
      }
    : { kind: "selection", anchor, text: highlight.selectedText };
}

/** Conversion uses the same canonical text and prepared runs as highlight storage. */
export function createNoteLocationResolver(
  chapters: ChapterEntry[],
  access: ReaderSessionChapterAccess,
  config: PaginationConfig,
) {
  const prepared = new Map<number, ReturnType<typeof prepareBlocks>>();
  function source(index: number) {
    const chapterBlocks = access.getBlocks(index);
    const chapterCanonicalText = access.getCanonicalText(index);
    if (!chapterBlocks || !chapterCanonicalText) return null;
    let preparedChapter = prepared.get(index);
    if (!preparedChapter) {
      preparedChapter = prepareBlocks(chapterBlocks, config.fontConfig, {
        publisherBookStylingEnabled:
          config.publisherBookStylingEnabled ?? false,
      });
      prepared.set(index, preparedChapter);
    }
    return { chapterBlocks, chapterCanonicalText, preparedChapter };
  }
  return {
    resolve(anchor: NoteAnchor): ContentAnchor | null {
      const chapterIndex = chapters.findIndex(
        (chapter) => chapter.spineItemId === anchor.spineItemId,
      );
      const data = source(chapterIndex);
      if (
        !data ||
        anchor.startOffset > data.chapterCanonicalText.fullText.length
      )
        return null;
      const text = data.chapterCanonicalText.fullText;
      if (
        (anchor.textBefore &&
          text.slice(
            Math.max(0, anchor.startOffset - anchor.textBefore.length),
            anchor.startOffset,
          ) !== anchor.textBefore) ||
        (anchor.textAfter &&
          text.slice(
            anchor.endOffset,
            anchor.endOffset + anchor.textAfter.length,
          ) !== anchor.textAfter)
      )
        return null;
      if (!data.chapterCanonicalText.fullText && data.chapterBlocks[0])
        return {
          type: "block",
          chapterIndex,
          blockId: data.chapterBlocks[0].id,
        };
      return canonicalOffsetToContentAnchor({
        ...data,
        chapterIndex,
        offset: anchor.startOffset,
      });
    },
    capture(spread: ResolvedSpread | null): NoteTarget | null {
      for (const slot of spread?.slots ?? []) {
        if (slot.kind !== "page") continue;
        const chapterIndex = slot.page.chapterIndex;
        const data = source(chapterIndex);
        if (!data) return null;
        for (const slice of slot.page.content) {
          if (slice.type !== "text") continue;
          const offset =
            slice.lines[0]?.startOffset ??
            slice.lines[0]?.fragments[0]?.anchorStart;
          if (!offset) continue;
          const startOffset = resolveTextAnchorToCanonicalOffset({
            ...data,
            anchor: {
              type: "text",
              chapterIndex,
              blockId: slice.blockId,
              offset,
            },
          });
          if (startOffset === null) continue;
          const text = data.chapterCanonicalText.fullText;
          return {
            kind: "page",
            anchor: {
              spineItemId: chapters[chapterIndex].spineItemId,
              startOffset,
              endOffset: startOffset,
              textBefore: text.slice(
                Math.max(0, startOffset - 50),
                startOffset,
              ),
              textAfter: text.slice(startOffset, startOffset + 50),
            },
          };
        }
      }
      const first = spread?.slots.find((slot) => slot.kind === "page");
      if (first?.kind !== "page") return null;
      return {
        kind: "page",
        anchor: {
          spineItemId: chapters[first.page.chapterIndex].spineItemId,
          startOffset: 0,
          endOffset: 0,
          textBefore: "",
          textAfter: "",
        },
      };
    },
  };
}

/** Space between the margin rail and the text column, and the window edge. */
const MARGIN_RAIL_INSET = 16;
/** The narrowest rail that still holds a comfortable note field. */
const MARGIN_RAIL_MIN_WIDTH = 280;
const MARGIN_RAIL_MAX_WIDTH = 360;
/** A 36 px count button with the rail inset on each side. */
const MARGIN_COUNT_WIDTH = 36 + MARGIN_RAIL_INSET * 2;

/**
 * Places the desktop margin column in the right page margin, beside the text
 * column and never over it. A margin wide enough for the rail holds saved
 * notes and the composer. A narrower margin holds only a note count; new
 * notes then open in the notebook.
 */
export function marginPlacement(margin: number): {
  kind: "rail" | "count";
  left: string;
  width: number;
} {
  const width = Math.min(MARGIN_RAIL_MAX_WIDTH, margin - MARGIN_RAIL_INSET * 2);
  if (width < MARGIN_RAIL_MIN_WIDTH)
    return {
      kind: "count",
      left: `calc(100% - ${margin}px)`,
      width: Math.min(margin, MARGIN_COUNT_WIDTH),
    };
  return {
    kind: "rail",
    left: `calc(100% - ${margin - MARGIN_RAIL_INSET}px)`,
    width,
  };
}

/** Match the visible fragment containing the note, not a hidden neighbouring spread. */
export function noteMarginTop(anchor: ContentAnchor | null): number {
  if (!anchor) return 112;
  const fragments = document.querySelectorAll<HTMLElement>(
    `[data-reader-spread-layer="current"] [data-content-anchor-block-id="${CSS.escape(anchor.blockId)}"]`,
  );
  const compare = (a: number[], b: number[]) =>
    a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  for (const fragment of fragments) {
    if (anchor.type === "block") return fragment.getBoundingClientRect().top;
    const start = fragment.dataset.contentAnchorStart?.split(":").map(Number);
    const end = fragment.dataset.contentAnchorEnd?.split(":").map(Number);
    const offset = [
      anchor.offset.itemIndex,
      anchor.offset.segmentIndex,
      anchor.offset.graphemeIndex,
    ];
    if (start && end && compare(start, offset) <= 0 && compare(offset, end) < 0)
      return fragment.getBoundingClientRect().top;
  }
  return 112;
}
