import {
  getBookChapterSourceCache,
  getBookFile,
  getBookFilesByPaths,
  putBookChapterSourceCache,
  type BookChapterSourceCacheEntry,
  type BookFile,
} from "@/lib/db";
import type { FileId } from "@/lib/files";
import {
  endReaderTraceSpan,
  startReaderTraceSpan,
} from "@/lib/reader-performance-trace";
import {
  inferPublisherBodyFontScale,
  type PublisherFontFace,
} from "@/lib/pagination-v2";
import type { Highlight } from "@/types/highlight";
import type { ChapterEntry } from "../../types";
import {
  buildReaderChapterCachedContent,
  decorateChapterContent,
  loadBaseChapterContent,
  type ParsedChapterBlocks,
  type ReaderBaseChapterContent,
  type ReaderChapterCachedContent,
  type ReaderDecoratedChapterArtifact,
} from "../chapter-content-pipeline";
import { createChapterStylesheetLoader } from "../chapter-stylesheets";
import {
  createPublisherFontFaceLoader,
  dedupePublisherFontFaces,
} from "../publisher-font-faces";

export const READER_BODY_CACHE_SCHEMA_VERSION = 6;
export const READER_CHAPTER_ARTIFACTS_SCHEMA_VERSION = 1;
export const READER_CHAPTER_ARTIFACTS_GC_MS = 30 * 60 * 1000;

/**
 * Reader startup has two cache layers:
 * 1. Persistent body cache: one local IndexedDB row per book containing
 *    normalized chapter body HTML plus canonical text. This is invalidated by
 *    source file reference or body cache schema version and can always be rebuilt from
 *    extracted EPUB files.
 * 2. In-memory chapter artifact cache: one React Query row per decorated
 *    chapter, keyed by the body cache version and that chapter's highlight
 *    signature. The artifact loader fills and reads this cache imperatively.
 */
export type ReaderBodyCacheLoadKind = "cache-hit" | "rebuilt";

export interface ReaderBodyCacheData {
  baseContentByChapter: Map<number, ReaderBaseChapterContent>;
  loadWallClockMs: number;
  loadKind: ReaderBodyCacheLoadKind;
}

function readCachedChapterContents(
  chaptersByPath: Record<string, BookChapterSourceCacheEntry>,
  chapterEntries: ChapterEntry[],
): Map<string, ReaderChapterCachedContent> {
  const chapterContentsByPath = new Map<string, ReaderChapterCachedContent>();
  for (const chapter of chapterEntries) {
    chapterContentsByPath.set(chapter.href, chaptersByPath[chapter.href]!);
  }
  return chapterContentsByPath;
}

function buildBaseContentByChapter(
  chapterEntries: ChapterEntry[],
  chapterContentsByPath: Map<string, ReaderChapterCachedContent>,
  publisherFontFaces: PublisherFontFace[] = [],
  publisherBodyFontScale?: number,
): Map<number, ReaderBaseChapterContent> {
  const baseContentByChapter = new Map<number, ReaderBaseChapterContent>();

  for (
    let chapterIndex = 0;
    chapterIndex < chapterEntries.length;
    chapterIndex++
  ) {
    const chapter = chapterEntries[chapterIndex]!;
    const baseContent = loadBaseChapterContent({
      chapterIndex,
      chapterContent: chapterContentsByPath.get(chapter.href)!,
      chapter,
      publisherBodyFontScale,
    });
    baseContent.publisherFontFaces = publisherFontFaces;
    baseContentByChapter.set(chapterIndex, baseContent);
  }

  return baseContentByChapter;
}

