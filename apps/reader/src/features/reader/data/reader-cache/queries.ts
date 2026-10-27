import {
  getCurrentDeviceReadingCheckpoint,
  getReadingCheckpointsForBook,
  type ReadingCheckpoint,
} from "@/lib/db";
import type { FileId } from "@/lib/files";
import { withReaderTraceSpan } from "@/lib/reader-performance-trace";
import type { Highlight } from "@/types/highlight";
import { queryOptions } from "@tanstack/react-query";
import type { ChapterEntry } from "../../types";
import { getReaderTablesMode } from "../../tables-preference";
import type { ReaderTablesMode } from "../chapter-tables";
import type { ReaderBaseChapterContent } from "../chapter-content-pipeline";
import {
  buildReaderChapterArtifact,
  loadReaderBodyCache,
  READER_BODY_CACHE_SCHEMA_VERSION,
  READER_CHAPTER_ARTIFACTS_GC_MS,
  READER_CHAPTER_ARTIFACTS_SCHEMA_VERSION,
} from "./cache";

/** Shared cache identities and query definitions for prefetch and active reading. */
export const readerBodyCacheKeys = {
  book: (
    bookId: string,
    sourceFileId: FileId,
    publisherBookStylingEnabled: boolean,
    matchPublisherBodyTextSize: boolean,
    tablesMode: ReaderTablesMode,
  ) =>
    [
      "readerBodyCache",
      READER_BODY_CACHE_SCHEMA_VERSION,
      bookId,
      sourceFileId,
      getPublisherStylingCacheKey(publisherBookStylingEnabled),
      matchPublisherBodyTextSize ? "body-size-match-on" : "body-size-match-off",
      // Base content follows the mode; the persisted row does not.
      `tables-${tablesMode}`,
    ] as const,
};

export const readerCheckpointKeys = {
  currentDevice: (bookId: string) =>
    ["readingCheckpoint", "currentDevice", bookId] as const,
  book: (bookId: string) => ["readingCheckpoints", "book", bookId] as const,
};

export const readerChapterArtifactKeys = {
  chapter: (
    bookId: string,
    sourceFileId: FileId,
    chapterIndex: number,
    spineItemId: string,
    highlightSignature: string,
    publisherBookStylingEnabled: boolean,
    matchPublisherBodyTextSize: boolean,
    publisherBodyFontScale: number | undefined,
    tables: boolean,
  ) =>
    [
      "readerChapterArtifact",
      READER_CHAPTER_ARTIFACTS_SCHEMA_VERSION,
      READER_BODY_CACHE_SCHEMA_VERSION,
      bookId,
      sourceFileId,
      chapterIndex,
      spineItemId,
      highlightSignature,
      getPublisherStylingCacheKey(publisherBookStylingEnabled),
      getPublisherBodySizeCacheKey(
        publisherBookStylingEnabled,
        matchPublisherBodyTextSize,
        publisherBodyFontScale,
      ),
      getTablesCacheKey(tables),
    ] as const,
};

/** A chapter's tables as grids or paragraphs; see `chapter-tables.ts`. */
function getTablesCacheKey(tables: boolean): string {
  return tables ? "tables-grid" : "tables-flat";
}

function getPublisherStylingCacheKey(enabled: boolean): string {
  return enabled ? "publisher-styling-on" : "publisher-styling-off";
}

function getPublisherBodySizeCacheKey(
  publisherBookStylingEnabled: boolean,
  matchPublisherBodyTextSize: boolean,
  publisherBodyFontScale: number | undefined,
): string {
  if (!publisherBookStylingEnabled || !matchPublisherBodyTextSize) {
    return "body-size-literal";
  }

  return publisherBodyFontScale
    ? `body-size-matched:${publisherBodyFontScale}`
    : "body-size-matched:none";
}

