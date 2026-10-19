import type {
  ContentAnchor,
  ResolvedLeafPage,
  ResolvedSpread,
  SpreadIntent,
} from "@/lib/pagination-v2";

/**
 * Where the reader is, in either reading mode.
 *
 * Pages mode derives it from the leading page of the current spread. Scroll
 * mode derives it from the chapter column: the page that holds the reading
 * line, and the anchor of the first line at the top of the view. Progress,
 * reading sessions, prompts and history read this instead of the spread, so
 * scrolling never has to drive the paged engine.
 */
export interface ReaderLocation {
  chapterIndex: number;
  /** Chapter-local page that holds the location. */
  pageIndexInChapter: number;
  totalPagesInChapter: number;
  /** Book page number, 1-based, counted as on the pages. */
  currentPage: number;
  totalPages: number;
  /** The exact place to restore, when one is known. */
  anchor: ContentAnchor | null;
  /** Why the location changed; previews are not saved. */
  intent: SpreadIntent;
}

type ResolvedPageSlot = Extract<
  ResolvedSpread["slots"][number],
  { kind: "page" }
>;

export function getLeadingVisiblePage(
  spread: ResolvedSpread | null,
): ResolvedLeafPage | null {
  return (
    spread?.slots.find((slot): slot is ResolvedPageSlot => slot.kind === "page")
      ?.page ?? null
  );
}

export function readerLocationFromSpread(
  spread: ResolvedSpread | null,
  anchor: ContentAnchor | null = null,
): ReaderLocation | null {
  const page = getLeadingVisiblePage(spread);
  if (!spread || !page) return null;
  return {
    chapterIndex: page.chapterIndex,
    pageIndexInChapter: Math.max(0, page.currentPageInChapter - 1),
    totalPagesInChapter: Math.max(1, page.totalPagesInChapter),
    currentPage: page.currentPage,
    totalPages: page.totalPages,
    anchor,
    intent: spread.intent,
  };
}

/** Chapter progress in percent, as the checkpoint and sessions store it. */
export function toChapterProgressPercent(location: ReaderLocation): number {
  if (location.totalPagesInChapter <= 1) return 0;
  const value =
    (location.pageIndexInChapter / (location.totalPagesInChapter - 1)) * 100;
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
}
