/** Expanded EPUB files, materialization markers, and regenerable Reader caches. */
import type { FileId } from "@/lib/files/types";
import { syncedBookRow, type Book, type BookStructure } from "./books";
import { db } from "./database";

// Local-only tables (no sync)
export interface BookFile {
  id: string; // Deterministic primary key derived from bookId and path
  bookId: string; // Foreign key to Book
  path: string; // Path within the EPUB (e.g., "OEBPS/chapter1.xhtml")
  content: Blob; // The actual file content
  mediaType: string;
}

/**
 * The structure this device read from its copy of the EPUB: the manifest,
 * reading order and full table of contents. It stays local, because each
 * device has the EPUB and one synced record cannot hold a large book's
 * contents. `getBook` reads a book with it.
 */
export type BookStructureRow = BookStructure & {
  bookId: string;
  sourceFileId: FileId;
};

/** Durable proof that the current source EPUB was expanded completely. */
export interface BookMaterialization {
  bookId: string;
  sourceFileId: FileId;
  recipeVersion: number;
  completedAt: number;
}

/**
 * Cached plain text extracted from book chapters for full-text search.
 * This is local-only (not synced) since it can be regenerated from BookFile.
 */
export interface BookTextCache {
  bookId: string; // Primary key
  chapters: {
    path: string; // Matches BookFile.path
    title: string; // Chapter title from TOC (for display)
    plainText: string; // Extracted text content
    startOffset: number; // Cumulative character offset in book
  }[];
  totalCharacters: number;
  extractedAt: number; // For cache invalidation if needed
}

export interface BookChapterSourceCacheEntry {
  bodyHtml: string;
  /** The chapter's `td` and `th` cells; they decide how it reads tables. */
  tableCellCount: number;
  canonicalText: {
    fullText: string;
    blockStarts: ReadonlyMap<string, number>;
  };
  bookStylesheets?: {
    cssText: string;
    basePath: string;
  }[];
  publisherFontFaces?: {
    family: string;
    src: string;
    descriptors: FontFaceDescriptors;
  }[];
}

/**
 * Local-only reader source cache.
 *
 * This stores normalized chapter body HTML and canonical text in one row per
 * book so reader startup can avoid repeatedly reading EPUB blobs and rebuilding
 * the same DOM-derived source strings.
 */
export interface BookChapterSourceCache {
  bookId: string;
  sourceFileId: FileId;
  cacheVersion: number;
  publisherResourcesLoaded?: boolean;
  publisherBodyScaleLoaded?: boolean;
  publisherBodyFontScale?: number;
  chaptersByPath: Record<string, BookChapterSourceCacheEntry>;
  publisherFontFaces?: {
    family: string;
    src: string;
    descriptors: FontFaceDescriptors;
  }[];
  updatedAt: number;
}

/**
 * The archive paths a book file may be stored under. EPUB hrefs are URLs, so
 * a manifest or chapter can name "Donna%20Tartt.html" for the archive's
 * "Donna Tartt.html".
 */
function getStoredPathCandidates(path: string): string[] {
  try {
    const decoded = decodeURIComponent(path);
    return decoded === path ? [path] : [path, decoded];
  } catch {
    return [path];
  }
}

export async function getBookFile(
  bookId: string,
  path: string,
): Promise<BookFile | undefined> {
  for (const candidate of getStoredPathCandidates(path)) {
    const file = await db.bookFiles
      .where("[bookId+path]")
      .equals([bookId, candidate])
      .first();
    if (file) return file;
  }
  return undefined;
}

export async function getBookMaterialization(
  bookId: string,
): Promise<BookMaterialization | undefined> {
  return db.bookMaterializations.get(bookId);
}

export async function getBookStructure(
  bookId: string,
): Promise<BookStructureRow | undefined> {
  return db.bookStructures.get(bookId);
}

