import type { Book } from "@/lib/db";
import type {
  Block,
  ChapterCanonicalText,
  ChapterColumnLayout,
  ContentAnchor,
  PaginationConfig,
  PaginationStatus,
  ResolvedSpread,
  ResolvedSpreadWindow,
  SpreadConfig,
  SpreadIntent,
} from "@/lib/pagination-v2";
import type { TextOffsetLocation } from "@/lib/pagination-v2/protocol";
import type { Highlight } from "@/types/highlight";
import type { ReaderLocation } from "../reader-location";
import type { ReaderSettings } from "@/types/reader.types";
import { useMemo } from "react";
import type { ChapterEntry } from "../types";
import { useReaderCore } from "./use-reader-core";
import { useReaderHighlightActions } from "./use-reader-highlight-actions";
import {
  useReaderNavigationActions,
  type ReaderNavigationActions,
} from "./use-reader-navigation-actions";

const EMPTY_HISTORY_PAGES: Record<string, number | null> = {};
const EMPTY_SEARCH_LOCATIONS: Record<string, TextOffsetLocation | null> = {};

export interface UseReaderSessionOptions {
  bookId?: string;
  viewport: { width: number; height: number };
  spreadColumns: 1 | 2 | 3;
  paragraphSpacingFactor?: number;
  /** Prevents the first pagination run until the real reader stage is known. */
  layoutReady?: boolean;
  /** Scroll mode's location; page numbers and progress follow it while set. */
  scrollLocation?: ReaderLocation | null;
}

export type ReaderSessionStatus =
  "loading" | "ready" | "not-found" | "file-error";

export interface ReaderSessionChapterAccess {
  getBlocks: (chapterIndex: number) => Block[] | null;
  getCanonicalText: (chapterIndex: number) => ChapterCanonicalText | null;
}

export interface ReaderSessionChaptersState {
  /**
   * Spine-backed chapter metadata used by reader UI like chapter navigation and
   * labels. Similar to table-of-contents entries, but aligned to the exact
   * chapter sources loaded into pagination.
   */
  entries: ChapterEntry[];
}

export interface ReaderSessionNavigationState {
  currentPage: number;
  totalPages: number;
  canGoPrev: boolean;
  canGoNext: boolean;
  currentChapterIndex: number;
  /** Chapter presented as active in reader chrome and contents. */
  displayChapterIndex: number | null;
  chapterStartPages: (number | null)[];
}

export interface ReaderSessionPaginationState {
  anchorPages: Record<string, number | null>;
  historyAnchorPages: Record<string, number | null>;
  /** Pages of the notebook's highlights, located in their own scope. */
  highlightAnchorPages: Record<string, number | null>;
  /** Where search matches sit, by match id, once located. */
  searchLocations: Record<string, TextOffsetLocation | null>;
  spread: ResolvedSpread | null;
  spreadWindow: ResolvedSpreadWindow | null;
  status: PaginationStatus;
  spreadConfig: SpreadConfig;
  paginationConfig: PaginationConfig;
  /** The subscribed chapter's scroll column (prototype scroll mode). */
  scrollColumn: ChapterColumnLayout | null;
}

export interface ReaderSessionState {
  historyPresentation: ReturnType<
    typeof useReaderCore
  >["jumpHistory"]["presentation"];
  jumpHistory: ReturnType<typeof useReaderCore>["jumpHistory"]["state"];
  status: ReaderSessionStatus;
  book: Book | null;
  settings: ReaderSettings;
  highlights: Highlight[];
  chapters: ReaderSessionChaptersState;
  pagination: ReaderSessionPaginationState;
  navigation: ReaderSessionNavigationState;
}

export interface ReaderSessionResources {
  locateAnchors: ReturnType<
    typeof useReaderCore
  >["pagination"]["locateAnchors"];
  locateTextOffsets: ReturnType<
    typeof useReaderCore
  >["pagination"]["locateTextOffsets"];
  chapterAccess: ReaderSessionChapterAccess;
}

