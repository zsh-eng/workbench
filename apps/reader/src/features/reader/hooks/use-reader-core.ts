import { useBookLoader } from "@/hooks/use-book-loader";
import { useEpubProcessor } from "@/hooks/use-epub-processor";
import { useReaderSettings } from "@/hooks/use-reader-settings";
import type { Book } from "@/lib/db";
import {
  DEFAULT_PARAGRAPH_SPACING,
  usePagination,
  type Block,
  type ChapterCanonicalText,
  type ContentAnchor,
  type PaginationConfig,
  type SpreadConfig,
  type SpreadIntent,
} from "@/lib/pagination-v2";
import type { Highlight } from "@/types/highlight";
import { getReadingFont } from "@/lib/reading-fonts";
import type { FontFamily, ReaderSettings } from "@/types/reader.types";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import type { ReaderLocation } from "../reader-location";
import { useLocation, useNavigate } from "react-router-dom";
import type { ReaderHighlightTarget } from "./use-reader-chapter-content";
import type { ChapterEntry } from "../types";
import { resolveReaderEpubPreparation } from "./reader-epub-preparation";
import { useReaderReadingSession } from "./reading-sessions/use-reader-reading-session";
import { usePaginationKeyboardNav } from "./use-pagination-keyboard-nav";
import { useReaderChapterContent } from "./use-reader-chapter-content";
import { useReaderCheckpointController } from "./use-reader-checkpoint-controller";
import { useReaderJumpHistory } from "./use-reader-jump-history";
import { useReaderPaginationFeed } from "./use-reader-pagination-feed";

interface UseReaderCoreOptions {
  bookId?: string;
  viewport: { width: number; height: number };
  spreadColumns: 1 | 2 | 3;
  paragraphSpacingFactor?: number;
  layoutReady?: boolean;
  /**
   * Scroll mode's location (prototype). While set, it replaces the spread as
   * the source of progress, sessions, history and page numbers.
   */
  scrollLocation?: ReaderLocation | null;
  /**
   * A font laid out in place of the saved one and never saved, so Design
   * ideas can compare fonts on the same book (Debug mode only).
   */
  previewFontFamily?: FontFamily | null;
}

interface UseReaderCoreResult {
  book: Book | null;
  isBookLoading: boolean;
  epubProcessError: Error | null;
  settings: ReaderSettings;
  onUpdateSettings: (patch: Partial<ReaderSettings>) => void;
  chapterEntries: ChapterEntry[];
  bookHighlights: Highlight[];
  spreadConfig: SpreadConfig;
  paginationConfig: PaginationConfig;
  pagination: ReturnType<typeof usePagination>;
  jumpHistory: ReturnType<typeof useReaderJumpHistory>;
  sourceLoadWallClockMs: number | null;
  sourceLoadKind: "cache-hit" | "rebuilt" | null;
  currentPage: number;
  totalPages: number;
  currentChapterIndex: number;
  /** Chapter shown as active in chrome/TOC; may differ from the first visible page in 2-up spreads. */
  displayChapterIndex: number | null;
  /** Start page for each chapter (by chapterIndex), null if not yet laid out. */
  chapterStartPages: (number | null)[];
  getChapterBlocks: (chapterIndex: number) => Block[] | null;
  getChapterCanonicalText: (
    chapterIndex: number,
  ) => ChapterCanonicalText | null;
  resumeBackgroundLoad: () => void;
}

export function buildPaginationConfig(
  settings: Pick<
    ReaderSettings,
    | "fontFamily"
    | "fontSize"
    | "lineHeight"
    | "textAlign"
    | "publisherBookStylingEnabled"
  >,
  paragraphSpacingFactor: number,
  viewport: { width: number; height: number },
): PaginationConfig {
  const readingFont = getReadingFont(settings.fontFamily).stack;
  return {
    fontConfig: {
      bodyFamily: readingFont,
      headingFamily: readingFont,
      codeFamily: `"Courier New", Menlo, Monaco, monospace`,
      baseSizePx: settings.fontSize,
    },
    layoutTheme: {
      baseFontSizePx: settings.fontSize,
      lineHeightFactor: settings.lineHeight,
      paragraphSpacingFactor,
      textAlign: settings.textAlign,
    },
    publisherBookStylingEnabled: settings.publisherBookStylingEnabled,
    viewport,
  };
}

