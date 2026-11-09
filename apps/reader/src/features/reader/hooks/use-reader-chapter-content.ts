import { useBookHighlightsQuery } from "@/hooks/use-highlights-query";
import type { Book } from "@/lib/db";
import type { ChapterCanonicalText, ContentAnchor } from "@/lib/pagination-v2";
import type { Highlight } from "@/types/highlight";
import { useCallback, useMemo } from "react";
import {
  buildChapterEntries,
  type ParsedChapterBlocks,
  type ReaderInitialLocation,
} from "../data/chapter-content-pipeline";
import {
  useReaderBodyCacheQuery,
  useReaderChapterArtifactsLoader,
  useReaderCheckpointQuery,
  type ReaderChapterArtifactSubscriber,
  type ReaderBodyCacheLoadKind,
} from "../data/reader-cache/hooks";
import type { ChapterEntry } from "../types";
import { useSessionInitialReaderLocation } from "./use-session-initial-reader-location";

export interface ReaderHighlightTarget {
  spineItemId: string;
  highlightId: string;
}

interface UseReaderChapterContentOptions {
  resumeAnchor?: ContentAnchor;
  highlightTarget?: ReaderHighlightTarget;
  bookId?: string;
  book: Book | null;
  publisherBookStylingEnabled: boolean;
  matchPublisherBodyTextSize: boolean;
}

interface UseReaderChapterContentResult {
  chapterEntries: ChapterEntry[];
  bookHighlights: Highlight[];
  initialLocation: ReaderInitialLocation | null;
  sourceLoadWallClockMs: number | null;
  sourceLoadKind: ReaderBodyCacheLoadKind | null;
  getChapterBlocks: (chapterIndex: number) => ParsedChapterBlocks | null;
  getChapterCanonicalText: (
    chapterIndex: number,
  ) => ChapterCanonicalText | null;
  subscribe: (listener: ReaderChapterArtifactSubscriber) => () => void;
  resumeBackgroundLoad: () => void;
  /**
   * Something the book needs to open could not be read: its saved place,
   * its text, its highlights or a chapter. Opening it anyway could save the
   * wrong place over the real one.
   */
  loadFailed: boolean;
}

/**
 * Composes the reader startup cache queries and exposes the artifacts needed by
 * pagination, annotations, and highlight interactions.
 */
export function useReaderChapterContent({
  bookId,
  book,
  highlightTarget: target,
  resumeAnchor,
  publisherBookStylingEnabled,
  matchPublisherBodyTextSize,
}: UseReaderChapterContentOptions): UseReaderChapterContentResult {
  const chapterEntries = useMemo(() => buildChapterEntries(book), [book]);
  const sourceFileId = book?.sourceFileId;

  const targetChapterIndex = target
    ? chapterEntries.findIndex(
        (entry) => entry.spineItemId === target.spineItemId,
      )
    : -1;
  const checkpointQuery = useReaderCheckpointQuery(bookId);
  const initialLocation = useSessionInitialReaderLocation({
    bookId,
    totalChapters: chapterEntries.length,
    checkpoint: checkpointQuery.data?.checkpoint,
    checkpointReady: checkpointQuery.isSuccess,
    requestedLocation:
      target && targetChapterIndex >= 0
        ? {
            chapterIndex: targetChapterIndex,
            highlightId: target.highlightId,
            isRestore: false,
          }
        : resumeAnchor && resumeAnchor.chapterIndex < chapterEntries.length
          ? {
              chapterIndex: resumeAnchor.chapterIndex,
              anchor: resumeAnchor,
              isRestore: true,
            }
          : undefined,
  });

  const bodyCacheQuery = useReaderBodyCacheQuery({
    bookId,
    sourceFileId,
    chapterEntries,
    publisherBookStylingEnabled,
    matchPublisherBodyTextSize,
  });
  const highlightsQuery = useBookHighlightsQuery(bookId);
  const bookHighlights = highlightsQuery.data ?? [];

  const artifactsLoader = useReaderChapterArtifactsLoader({
    bookId,
    sourceFileId,
    chapterEntries,
    baseContentByChapter: bodyCacheQuery.data?.baseContentByChapter,
    initialLocation,
    highlights: bookHighlights,
    enabled: highlightsQuery.isSuccess,
    publisherBookStylingEnabled,
    matchPublisherBodyTextSize,
  });

  const getChapterCanonicalText = useCallback(
    (chapterIndex: number): ChapterCanonicalText | null =>
      bodyCacheQuery.data?.baseContentByChapter.get(chapterIndex)
        ?.canonicalText ?? null,
    [bodyCacheQuery.data],
  );

  return {
    chapterEntries,
    bookHighlights,
    initialLocation,
    sourceLoadWallClockMs: bodyCacheQuery.data?.loadWallClockMs ?? null,
    sourceLoadKind: bodyCacheQuery.data?.loadKind ?? null,
    getChapterBlocks: artifactsLoader.getChapterBlocks,
    getChapterCanonicalText,
    subscribe: artifactsLoader.subscribe,
    resumeBackgroundLoad: artifactsLoader.resumeBackgroundLoad,
    loadFailed:
      checkpointQuery.isError ||
      bodyCacheQuery.isError ||
      highlightsQuery.isError ||
      artifactsLoader.failed,
  };
}
