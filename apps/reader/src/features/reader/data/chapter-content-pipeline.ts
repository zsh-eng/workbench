import type { Book, ReadingCheckpoint } from "@/lib/db";
import { processEmbeddedResources } from "@/lib/epub-resource-utils";
import {
  parseChapterHtml,
  parseChapterHtmlWithCanonicalText,
  type ChapterCanonicalText,
  type ContentAnchor,
  type PublisherFontFace,
  type BookStylesheet,
} from "@/lib/pagination-v2";
import { getChapterTitleFromSpine } from "@/lib/toc-utils";
import type { Highlight } from "@/types/highlight";
import {
  applyChapterHighlights,
  buildHighlightSignature,
  type VirtualChapterSource,
} from "../highlight-virtualization";
import {
  createChapterStylesheetLoader,
  loadChapterStylesheets,
  type ChapterStylesheetLoader,
} from "./chapter-stylesheets";
import {
  createPublisherFontFaceLoader,
  type PublisherFontFaceLoader,
} from "./publisher-font-faces";
import type { ChapterEntry } from "../types";
import {
  chapterTablesAsGrid,
  countTableCells,
  type ReaderTablesMode,
} from "./chapter-tables";

export type ParsedChapterBlocks = ReturnType<typeof parseChapterHtml>;

export interface ReaderBaseChapterContent {
  chapterIndex: number;
  entry: ChapterEntry;
  html: string;
  /** Whether this chapter reads its tables as grids; `canonicalText` matches. */
  tables: boolean;
  canonicalText: ChapterCanonicalText;
  bookStylesheets: BookStylesheet[];
  publisherFontFaces: PublisherFontFace[];
  publisherBodyFontScale?: number;
}

export interface ReaderChapterCachedContent {
  bodyHtml: string;
  /** The chapter's `td` and `th` cells, which decide how it reads tables. */
  tableCellCount: number;
  /** Canonical text for the chapter's Auto table mode (`chapter-tables.ts`). */
  canonicalText: ChapterCanonicalText;
  bookStylesheets?: BookStylesheet[];
  publisherFontFaces?: PublisherFontFace[];
  publisherBodyScaleBlocks?: ParsedChapterBlocks;
}

export interface ReaderDecoratedChapterArtifact {
  chapterIndex: number;
  entry: ChapterEntry;
  source: VirtualChapterSource;
  blocks: ParsedChapterBlocks;
  highlightSignature: string;
}

export interface ReaderInitialLocation {
  anchor?: ContentAnchor;
  highlightId?: string;
  chapterIndex: number;
  chapterProgress?: number;
  isRestore: boolean;
}

export function buildChapterEntries(book: Book | null): ChapterEntry[] {
  if (!book) return [];

  const chapterEntries: ChapterEntry[] = [];

  for (let index = 0; index < book.spine.length; index++) {
    const spineItem = book.spine[index];
    if (!spineItem) {
      console.warn(
        "[Reader] Missing spine item while building chapter entries",
        {
          bookId: book.id,
          spineIndex: index,
        },
      );
      continue;
    }

    const manifestItem = book.manifest.find(
      (item) => item.id === spineItem.idref,
    );
    if (!manifestItem?.href) {
      console.warn(
        "[Reader] Missing manifest href for spine item while building chapter entries",
        {
          bookId: book.id,
          spineIndex: index,
          spineItemId: spineItem.idref,
        },
      );
      continue;
    }

    chapterEntries.push({
      index,
      spineItemId: spineItem.idref,
      href: manifestItem.href,
      title: getChapterTitleFromSpine(book, index) || `Chapter ${index + 1}`,
    });
  }

  return chapterEntries;
}

export function resolveInitialReaderLocation(
  checkpoint: ReadingCheckpoint | undefined,
  totalChapters: number,
): ReaderInitialLocation {
  const chapterIndex = Math.max(
    0,
    Math.min(checkpoint?.currentSpineIndex ?? 0, totalChapters - 1),
  );

  return {
    chapterIndex,
    chapterProgress: checkpoint?.scrollProgress,
    isRestore: checkpoint !== undefined,
  };
}

export function buildReaderChapterLoadOrder(
  totalChapters: number,
  initialChapterIndex: number,
): number[] {
  if (totalChapters <= 0) return [];

  const center = Math.max(
    0,
    Math.min(Math.floor(initialChapterIndex), totalChapters - 1),
  );
  const order = [center];

  for (let delta = 1; order.length < totalChapters; delta++) {
    const nextChapterIndex = center + delta;
    if (nextChapterIndex < totalChapters) order.push(nextChapterIndex);

    const previousChapterIndex = center - delta;
    if (previousChapterIndex >= 0) order.push(previousChapterIndex);
  }

  return order;
}