/** Record the structure of a book whose files are already expanded. */
export async function putBookStructure(
  book: Pick<Book, "id" | "sourceFileId">,
  structure: BookStructure,
): Promise<void> {
  await db.bookStructures.put(bookStructureRow(book, structure));
}

function bookStructureRow(
  book: Pick<Book, "id" | "sourceFileId">,
  { manifest, spine, toc }: BookStructure,
): BookStructureRow {
  return {
    bookId: book.id,
    sourceFileId: book.sourceFileId,
    manifest,
    spine,
    toc,
  };
}

/** The tables a materialization writes, for a caller's wider transaction. */
export function bookMaterializationTables() {
  return [
    db.books,
    db.bookFiles,
    db.bookMaterializations,
    db.bookStructures,
    db.bookTextCache,
    db.bookChapterSourceCache,
  ];
}

/**
 * Replace all source-derived local rows and write the completion marker last.
 * The transaction makes partial extraction indistinguishable from no result.
 * `book` carries the structure read from the EPUB; the synced row gets only
 * what `syncedBookRow` keeps of it.
 */
export async function replaceBookMaterialization(options: {
  book: Book;
  bookFiles: BookFile[];
  recipeVersion: number;
  writeBook: boolean;
}): Promise<void> {
  const { book, bookFiles, recipeVersion, writeBook } = options;

  await db.transaction("rw", bookMaterializationTables(), async () => {
    await db.bookFiles.where("bookId").equals(book.id).delete();
    await db.bookTextCache.delete(book.id);
    await db.bookChapterSourceCache.delete(book.id);

    if (bookFiles.length > 0) {
      await db.bookFiles.bulkPut(bookFiles);
    }
    await db.bookStructures.put(bookStructureRow(book, book));
    if (writeBook) {
      await db.books.put({ ...syncedBookRow(book), isDeleted: false });
    }

    await db.bookMaterializations.put({
      bookId: book.id,
      sourceFileId: book.sourceFileId,
      recipeVersion,
      completedAt: Date.now(),
    });
  });
}

export async function getBookFilesByPaths(
  bookId: string,
  paths: string[],
): Promise<Map<string, BookFile>> {
  if (paths.length === 0) {
    return new Map<string, BookFile>();
  }

  const uniquePaths = [...new Set(paths)];
  const candidates = uniquePaths.map(getStoredPathCandidates);
  const files = await db.bookFiles
    .where("[bookId+path]")
    .anyOf(candidates.flat().map((path) => [bookId, path]))
    .toArray();
  const filesByStoredPath = new Map(files.map((file) => [file.path, file]));

  // Key each file by the path it was asked for.
  const filesByPath = new Map<string, BookFile>();
  uniquePaths.forEach((path, index) => {
    const file = candidates[index]!.map((candidate) =>
      filesByStoredPath.get(candidate),
    ).find(Boolean);
    if (file) filesByPath.set(path, file);
  });
  return filesByPath;
}

export async function getBookChapterSourceCache(
  bookId: string,
): Promise<BookChapterSourceCache | undefined> {
  return db.bookChapterSourceCache.get(bookId);
}

export async function putBookChapterSourceCache(
  bookId: string,
  sourceFileId: FileId,
  chaptersByPath: Record<string, BookChapterSourceCacheEntry>,
  cacheVersion: number,
  publisherResourcesLoaded: boolean,
  publisherFontFaces: BookChapterSourceCache["publisherFontFaces"] = [],
  publisherBodyScaleLoaded = false,
  publisherBodyFontScale?: number,
): Promise<string> {
  await db.bookChapterSourceCache.put({
    bookId,
    sourceFileId,
    cacheVersion,
    publisherResourcesLoaded,
    publisherBodyScaleLoaded,
    ...(publisherBodyFontScale !== undefined ? { publisherBodyFontScale } : {}),
    chaptersByPath,
    publisherFontFaces,
    updatedAt: Date.now(),
  });
  return bookId;
}
