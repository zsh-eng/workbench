import { getRuntimeOnline } from "@/features/sync-lab/runtime";
import { BookCoverDecodeError, createBookCover } from "@/lib/book-cover";
import { DuplicateBookError } from "@/lib/book-import-errors";
import {
  bookMaterializationTables,
  db,
  getBookBySourceFileId,
  getBookMaterialization,
  replaceBookMaterialization,
  type Book,
  type BookFile,
} from "@/lib/db";
import { parseEPUB, type ParsedEPUB } from "@/lib/epub-parser";
import { files, type IdentifiedFile } from "@/lib/files";

export const BOOK_MATERIALIZATION_RECIPE_VERSION = 1;

export interface BookPreparationResult {
  book: Book;
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
  return commitMaterialization(
    parsedEpub.book,
    parsedEpub.files,
    parsedEpub.coverBlob,
    source,
  );
}

async function prepareBookOnce(
  book: Book,
  sourceBlob?: Blob,
): Promise<BookPreparationResult> {
  const marker = await getBookMaterialization(book.id);
  const coverIsComplete = book.cover === null || book.cover.blurHash !== null;
  if (
    marker?.sourceFileId === book.sourceFileId &&
    marker.recipeVersion === BOOK_MATERIALIZATION_RECIPE_VERSION &&
    coverIsComplete
  ) {
    return { book, bookChanged: false, materialized: false };
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

  return commitMaterialization(
    book,
    parsedEpub.files,
    parsedEpub.coverBlob,
    null,
  );
}

/**
 * Writes everything the book needs in one transaction: a new book's EPUB,
 * the cover, the Book row, its expanded files and the completion marker. A
 * full disk, a crash or a closed tab leaves all of it or none of it, and
 * nothing uploads until it has committed.
 *
 * `source` is a new book's EPUB; an established book's is already stored.
 */
async function commitMaterialization(
  book: Book,
  bookFiles: BookFile[],
  coverBlob: Blob | undefined,
  source: IdentifiedFile | null,
): Promise<BookPreparationResult> {
  const cover = await prepareCover(book, coverBlob);
  const bookChanged = source !== null || !coversEqual(book.cover, cover.ref);
  const preparedBook = bookChanged ? { ...book, cover: cover.ref } : book;

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
        bookFiles,
        recipeVersion: BOOK_MATERIALIZATION_RECIPE_VERSION,
        writeBook: bookChanged,
      });
    },
  );

  return {
    book: preparedBook,
    bookChanged,
    materialized: true,
  };
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
