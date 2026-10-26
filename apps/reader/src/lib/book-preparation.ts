import { getRuntimeOnline } from "@/features/sync-lab/runtime";
import { BookCoverDecodeError, createBookCover } from "@/lib/book-cover";
import { DuplicateBookError } from "@/lib/book-import-errors";
import {
  bookMaterializationTables,
  db,
  getBookBySourceFileId,
  getBookFile,
  getBookMaterialization,
  getBookStructure,
  putBookStructure,
  replaceBookMaterialization,
  withBookStructure,
  type Book,
  type BookStructure,
} from "@/lib/db";
import {
  parseEPUB,
  readBookStructure,
  type ParsedEPUB,
} from "@/lib/epub-parser";
import { files, type IdentifiedFile } from "@/lib/files";

export const BOOK_MATERIALIZATION_RECIPE_VERSION = 1;

export interface BookPreparationResult {
  /** The book with this device's structure, read from its EPUB. */
  book: Book;
  /** The caller's Book is out of date: its cover or its structure differs. */
  bookChanged: boolean;
  materialized: boolean;
}

const pendingPreparations = new Map<string, Promise<BookPreparationResult>>();

/**
 * Ensure one synchronized Book has all durable local artifacts required to
 * open. The same operation handles an established client and a new download.
 */
export async function prepareBook(
  book: Book,
  sourceBlob?: Blob,
): Promise<BookPreparationResult> {
  const key = `${book.id}:${book.sourceFileId}`;
  const pending = pendingPreparations.get(key);
  if (pending) return pending;

  const preparation = prepareBookOnce(book, sourceBlob).finally(() => {
    pendingPreparations.delete(key);
  });
  pendingPreparations.set(key, preparation);
  return preparation;
}

/**
 * Persist a newly parsed Book through the same artifact commit path, with
 * its EPUB: the bytes are stored, and queued to upload, only with the book.
 */
export async function prepareNewBook(
  parsedEpub: ParsedEPUB,
  source: IdentifiedFile,
): Promise<BookPreparationResult> {
  return commitMaterialization(parsedEpub.book, parsedEpub, source);
}

async function prepareBookOnce(
  book: Book,
  sourceBlob?: Blob,
): Promise<BookPreparationResult> {
  const [marker, structure] = await Promise.all([
    getBookMaterialization(book.id),
    getBookStructure(book.id),
  ]);
  const coverIsComplete = book.cover === null || book.cover.blurHash !== null;
  if (
    marker?.sourceFileId === book.sourceFileId &&
    marker.recipeVersion === BOOK_MATERIALIZATION_RECIPE_VERSION &&
    coverIsComplete
  ) {
    if (structure?.sourceFileId === book.sourceFileId)
      return {
        book: withBookStructure(book, structure),
        bookChanged: false,
        materialized: false,
      };
    // Expanded before this device kept structures: its files hold one. If
    // they cannot give it, they are damaged, and expanding again repairs them.
    const expanded = await readExpandedStructure(book).catch(() => null);
    if (expanded) {
      await putBookStructure(book, expanded);
      return {
        book: { ...book, ...expanded },
        bookChanged: !sameStructure(book, expanded),
        materialized: false,
      };
    }
  }

  // A complete materialization above needs no original bytes. Otherwise avoid
  // starting a remote transfer when the browser already knows it is offline.
  if (
    !sourceBlob &&
    typeof navigator !== "undefined" &&
    !getRuntimeOnline() &&
    !(await files.hasLocal(book.sourceFileId))
  ) {
    throw new Error(
      "Connect to the internet to download this book, then try again.",
    );
  }

  const epubBlob = sourceBlob ?? (await files.get(book.sourceFileId));
  const parsedEpub = await parseEPUB(epubBlob, {
    sourceFileId: book.sourceFileId,
    bookId: book.id,
  });

  return commitMaterialization(book, parsedEpub, null);
}

/**
 * Writes everything the book needs in one transaction: a new book's EPUB,
 * the cover, the Book row, its expanded files, its structure and the
 * completion marker. A full disk, a crash or a closed tab leaves all of it
 * or none of it, and nothing uploads until it has committed.
 *
 * `source` is a new book's EPUB; an established book's is already stored.
 * The structure comes from the EPUB, not from `book`: a synced row can hold
 * a shortened one.
 */
async function commitMaterialization(
  book: Book,
  parsedEpub: ParsedEPUB,
  source: IdentifiedFile | null,
): Promise<BookPreparationResult> {
  const cover = await prepareCover(book, parsedEpub.coverBlob);
  const writeBook = source !== null || !coversEqual(book.cover, cover.ref);
  const { manifest, spine, toc } = parsedEpub.book;
  const preparedBook: Book = {
    ...book,
    manifest,
    spine,
    toc,
    cover: cover.ref,
  };

  const stored = [source, cover.file].filter((file) => file !== null);
  // Files are locked only when this commit stores one: covers read them.
  const fileTables = stored.length ? [db.files, db.fileUploadOperations] : [];
  await db.transaction(
    "rw",
    [...fileTables, ...bookMaterializationTables()],
    async () => {
      // Another tab may have added the same file since the caller looked.
      const existing = source && (await getBookBySourceFileId(source.id));
      if (existing)
        throw new DuplicateBookError(
          "A book with this file already exists in your library",
          existing,
        );
      for (const file of stored) await files.store(file);
      await replaceBookMaterialization({
        book: preparedBook,
        bookFiles: parsedEpub.files,
        recipeVersion: BOOK_MATERIALIZATION_RECIPE_VERSION,
        writeBook,
      });
    },
  );

  return {
    book: preparedBook,
    bookChanged: writeBook || !sameStructure(book, preparedBook),
    materialized: true,
  };
}

function readExpandedStructure(book: Book): Promise<BookStructure> {
  return readBookStructure(async (path) => {
    const file = await getBookFile(book.id, path);
    return file && new Uint8Array(await file.content.arrayBuffer());
  });
}

/** Both are the structure one EPUB declares, as the parser reads it. */
function sameStructure(left: BookStructure, right: BookStructure): boolean {
  return (
    JSON.stringify([left.manifest, left.spine, left.toc]) ===
    JSON.stringify([right.manifest, right.spine, right.toc])
  );
}

/** The cover reference, and the new cover's bytes to store with the book. */
async function prepareCover(
  book: Book,
  sourceCover: Blob | undefined,
): Promise<{ ref: Book["cover"]; file: IdentifiedFile | null }> {
  if (book.cover && book.cover.blurHash !== null)
    return { ref: book.cover, file: null };
  if (!sourceCover) return { ref: null, file: null };

  let createdCover: Awaited<ReturnType<typeof createBookCover>>;
  try {
    createdCover = await createBookCover(sourceCover);
  } catch (error) {
    if (!(error instanceof BookCoverDecodeError)) throw error;
    console.warn(`Ignoring invalid cover for book ${book.id}:`, error);
    return { ref: null, file: null };
  }
  const file = await files.identify(createdCover.blob, {
    mediaType: "image/webp",
  });
  return { ref: { fileId: file.id, blurHash: createdCover.blurHash }, file };
}

function coversEqual(left: Book["cover"], right: Book["cover"]): boolean {
  if (left === null || right === null) return left === right;
  return left.fileId === right.fileId && left.blurHash === right.blurHash;
}
