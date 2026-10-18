import { useBookLoader } from "@/hooks/use-book-loader";
import { useEpubProcessor } from "@/hooks/use-epub-processor";
import { useReaderSettings } from "@/hooks/use-reader-settings";
import type { Book } from "@/lib/db";
import {
  DEFAULT_PARAGRAPH_SPACING,
  usePagination,
  type Block,
  type ChapterCanonicalText,
  type PaginationConfig,
  type SpreadConfig,
} from "@/lib/pagination-v2";
import type { Highlight } from "@/types/highlight";
import type { FontFamily, ReaderSettings } from "@/types/reader.types";
import { useCallback, useEffect, useMemo } from "react";
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

function getNamedBodyFont(fontFamily: FontFamily): string {
  switch (fontFamily) {
    case "sans-serif":
    case "inter":
      return `"Inter", "Helvetica Neue", Arial, sans-serif`;
    case "monospace":
      return `"Courier New", Menlo, Monaco, monospace`;
    case "lora":
      return `"Lora", Georgia, serif`;
    case "iowan":
      return `"Iowan Old Style", "Palatino Linotype", serif`;
    case "garamond":
      return `"EB Garamond", Garamond, serif`;
    case "serif":
    default:
      return `"EB Garamond", Georgia, serif`;
  }
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
  return {
    fontConfig: {
      bodyFamily: getNamedBodyFont(settings.fontFamily),
      headingFamily: getNamedBodyFont(settings.fontFamily),
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
  } = options;
  const { settings, updateSettings } = useReaderSettings();
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
  const pagination = usePagination({
    sessionKey: book ? `${book.id}:${book.sourceFileId}` : bookId,
    onLocationResolved: jumpHistory.record,
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
    isFullyPaginated: pagination.status === "ready",
  });

  useReaderReadingSession({
    bookId,
    spread: pagination.spread,
  });

  usePaginationKeyboardNav({
    onPrevSpread: pagination.prevSpread,
    onNextSpread: pagination.nextSpread,
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

  const currentPage = pagination.spread?.currentPage ?? 1;
  const totalPages = pagination.spread?.totalPages ?? 0;
  const currentChapterIndex = pagination.spread?.chapterIndexStart ?? 0;
  // When a spread crosses a chapter boundary, prefer the later visible chapter
  // for UI identity while leaving pagination anchors and page numbers unchanged.
  const displayChapterIndex =
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