async function buildChapterContentsFromFiles(
  bookId: string,
  chapterEntries: ChapterEntry[],
  allChapterFiles: Map<string, BookFile>,
  includePublisherResources: boolean,
  includePublisherBodyScale: boolean,
  tables: boolean,
): Promise<{
  chaptersByPath: Record<string, BookChapterSourceCacheEntry>;
  chapterContentsByPath: Map<string, ReaderChapterCachedContent>;
  publisherFontFaces: PublisherFontFace[];
  publisherBodyFontScale?: number;
}> {
  const chaptersByPath: Record<string, BookChapterSourceCacheEntry> = {};
  const chapterContentsByPath = new Map<string, ReaderChapterCachedContent>();
  const loadedResourceFiles = new Map<string, BookFile>();
  const publisherFontFaces: PublisherFontFace[] = [];
  const publisherBodyScaleBlocks: ParsedChapterBlocks = [];

  function getTypedContent(file: BookFile): Blob {
    if (file.content.type || !file.mediaType) return file.content;
    return file.content.slice(0, file.content.size, file.mediaType);
  }

  async function loadResource(path: string): Promise<Blob | null> {
    const cachedFile =
      allChapterFiles.get(path) ?? loadedResourceFiles.get(path);
    if (cachedFile) return getTypedContent(cachedFile);

    const file = await getBookFile(bookId, path);
    if (!file) return null;

    loadedResourceFiles.set(path, file);
    return getTypedContent(file);
  }
  const chapterStylesheetLoader = createChapterStylesheetLoader(loadResource);
  const publisherFontFaceLoader = includePublisherResources
    ? createPublisherFontFaceLoader(loadResource)
    : undefined;

  for (const chapter of chapterEntries) {
    const chapterFile = allChapterFiles.get(chapter.href);
    if (!chapterFile) {
      throw new Error(
        `Missing chapter file for href "${chapter.href}" (chapter ${chapter.index})`,
      );
    }

    const chapterContent = await buildReaderChapterCachedContent({
      source: await chapterFile.content.text(),
      mediaType: chapterFile.mediaType,
      chapter,
      loadResource,
      includePublisherResources,
      collectPublisherBodyScaleBlocks: includePublisherBodyScale,
      chapterStylesheetLoader,
      publisherFontFaceLoader,
      tables,
    });
    chaptersByPath[chapter.href] = {
      bodyHtml: chapterContent.bodyHtml,
      canonicalText: chapterContent.canonicalText,
      bookStylesheets: chapterContent.bookStylesheets,
    };
    publisherFontFaces.push(...(chapterContent.publisherFontFaces ?? []));
    publisherBodyScaleBlocks.push(
      ...(chapterContent.publisherBodyScaleBlocks ?? []),
    );
    chapterContentsByPath.set(chapter.href, chapterContent);
  }

  const publisherBodyFontScale = includePublisherBodyScale
    ? inferPublisherBodyFontScale(publisherBodyScaleBlocks)
    : undefined;

  return {
    chaptersByPath,
    chapterContentsByPath,
    publisherFontFaces: dedupePublisherFontFaces(publisherFontFaces),
    ...(publisherBodyFontScale !== undefined ? { publisherBodyFontScale } : {}),
  };
}

/**
 * Loads normalized chapter body HTML and canonical text from the persistent
 * cache, rebuilding from EPUB chapter files on the first open or after a schema
 * version/source file change.
 */