export async function buildReaderChapterCachedContent(options: {
  source: string;
  mediaType: string;
  chapter: ChapterEntry;
  loadResource?: (path: string) => Promise<Blob | null>;
  includePublisherResources?: boolean;
  collectPublisherBodyScaleBlocks?: boolean;
  chapterStylesheetLoader?: ChapterStylesheetLoader;
  publisherFontFaceLoader?: PublisherFontFaceLoader;
}): Promise<ReaderChapterCachedContent> {
  const {
    source,
    mediaType,
    chapter,
    loadResource = async () => null,
    includePublisherResources = false,
    collectPublisherBodyScaleBlocks = false,
    chapterStylesheetLoader,
    publisherFontFaceLoader,
  } = options;
  const { document: chapterDoc } = await processEmbeddedResources({
    content: source,
    mediaType,
    basePath: chapter.href,
    loadResource,
    skipImages: true,
    loadLinkedResources: false,
  });
  const body = chapterDoc.querySelector("body");
  const bodyHtml = body?.innerHTML ?? "";
  // Table cells hold canonical starts only in a chapter that reads its
  // tables as grids.
  const tableCellCount = body ? countTableCells(body) : 0;
  const tables = chapterTablesAsGrid(tableCellCount, "auto");

  // Book Page Break Hints are structural, so linked and embedded CSS is loaded
  // even when Publisher Book Styling is off. Font-face loading remains gated by
  // `includePublisherResources`.
  const stylesheetLoader =
    chapterStylesheetLoader ?? createChapterStylesheetLoader(loadResource);
  const bookStylesheets = await loadChapterStylesheets({
    chapterDoc,
    chapter,
    stylesheetLoader,
  });
  const parsedChapter = parseChapterHtmlWithCanonicalText(
    bodyHtml,
    collectPublisherBodyScaleBlocks
      ? {
          publisherBookStylingEnabled: true,
          bookStylesheets,
          tables,
        }
      : { tables },
  );

  if (!includePublisherResources) {
    return {
      bodyHtml,
      tableCellCount,
      canonicalText: parsedChapter.canonicalText,
      bookStylesheets,
      publisherFontFaces: [],
      ...(collectPublisherBodyScaleBlocks
        ? { publisherBodyScaleBlocks: parsedChapter.blocks }
        : {}),
    };
  }

  const fontFaceLoader =
    publisherFontFaceLoader ?? createPublisherFontFaceLoader(loadResource);
  const publisherFontFaces =
    await fontFaceLoader.loadFontFaces(bookStylesheets);

  return {
    bodyHtml,
    tableCellCount,
    canonicalText: parsedChapter.canonicalText,
    bookStylesheets,
    publisherFontFaces,
    ...(collectPublisherBodyScaleBlocks
      ? { publisherBodyScaleBlocks: parsedChapter.blocks }
      : {}),
  };
}

/**
 * A cached chapter as the Reader reads it in `tablesMode`. A Debug choice
 * that differs from the chapter's Auto mode parses canonical text again,
 * since table cells hold canonical starts only in grids.
 */
export function loadBaseChapterContent(options: {
  chapterIndex: number;
  chapterContent: ReaderChapterCachedContent;
  chapter: ChapterEntry;
  publisherBodyFontScale?: number;
  tablesMode: ReaderTablesMode;
}): ReaderBaseChapterContent {
  const {
    chapterIndex,
    chapterContent,
    chapter,
    publisherBodyFontScale,
    tablesMode,
  } = options;
  const { tableCellCount } = chapterContent;
  const tables = chapterTablesAsGrid(tableCellCount, tablesMode);
  const canonicalText =
    tables === chapterTablesAsGrid(tableCellCount, "auto")
      ? chapterContent.canonicalText
      : parseChapterHtmlWithCanonicalText(chapterContent.bodyHtml, { tables })
          .canonicalText;

  return {
    chapterIndex,
    entry: chapter,
    html: chapterContent.bodyHtml,
    tables,
    canonicalText,
    bookStylesheets: chapterContent.bookStylesheets ?? [],
    publisherFontFaces: chapterContent.publisherFontFaces ?? [],
    ...(publisherBodyFontScale !== undefined ? { publisherBodyFontScale } : {}),
  };
}

export function decorateChapterContent(options: {
  baseContent: ReaderBaseChapterContent;
  highlights: Highlight[];
  publisherBookStylingEnabled?: boolean;
  matchPublisherBodyTextSize?: boolean;
}): ReaderDecoratedChapterArtifact {
  const {
    baseContent,
    highlights,
    publisherBookStylingEnabled = false,
    matchPublisherBodyTextSize = false,
  } = options;
  const source = applyChapterHighlights(
    { html: baseContent.html, highlightedHtml: baseContent.html },
    highlights,
  );

  return {
    chapterIndex: baseContent.chapterIndex,
    entry: baseContent.entry,
    source,
    blocks: parseChapterHtml(source.highlightedHtml, {
      publisherBookStylingEnabled,
      matchPublisherBodyTextSize,
      bookStylesheets: baseContent.bookStylesheets,
      publisherFontFaces: baseContent.publisherFontFaces,
      tables: baseContent.tables,
      ...(baseContent.publisherBodyFontScale !== undefined
        ? { publisherBodyFontScale: baseContent.publisherBodyFontScale }
        : {}),
    }),
    highlightSignature: buildHighlightSignature(highlights),
  };
}

export function didDecoratedChapterBlocksChange(
  previousArtifact: ReaderDecoratedChapterArtifact,
  nextArtifact: ReaderDecoratedChapterArtifact,
): boolean {
  return (
    previousArtifact.source.highlightedHtml !==
    nextArtifact.source.highlightedHtml
  );
}
