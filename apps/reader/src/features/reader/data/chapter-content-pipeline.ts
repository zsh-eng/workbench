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

export type ParsedChapterBlocks = ReturnType<typeof parseChapterHtml>;

export interface ReaderBaseChapterContent {
  chapterIndex: number;
  entry: ChapterEntry;
  html: string;
  canonicalText: ChapterCanonicalText;
  bookStylesheets: BookStylesheet[];
  publisherFontFaces: PublisherFontFace[];
  publisherBodyFontScale?: number;
}

export interface ReaderChapterCachedContent {
  bodyHtml: string;
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
  /** Parse tables into cells, whose canonical starts the cache then holds. */
  tables?: boolean;
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
    tables = false,
  } = options;
  const { document: chapterDoc } = await processEmbeddedResources({
    content: source,
    mediaType,
    basePath: chapter.href,
    loadResource,
    skipImages: true,
    loadLinkedResources: false,
  });
  const bodyHtml = chapterDoc.querySelector("body")?.innerHTML ?? "";

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
    canonicalText: parsedChapter.canonicalText,
    bookStylesheets,
    publisherFontFaces,
    ...(collectPublisherBodyScaleBlocks
      ? { publisherBodyScaleBlocks: parsedChapter.blocks }
      : {}),
  };
}

export function loadBaseChapterContent(options: {
  chapterIndex: number;
  chapterContent: ReaderChapterCachedContent;
  chapter: ChapterEntry;
  publisherBodyFontScale?: number;
}): ReaderBaseChapterContent {
  const { chapterIndex, chapterContent, chapter, publisherBodyFontScale } =
    options;

  return {
    chapterIndex,
    entry: chapter,
    html: chapterContent.bodyHtml,
    canonicalText: chapterContent.canonicalText,
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
  /** Must match the base content's `tables`, so cell ids have starts. */
  tables?: boolean;
}): ReaderDecoratedChapterArtifact {
  const {
    baseContent,
    highlights,
    publisherBookStylingEnabled = false,
    matchPublisherBodyTextSize = false,
    tables = false,
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
      tables,
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