export async function loadReaderBodyCache(options: {
  bookId: string;
  sourceFileId: FileId;
  chapterEntries: ChapterEntry[];
  publisherBookStylingEnabled: boolean;
  matchPublisherBodyTextSize: boolean;
  /**
   * Tables as cells (Debug). Canonical text then holds each cell's start,
   * so a cache built the other way is rebuilt.
   */
  tables?: boolean;
}): Promise<ReaderBodyCacheData> {
  const {
    bookId,
    sourceFileId,
    chapterEntries,
    publisherBookStylingEnabled,
    matchPublisherBodyTextSize,
    tables = false,
  } = options;
  const includePublisherBodyScale =
    publisherBookStylingEnabled && matchPublisherBodyTextSize;
  const startedAt = performance.now();
  const bodyCacheSpan = startReaderTraceSpan(
    "reader-body-cache-load",
    "processing",
    {
      chapterCount: chapterEntries.length,
      publisherBookStylingEnabled,
    },
  );
  const cacheReadSpan = startReaderTraceSpan(
    "reader-body-cache-read",
    "storage",
  );
  const cachedChapterSourceRow = await getBookChapterSourceCache(bookId);

  if (
    cachedChapterSourceRow &&
    cachedChapterSourceRow.cacheVersion === READER_BODY_CACHE_SCHEMA_VERSION &&
    cachedChapterSourceRow.sourceFileId === sourceFileId &&
    (!publisherBookStylingEnabled ||
      cachedChapterSourceRow.publisherResourcesLoaded === true) &&
    (!includePublisherBodyScale ||
      cachedChapterSourceRow.publisherBodyScaleLoaded === true) &&
    (cachedChapterSourceRow.tableCellsLoaded === true) === tables
  ) {
    endReaderTraceSpan(cacheReadSpan, { cacheHit: true });
    const chapterContentsByPath = readCachedChapterContents(
      cachedChapterSourceRow.chaptersByPath,
      chapterEntries,
    );
    const hydrationSpan = startReaderTraceSpan(
      "base-content-hydration",
      "processing",
    );
    const baseContentByChapter = buildBaseContentByChapter(
      chapterEntries,
      chapterContentsByPath,
      cachedChapterSourceRow.publisherFontFaces ?? [],
      cachedChapterSourceRow.publisherBodyFontScale,
    );
    endReaderTraceSpan(hydrationSpan, { chapterCount: chapterEntries.length });
    endReaderTraceSpan(bodyCacheSpan, { loadKind: "cache-hit" });

    return {
      baseContentByChapter,
      loadWallClockMs: performance.now() - startedAt,
      loadKind: "cache-hit",
    };
  }

  endReaderTraceSpan(cacheReadSpan, { cacheHit: false });
  const chapterFilesReadSpan = startReaderTraceSpan(
    "chapter-files-read",
    "storage",
  );
  const allChapterFiles = await getBookFilesByPaths(
    bookId,
    chapterEntries.map((chapter) => chapter.href),
  );
  endReaderTraceSpan(chapterFilesReadSpan, {
    fileCount: allChapterFiles.size,
  });
  const sourceBuildSpan = startReaderTraceSpan(
    "chapter-source-normalization",
    "processing",
  );
  const builtChapterContents = await buildChapterContentsFromFiles(
    bookId,
    chapterEntries,
    allChapterFiles,
    publisherBookStylingEnabled,
    includePublisherBodyScale,
    tables,
  );
  endReaderTraceSpan(sourceBuildSpan, {
    chapterCount: chapterEntries.length,
    publisherFontCount: builtChapterContents.publisherFontFaces.length,
  });

  const cacheWriteSpan = startReaderTraceSpan(
    "reader-body-cache-write",
    "storage",
  );
  await putBookChapterSourceCache(
    bookId,
    sourceFileId,
    builtChapterContents.chaptersByPath,
    READER_BODY_CACHE_SCHEMA_VERSION,
    publisherBookStylingEnabled,
    builtChapterContents.publisherFontFaces,
    includePublisherBodyScale,
    builtChapterContents.publisherBodyFontScale,
    tables,
  );
  endReaderTraceSpan(cacheWriteSpan, { chapterCount: chapterEntries.length });

  const hydrationSpan = startReaderTraceSpan(
    "base-content-hydration",
    "processing",
  );
  const baseContentByChapter = buildBaseContentByChapter(
    chapterEntries,
    builtChapterContents.chapterContentsByPath,
    builtChapterContents.publisherFontFaces,
    builtChapterContents.publisherBodyFontScale,
  );
  endReaderTraceSpan(hydrationSpan, { chapterCount: chapterEntries.length });
  endReaderTraceSpan(bodyCacheSpan, { loadKind: "rebuilt" });

  return {
    baseContentByChapter,
    loadWallClockMs: performance.now() - startedAt,
    loadKind: "rebuilt",
  };
}

export function buildReaderChapterArtifact(options: {
  baseContent: ReaderBaseChapterContent;
  highlights: Highlight[];
  publisherBookStylingEnabled: boolean;
  matchPublisherBodyTextSize: boolean;
  tables?: boolean;
}): ReaderDecoratedChapterArtifact {
  return decorateChapterContent(options);
}