export interface ReaderSessionActions {
  selectHistoryVisit: (index: number) => void;
  setHistoryExpanded: (expanded: boolean) => void;
  goBackInHistory: () => void;
  goForwardInHistory: () => void;
  endHistoryGroup: () => void;
  updateSettings: (patch: Partial<ReaderSettings>) => void;
  nextSpread: ReaderNavigationActions["nextSpread"];
  prevSpread: ReaderNavigationActions["prevSpread"];
  previewPage: ReaderNavigationActions["previewPage"];
  commitPage: ReaderNavigationActions["commitPage"];
  jumpToHandoffPage: ReaderNavigationActions["jumpToHandoffPage"];
  goToChapter: ReaderNavigationActions["goToChapter"];
  goToPreviousChapter: ReaderNavigationActions["goToPreviousChapter"];
  goToNextChapter: ReaderNavigationActions["goToNextChapter"];
  openInternalHref: ReaderNavigationActions["openInternalHref"];
  openTocHref: ReaderNavigationActions["openTocHref"];
  goToNotePage: ReaderNavigationActions["goToNotePage"];
  goToHighlight: ReaderNavigationActions["goToHighlight"];
  /**
   * Opens the page holding a canonical text offset, such as a search result,
   * as a jump the reader can go back from.
   */
  /** Opens canonical text as a jump, or for search, as a preview only. */
  goToTextOffset: (
    chapterIndex: number,
    offset: number,
    source: "search" | "highlight" | "note" | "search-preview",
  ) => void;
  createHighlight: (highlight: Highlight) => void;
  resumeBackgroundLoad: () => void;
  /** Subscribes one chapter's scroll column; null stops the updates. */
  setScrollChapter: (chapterIndex: number | null) => void;
  goToAnchor: (anchor: ContentAnchor, intent: SpreadIntent) => void;
}

export interface UseReaderSessionResult {
  /**
   * State for rendering in the UI.
   */
  state: ReaderSessionState;
  /**
   * Stable helper accessors.
   * Required for setting up certain advanced logic like handling highlights.
   */
  resources: ReaderSessionResources;
  /**
   * Actions against the reader, such as navigating between pages.
   */
  actions: ReaderSessionActions;
}

/**
 * Facade around the current Reader core wiring.
 *
 * The goal is to expose a "reading session" API to UI components rather than
 * the raw mix of pagination internals, chapter source plumbing, and derived
 * values. This keeps the UI focused on rendering and user interaction while we
 * continue splitting the underlying modules behind this boundary.
 */
