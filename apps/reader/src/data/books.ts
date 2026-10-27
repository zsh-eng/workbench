/** Book metadata and deletion of all rows owned by a book. */
import type { BookCoverRef } from "@/lib/book-file-references";
import type { FileId } from "@/lib/files/types";
import { MAX_SYNC_VALUE_BYTES } from "@zsh-eng/local-sync";
import type { BookStructureRow } from "./book-content";
import { db, isNotDeleted } from "./database";

export type { BookCoverRef };

/**
 * A book as the app reads it. The structure fields (manifest, spine, toc)
 * come from this device's copy of the EPUB once it is expanded (see
 * `bookStructures` in `book-content.ts`); until then, from the synced row,
 * which can hold a shortened copy (see `syncedBookRow`).
 */
export interface Book {
  id: string;
  sourceFileId: FileId;
  title: string;
  author: string;
  fileSize: number;
  dateAdded: number;
  metadata: Record<string, unknown>;
  manifest: ManifestItem[];
  spine: SpineItem[];
  toc: TOCItem[];
  cover: BookCoverRef | null;
}

/** What the EPUB says about its own contents. */
export type BookStructure = Pick<Book, "manifest" | "spine" | "toc">;

export interface ManifestItem {
  id: string;
  href: string;
  mediaType: string;
  properties?: string;
}

export interface SpineItem {
  idref: string; // References ManifestItem.id
  linear?: boolean;
  properties?: string;
}

export interface TOCItem {
  label: string;
  href: string;
  children?: TOCItem[];
}

export async function addBook(book: Book): Promise<string> {
  return db.books.add({ ...syncedBookRow(book), isDeleted: false });
}

export async function getBook(id: string): Promise<Book | undefined> {
  const [book, structure] = await Promise.all([
    db.books.get(id),
    db.bookStructures.get(id),
  ]);
  return book && isNotDeleted(book)
    ? withBookStructure(book, structure)
    : undefined;
}

/**
 * Whole-table reads filter tombstones after the read: a Dexie `filter`
 * walks a cursor, one request per row, where `toArray` reads the table at
 * once. The Library reads these on every change, and a new device's
 * restore changes them page after page.
 */
export async function getAllBooks(): Promise<Book[]> {
  const [books, structures] = await Promise.all([
    db.books.toArray(),
    db.bookStructures.toArray(),
  ]);
  const structureByBook = new Map(
    structures.map((structure) => [structure.bookId, structure]),
  );
  return books.filter(isNotDeleted).map((book) =>
    withBookStructure(book, structureByBook.get(book.id)),
  );
}

/** The book with this device's structure, when it was read from the same EPUB. */
export function withBookStructure<Row extends Book>(
  book: Row,
  structure: BookStructureRow | undefined,
): Row {
  if (structure?.sourceFileId !== book.sourceFileId) return book;
  return {
    ...book,
    manifest: structure.manifest,
    spine: structure.spine,
    toc: structure.toc,
  };
}

/**
 * The Book row that syncs. One synced record holds at most 64 KiB, and a
 * large technical book's table of contents alone can be several times that.
 * Each device reads the structure from its own copy of the EPUB, so the row
 * needs only the book's metadata. It keeps the whole structure while it fits,
 * though: app versions from before `bookStructures` read the manifest, spine
 * and contents from this row. For a larger book the row keeps what those
 * versions need to open it: the spine, its manifest items, and as many
 * levels of the contents as fit.
 */
export function syncedBookRow(book: Book): Book {
  if (syncedRowBytes(book) <= MAX_SYNC_VALUE_BYTES) return book;

  const inSpine = new Set(book.spine.map((item) => item.idref));
  const row: Book = {
    ...book,
    metadata: shortenedMetadata(book.metadata),
    manifest: book.manifest.filter((item) => inSpine.has(item.id)),
    toc: [],
  };
  // A spine this long leaves older versions a book they cannot open.
  if (syncedRowBytes(row) > MAX_SYNC_VALUE_BYTES) {
    row.spine = [];
    row.manifest = [];
  }
  // The empty list already counts its two bytes.
  const tocBudget = MAX_SYNC_VALUE_BYTES - syncedRowBytes(row) + 2;
  row.toc = tocWithin(book.toc, tocBudget);
  return row;
}

const MAX_SHORTENED_METADATA_LENGTH = 2_000;

function shortenedMetadata(metadata: Book["metadata"]): Book["metadata"] {
  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [
      key,
      typeof value === "string"
        ? value.slice(0, MAX_SHORTENED_METADATA_LENGTH)
        : value,
    ]),
  );
}

/** The deepest levels of the contents that fit, or as many top entries as fit. */
function tocWithin(toc: TOCItem[], budget: number): TOCItem[] {
  for (let depth = tocDepth(toc); depth > 0; depth -= 1) {
    const levels = tocToDepth(toc, depth);
    if (jsonBytes(levels) <= budget) return levels;
  }

  const kept: TOCItem[] = [];
  let bytes = 2;
  for (const item of tocToDepth(toc, 1)) {
    const itemBytes = jsonBytes(item) + (kept.length > 0 ? 1 : 0);
    if (bytes + itemBytes > budget) break;
    bytes += itemBytes;
    kept.push(item);
  }
  return kept;
}

function tocDepth(items: TOCItem[]): number {
  return items.reduce(
    (depth, item) => Math.max(depth, 1 + tocDepth(item.children ?? [])),
    0,
  );
}

function tocToDepth(items: TOCItem[], depth: number): TOCItem[] {
  return items.map(({ children, ...item }) =>
    depth > 1 && children?.length
      ? { ...item, children: tocToDepth(children, depth - 1) }
      : item,
  );
}

function syncedRowBytes(book: Book): number {
  return jsonBytes({ ...book, isDeleted: false });
}

const encoder = new TextEncoder();

function jsonBytes(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).byteLength;
}

export async function deleteBook(id: string): Promise<void> {
  const book = await db.books.get(id);
  if (!book || book.isDeleted) return;

  await db.transaction(
    "rw",
    [
      db.books,
      db.readingCheckpoints,
      db.readingSessions,
      db.highlights,
      db.readingState,
      db.notes,
      db.noteDrafts,
      db.bookFiles,
      db.bookMaterializations,
      db.bookStructures,
      db.bookTextCache,
      db.bookChapterSourceCache,
    ],
    async () => {
      await db.books.delete(id);
      await db.readingCheckpoints.where("bookId").equals(id).delete();
      await db.readingSessions.where("bookId").equals(id).delete();
      await db.highlights.where("bookId").equals(id).delete();
      await db.readingState.where("bookId").equals(id).delete();
      await db.noteDrafts.where("bookId").equals(id).delete();
      await db.notes.where("bookId").equals(id).delete();
      await db.bookFiles.where("bookId").equals(id).delete();
      await db.bookMaterializations.delete(id);
      await db.bookStructures.delete(id);
      await db.bookTextCache.delete(id);
      await db.bookChapterSourceCache.delete(id);
    },
  );
}

export async function getBookBySourceFileId(
  sourceFileId: FileId,
): Promise<Book | undefined> {
  const book = await db.books
    .where("sourceFileId")
    .equals(sourceFileId)
    .first();
  return book && isNotDeleted(book)
    ? withBookStructure(book, await db.bookStructures.get(book.id))
    : undefined;
}
