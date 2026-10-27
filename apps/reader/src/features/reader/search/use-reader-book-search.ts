import type { TOCItem } from "@/lib/db";
import {
  textSlicesOf,
  type ChapterCanonicalText,
  type ResolvedLeafPage,
  type ResolvedSpread,
} from "@/lib/pagination-v2";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useEffect, useRef, useState, type RefObject } from "react";
import type { UseReaderSessionResult } from "../hooks/use-reader-session";
import { useReaderSearch } from "./use-reader-search";
import { useSearchMarks } from "./use-search-marks";

const EMPTY_TOC: TOCItem[] = [];

/** The first page a spread shows. */
function leadingPage(spread: ResolvedSpread | null): ResolvedLeafPage | null {
  for (const slot of spread?.slots ?? [])
    if (slot.kind === "page") return slot.page;
  return null;
}

/** The canonical offset of the first text block a page shows, if loaded. */
function pageTextOffset(
  page: ResolvedLeafPage | null,
  getCanonicalText: (chapterIndex: number) => ChapterCanonicalText | null,
): number | null {
  if (!page) return null;
  const text = getCanonicalText(page.chapterIndex);
  for (const slice of page.content) {
    // A table's part starts at its first cell on this page.
    const blocks = slice.type === "table" ? textSlicesOf([slice]) : [slice];
    for (const block of blocks) {
      const start = text?.blockStarts.get(block.blockId);
      if (start !== undefined) return start;
    }
  }
  return null;
}

interface UseReaderBookSearchOptions {
  bookId: string | undefined;
  session: UseReaderSessionResult;
  /** The search sheet is open. */
  open: boolean;
  displayReady: boolean;
  settledPaintReady: boolean;
  /**
   * A query from Design ideas' `?search=` (Debug mode only): it steps to
   * the nearest match and leaves the book where its reader left it.
   */
  idea: string | null;
  /** The element that holds the text in view, and a key for its rows. */
  marks: {
    containerRef: RefObject<HTMLDivElement | null>;
    contentKey: string;
  };
  /** Opens the search sheet, for Command or Control + F. */
  onOpen: () => void;
}

/**
 * Searches the open book: the search worker, the marks on the pages in
 * view, and the browser's find shortcuts.
 */
export function useReaderBookSearch({
  bookId,
  session: { state, resources, actions },
  open,
  displayReady,
  settledPaintReady,
  idea,
  marks,
  onOpen,
}: UseReaderBookSearchOptions) {
  // The worker starts once the book has settled, or when search opens.
  const [started, setStarted] = useState(false);
  if ((open || idea) && !started) setStarted(true);
  const readerPage = leadingPage(state.pagination.spread);
  const search = useReaderSearch({
    bookId: bookId ?? "",
    enabled: started,
    warm: settledPaintReady,
    chapters: state.chapters.entries,
    toc: state.book?.toc ?? EMPTY_TOC,
    chapterAccess: resources.chapterAccess,
    highlights: state.highlights,
    locations: state.pagination.searchLocations,
    locateTextOffsets: resources.locateTextOffsets,
    layoutKey: `${state.pagination.status}:${state.navigation.totalPages}`,
    currentChapterIndex: state.navigation.currentChapterIndex,
    currentPageInChapter: readerPage?.currentPageInChapter ?? null,
    readerOffset:
      readerPage?.chapterIndex === state.navigation.currentChapterIndex
        ? pageTextOffset(readerPage, resources.chapterAccess.getCanonicalText)
        : null,
    goToTextOffset: actions.goToTextOffset,
    previewOnly: Boolean(idea),
  });
  const activeIndex = search.state.activeIndex;
  useSearchMarks({
    enabled: open || activeIndex !== null,
    // In scroll mode the column holds the text, and it mounts rows as the
    // reader scrolls.
    containerRef: marks.containerRef,
    contentKey: marks.contentKey,
    spread: state.pagination.spread,
    spreadWindow: state.pagination.spreadWindow,
    results: search.state.results,
    activeId:
      activeIndex === null
        ? null
        : (search.state.results[activeIndex]?.id ?? null),
    getCanonicalText: resources.chapterAccess.getCanonicalText,
  });
  const [focusRequest, setFocusRequest] = useState(0);

  const ideaStep = useRef<"query" | "open" | "done">("query");
  const { setQuery, next } = search;
  useEffect(() => {
    if (!idea || !displayReady) return;
    if (ideaStep.current === "query") {
      ideaStep.current = "open";
      setQuery(idea, { remember: false });
    } else if (
      ideaStep.current === "open" &&
      search.state.status === "done" &&
      search.state.results.length
    ) {
      ideaStep.current = "done";
      next();
    }
  }, [
    displayReady,
    next,
    search.state.results.length,
    search.state.status,
    idea,
    setQuery,
  ]);

  // Find next and previous, as in a browser.
  const stepEnabled = displayReady && search.state.results.length > 0;
  useHotkey(
    "Mod+G",
    (event) => {
      event.preventDefault();
      search.next();
    },
    {
      target: window,
      enabled: stepEnabled,
      ignoreInputs: false,
      stopPropagation: false,
      meta: { name: "Next search result", description: "Go to the next match" },
    },
  );
  useHotkey(
    "Mod+Shift+G",
    (event) => {
      event.preventDefault();
      search.previous();
    },
    {
      target: window,
      enabled: stepEnabled,
      ignoreInputs: false,
      stopPropagation: false,
      meta: {
        name: "Previous search result",
        description: "Go to the previous match",
      },
    },
  );
  useHotkey(
    "Mod+F",
    (event) => {
      event.preventDefault();
      if (!displayReady) return;
      onOpen();
      setFocusRequest((request) => request + 1);
    },
    {
      target: window,
      ignoreInputs: false,
      requireReset: true,
      stopPropagation: false,
      meta: {
        name: "Search book",
        description: "Find words in this book",
      },
    },
  );

  return { search, focusRequest };
}