export function buildSpreadConfig(columns: 1 | 2 | 3): SpreadConfig {
  return {
    columns,
    chapterFlow: "continuous",
  };
}

export function useReaderCore(
  options: UseReaderCoreOptions,
): UseReaderCoreResult {
  // Composes the reader's top-level state: settings, chapter content, and pagination.
  const {
    bookId,
    viewport,
    spreadColumns,
    paragraphSpacingFactor = DEFAULT_PARAGRAPH_SPACING,
    layoutReady = true,
    scrollLocation = null,
    previewFontFamily = null,
  } = options;
  const { settings: savedSettings, updateSettings } = useReaderSettings();
  const settings = useMemo(
    () =>
      previewFontFamily
        ? { ...savedSettings, fontFamily: previewFontFamily }
        : savedSettings,
    [savedSettings, previewFontFamily],
  );
  const { book, isLoading: isBookLoading } = useBookLoader(bookId);
  const epubProcessor = useEpubProcessor(book);
  const epubPreparation = resolveReaderEpubPreparation({
    bookId,
    book,
    isBookLoading,
    epubProcessor,
  });

  const {
    fontFamily,
    fontSize,
    lineHeight,
    textAlign,
    publisherBookStylingEnabled,
  } = settings;
  // Only layout settings can invalidate pagination. Appearance controls must
  // not hide a ready spread or move its saved reading anchor.
  const paginationConfig = useMemo(
    () =>
      buildPaginationConfig(
        {
          fontFamily,
          fontSize,
          lineHeight,
          textAlign,
          publisherBookStylingEnabled,
        },
        paragraphSpacingFactor,
        viewport,
      ),
    [
      fontFamily,
      fontSize,
      lineHeight,
      textAlign,
      publisherBookStylingEnabled,
      paragraphSpacingFactor,
      viewport,
    ],
  );

  const spreadConfig = useMemo(
    () => buildSpreadConfig(spreadColumns),
    [spreadColumns],
  );

  const jumpHistory = useReaderJumpHistory(
    book?.id ?? "",
    book?.sourceFileId ?? "",
  );
  // While scrolling, the scroll position owns history. The engine still
  // reports its own place after background layout; only its navigations
  // (contents, links, notes, history) count then.
  const scrollingRef = useRef(false);
  useLayoutEffect(() => {
    scrollingRef.current = scrollLocation !== null;
  }, [scrollLocation]);
  const recordEngineLocation = jumpHistory.record;
  const onLocationResolved = useCallback(
    (anchor: ContentAnchor, intent: SpreadIntent) => {
      if (
        scrollingRef.current &&
        intent.kind !== "jump" &&
        intent.kind !== "history"
      ) {
        return;
      }
      recordEngineLocation(anchor, intent);
    },
    [recordEngineLocation],
  );
  const pagination = usePagination({
    sessionKey: book ? `${book.id}:${book.sourceFileId}` : bookId,
    onLocationResolved,
    paginationConfig,
    spreadConfig,
  });

  const route = useLocation();
  const navigate = useNavigate();
  const highlightTarget = route.state?.scrollToHighlight as
    | ReaderHighlightTarget
    | undefined;
  // Consume the navigation only after a spread exists. The chapter session has
  // captured its target by then; revisiting this history entry restores progress.
  useEffect(() => {
    if (!pagination.spread || !highlightTarget) return;
    const { scrollToHighlight: _target, ...state } = route.state;
    void navigate(
      { pathname: route.pathname, search: route.search, hash: route.hash },
      { replace: true, state },
    );
  }, [pagination.spread, highlightTarget, route, navigate]);

  useReaderCheckpointController({
    bookId,
    spread: pagination.spread,
    location: scrollLocation,
    isFullyPaginated: pagination.status === "ready",
  });

  useReaderReadingSession({
    bookId,
    spread: pagination.spread,
    location: scrollLocation,
  });

  // Scrolling records the line at the top of the view, so history and the
  // resume point follow the scroll position without moving the paged engine.
  // Jumps reach history from the engine, as on the pages.
  const recordHistory = jumpHistory.record;
  useEffect(() => {
    if (!scrollLocation?.anchor || scrollLocation.intent.kind !== "linear") {
      return;
    }
    // The line at the top of the view, exactly; never read as a page.
    recordHistory(scrollLocation.anchor, scrollLocation.intent, true);
  }, [recordHistory, scrollLocation]);

  usePaginationKeyboardNav({
    onPrevSpread: pagination.prevSpread,
    onNextSpread: pagination.nextSpread,
    enabled: !scrollLocation,
  });

  const {
    chapterEntries,
    bookHighlights,
    initialLocation,
    sourceLoadWallClockMs,
    sourceLoadKind,
    getChapterBlocks,
    getChapterCanonicalText,
    subscribe: subscribeToChapterArtifacts,
    resumeBackgroundLoad: resumeBackgroundChapterArtifacts,
  } = useReaderChapterContent({
    highlightTarget,
    resumeAnchor: jumpHistory.initialAnchor,
    bookId: epubPreparation.chapterContentBookId,
    book: epubPreparation.chapterContentBook,
    publisherBookStylingEnabled: settings.publisherBookStylingEnabled,
    matchPublisherBodyTextSize: settings.matchPublisherBodyTextSize,
  });

  useReaderPaginationFeed({
    pagination,
    bookId: epubPreparation.chapterContentBookId,
    chapterEntries,
    getChapterBlocks,
    subscribe: subscribeToChapterArtifacts,
    initialLocation,
    enabled: layoutReady,
  });

  const onUpdateSettings = useCallback(
    (patch: Partial<ReaderSettings>) => {
      updateSettings(patch);
    },
    [updateSettings],
  );

  // A scrubber preview shows its page over the scroll column; page numbers
  // follow it as they do on the pages.
  const shownLocation =
    pagination.spread?.intent.kind === "preview" ? null : scrollLocation;
  const currentPage =
    shownLocation?.currentPage ?? pagination.spread?.currentPage ?? 1;
  const totalPages =
    shownLocation?.totalPages ?? pagination.spread?.totalPages ?? 0;
  const currentChapterIndex =
    shownLocation?.chapterIndex ?? pagination.spread?.chapterIndexStart ?? 0;
  // When a spread crosses a chapter boundary, prefer the later visible chapter
  // for UI identity while leaving pagination anchors and page numbers unchanged.
  const displayChapterIndex =
    shownLocation?.chapterIndex ??
    pagination.spread?.chapterIndexEnd ??
    pagination.spread?.chapterIndexStart ??
    initialLocation?.chapterIndex ??
    null;

  const chapterStartPages = useMemo<(number | null)[]>(() => {
    const result: (number | null)[] = [];
    let runningPage = 1;
    for (let i = 0; i < chapterEntries.length; i++) {
      const count = pagination.chapterPageCounts.get(i);
      if (count === undefined) {
        for (let j = i; j < chapterEntries.length; j++) result.push(null);
        break;
      }
      result.push(runningPage);
      runningPage += count;
    }
    return result;
  }, [chapterEntries.length, pagination.chapterPageCounts]);

  return {
    book,
    isBookLoading: epubPreparation.isBookLoading,
    epubProcessError: epubPreparation.epubProcessError,
    settings,
    onUpdateSettings,
    chapterEntries,
    bookHighlights,
    spreadConfig,
    paginationConfig,
    pagination,
    jumpHistory,
    sourceLoadWallClockMs,
    sourceLoadKind,
    currentPage,
    totalPages,
    currentChapterIndex,
    displayChapterIndex,
    chapterStartPages,
    getChapterBlocks,
    getChapterCanonicalText,
    resumeBackgroundLoad: resumeBackgroundChapterArtifacts,
  };
}