export function useReaderSession(
  options: UseReaderSessionOptions,
): UseReaderSessionResult {
  const core = useReaderCore(options);
  const { createHighlight } = useReaderHighlightActions(options.bookId);

  const navigationActions = useReaderNavigationActions({
    pagination: core.pagination,
    currentChapterIndex: core.currentChapterIndex,
    chapterEntries: core.chapterEntries,
  });

  const chapterAccess = useMemo<ReaderSessionChapterAccess>(
    () => ({
      getBlocks: core.getChapterBlocks,
      getCanonicalText: core.getChapterCanonicalText,
    }),
    [core.getChapterBlocks, core.getChapterCanonicalText],
  );

  const state = useMemo<ReaderSessionState>(() => {
    const status: ReaderSessionStatus = core.isBookLoading
      ? "loading"
      : !options.bookId || !core.book
        ? "not-found"
        : core.epubProcessError
          ? "file-error"
          : options.layoutReady === false || !core.pagination.spread
            ? "loading"
            : "ready";

    return {
      status,
      jumpHistory: core.jumpHistory.state,
      historyPresentation: core.jumpHistory.presentation,
      book: core.book,
      settings: core.settings,
      highlights: core.bookHighlights,
      chapters: {
        entries: core.chapterEntries,
      },
      pagination: {
        anchorPages: core.pagination.anchorPages,
        historyAnchorPages:
          core.pagination.anchorPagesByScope.history ?? EMPTY_HISTORY_PAGES,
        highlightAnchorPages:
          core.pagination.anchorPagesByScope["notebook-highlights"] ??
          EMPTY_HISTORY_PAGES,
        searchLocations:
          core.pagination.textOffsetsByScope.search ?? EMPTY_SEARCH_LOCATIONS,
        spread: core.pagination.spread,
        spreadWindow: core.pagination.spreadWindow,
        status: core.pagination.status,
        spreadConfig: core.spreadConfig,
        paginationConfig: core.paginationConfig,
        scrollColumn: core.pagination.scrollColumn,
      },
      navigation: {
        currentPage: core.currentPage,
        totalPages: core.totalPages,
        canGoPrev: core.currentPage > 1,
        canGoNext: !(
          core.pagination.status === "ready" &&
          core.totalPages > 0 &&
          core.currentPage >= core.totalPages
        ),
        currentChapterIndex: core.currentChapterIndex,
        displayChapterIndex: core.displayChapterIndex,
        chapterStartPages: core.chapterStartPages,
      },
    };
  }, [
    core.jumpHistory.state,
    core.jumpHistory.presentation,
    core.pagination.anchorPagesByScope,
    core.pagination.textOffsetsByScope,
    core.book,
    core.bookHighlights,
    core.chapterEntries,
    core.chapterStartPages,
    core.currentChapterIndex,
    core.currentPage,
    core.displayChapterIndex,
    core.epubProcessError,
    core.isBookLoading,
    core.pagination.anchorPages,
    core.pagination.spread,
    core.pagination.spreadWindow,
    core.pagination.status,
    core.pagination.scrollColumn,
    core.paginationConfig,
    core.settings,
    core.spreadConfig,
    core.totalPages,
    options.bookId,
    options.layoutReady,
  ]);

  const resources = useMemo<ReaderSessionResources>(
    () => ({
      chapterAccess,
      locateAnchors: core.pagination.locateAnchors,
      locateTextOffsets: core.pagination.locateTextOffsets,
    }),
    [
      chapterAccess,
      core.pagination.locateAnchors,
      core.pagination.locateTextOffsets,
    ],
  );

  const { goToTextOffset } = core.pagination;
  const { getChapterCanonicalText } = core;
  const goToAnchor = core.pagination.goToAnchor;
  const actions = useMemo<ReaderSessionActions>(
    () => ({
      selectHistoryVisit: (index) => core.jumpHistory.select(index, goToAnchor),
      setHistoryExpanded: core.jumpHistory.setExpanded,
      goBackInHistory: () => core.jumpHistory.go("back", goToAnchor),
      goForwardInHistory: () => core.jumpHistory.go("forward", goToAnchor),
      endHistoryGroup: core.jumpHistory.endGroup,
      updateSettings: core.onUpdateSettings,
      ...navigationActions,
      goToTextOffset: (chapterIndex, offset, source) => {
        const text = getChapterCanonicalText(chapterIndex);
        if (!text) return;
        goToTextOffset(
          { chapterIndex, offset, blockStarts: [...text.blockStarts] },
          {
            intent:
              source === "search-preview"
                ? { kind: "preview", source: "search" }
                : { kind: "jump", source },
          },
        );
      },
      createHighlight,
      resumeBackgroundLoad: core.resumeBackgroundLoad,
      setScrollChapter: core.pagination.setScrollChapter,
      goToAnchor: (anchor, intent) => goToAnchor(anchor, { intent }),
    }),
    [
      core.jumpHistory,
      goToAnchor,
      goToTextOffset,
      getChapterCanonicalText,
      core.pagination.setScrollChapter,
      core.onUpdateSettings,
      core.resumeBackgroundLoad,
      createHighlight,
      navigationActions,
    ],
  );

  return {
    state,
    resources,
    actions,
  };
}