export function getReaderChapterArtifactSignature(options: {
  highlightSignature: string;
  publisherBookStylingEnabled: boolean;
  matchPublisherBodyTextSize: boolean;
  publisherBodyFontScale: number | undefined;
  tables: boolean;
}): string {
  const {
    highlightSignature,
    publisherBookStylingEnabled,
    matchPublisherBodyTextSize,
    publisherBodyFontScale,
    tables,
  } = options;
  return `${getPublisherStylingCacheKey(
    publisherBookStylingEnabled,
  )}:${getPublisherBodySizeCacheKey(
    publisherBookStylingEnabled,
    matchPublisherBodyTextSize,
    publisherBodyFontScale,
  )}:${getTablesCacheKey(tables)}:${highlightSignature}`;
}

export interface ReaderCheckpointData {
  checkpoint: ReadingCheckpoint | undefined;
}

export interface ReaderCheckpointsData {
  checkpoints: ReadingCheckpoint[];
}

export function readerBodyCacheQueryOptions(options: {
  bookId?: string;
  sourceFileId?: FileId;
  chapterEntries: ChapterEntry[];
  publisherBookStylingEnabled: boolean;
  matchPublisherBodyTextSize: boolean;
}) {
  const {
    bookId,
    sourceFileId,
    chapterEntries,
    publisherBookStylingEnabled,
    matchPublisherBodyTextSize,
  } = options;

  const tablesMode = getReaderTablesMode();
  return queryOptions({
    networkMode: "always", // Local storage and CPU work must not wait for reconnect.
    queryKey: readerBodyCacheKeys.book(
      bookId ?? "",
      sourceFileId ?? ("" as FileId),
      publisherBookStylingEnabled,
      matchPublisherBodyTextSize,
      tablesMode,
    ),
    queryFn: () =>
      loadReaderBodyCache({
        bookId: bookId!,
        sourceFileId: sourceFileId!,
        chapterEntries,
        publisherBookStylingEnabled,
        matchPublisherBodyTextSize,
        tablesMode,
      }),
    enabled: !!bookId && !!sourceFileId && chapterEntries.length > 0,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

export function readerCheckpointQueryOptions(bookId: string | undefined) {
  return queryOptions({
    networkMode: "always", // Local storage and CPU work must not wait for reconnect.
    queryKey: readerCheckpointKeys.currentDevice(bookId ?? ""),
    queryFn: async (): Promise<ReaderCheckpointData> => ({
      checkpoint: await withReaderTraceSpan(
        "reading-checkpoint-read",
        "storage",
        () => getCurrentDeviceReadingCheckpoint(bookId!),
      ),
    }),
    enabled: !!bookId,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

export function readerCheckpointsQueryOptions(
  bookId: string | undefined,
  enabled = true,
) {
  return queryOptions({
    networkMode: "always", // Local storage and CPU work must not wait for reconnect.
    queryKey: readerCheckpointKeys.book(bookId ?? ""),
    queryFn: async (): Promise<ReaderCheckpointsData> => ({
      checkpoints: await withReaderTraceSpan(
        "reading-checkpoints-read",
        "storage",
        () => getReadingCheckpointsForBook(bookId!),
      ),
    }),
    enabled: !!bookId && enabled,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

export function readerChapterArtifactQueryOptions(options: {
  bookId: string;
  sourceFileId: FileId;
  baseContent: ReaderBaseChapterContent;
  highlights: Highlight[];
  highlightSignature: string;
  publisherBookStylingEnabled: boolean;
  matchPublisherBodyTextSize: boolean;
}) {
  const {
    bookId,
    sourceFileId,
    baseContent,
    highlightSignature,
    publisherBookStylingEnabled,
    matchPublisherBodyTextSize,
  } = options;
  return queryOptions({
    networkMode: "always", // Local storage and CPU work must not wait for reconnect.
    queryKey: readerChapterArtifactKeys.chapter(
      bookId,
      sourceFileId,
      baseContent.chapterIndex,
      baseContent.entry.spineItemId,
      highlightSignature,
      publisherBookStylingEnabled,
      matchPublisherBodyTextSize,
      baseContent.publisherBodyFontScale,
      baseContent.tables,
    ),
    queryFn: () => buildReaderChapterArtifact(options),
    staleTime: Infinity,
    gcTime: READER_CHAPTER_ARTIFACTS_GC_MS,
  });
}
