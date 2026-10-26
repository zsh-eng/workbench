import {
  asBookImportError,
  BookImportError,
  DuplicateBookError,
} from "@/lib/book-import-errors";
import { prepareBook, prepareNewBook } from "@/lib/book-preparation";
import type { Book } from "@/lib/db";
import { getBookBySourceFileId } from "@/lib/db";
import { parseEPUB } from "@/lib/epub-parser";
import { files, type FileId } from "@/lib/files";

export { DuplicateBookError };

/**
 * The steps of an import, in order, as each starts. Reading follows the
 * identified file; preparing (the cover, then the write) knows what the
 * EPUB says about itself.
 */
export type BookImportStep =
  | { stage: "saving" }
  | { stage: "reading"; sourceFileId: FileId }
  | {
      stage: "preparing";
      sourceFileId: FileId;
      title: string;
      author: string;
      cover: Blob | null;
      /** Entries at the top of the table of contents, when it has any. */
      chapters: number | null;
    };

export interface AddBookOptions {
  onStep?: (step: BookImportStep) => void;
  /** When the book counts as added; a batch sets it to keep its order. */
  dateAdded?: number;
}

/**
 * Add a book from an EPUB file. Nothing is stored until the EPUB has been
 * read: its bytes, cover and rows then commit together, so a failure leaves
 * no trace and Try again starts clean.
 *
 * Throws DuplicateBookError if the source file already exists in the
 * library, and BookImportError, with its kind, for every other failure.
 */
export async function addBookFromFile(
  file: File,
  options: AddBookOptions = {},
): Promise<Book> {
  try {
    if (!file.name.toLowerCase().endsWith(".epub"))
      throw new BookImportError({ kind: "not-epub", format: "name" });

    options.onStep?.({ stage: "saving" });
    const source = await files.identify(file, {
      mediaType: "application/epub+zip",
    });
    const existingBook = await getBookBySourceFileId(source.id);
    if (existingBook) {
      // The bytes belong to a book you have: keep them, and it opens here.
      await files.store(source);
      const prepared = await prepareBook(existingBook, file);
      throw new DuplicateBookError(
        "A book with this file already exists in your library",
        prepared.book,
      );
    }

    options.onStep?.({ stage: "reading", sourceFileId: source.id });
    const parsedEpub = await parseEPUB(file, {
      sourceFileId: source.id,
      fileName: file.name,
    });
    if (options.dateAdded !== undefined)
      parsedEpub.book.dateAdded = options.dateAdded;

    options.onStep?.({
      stage: "preparing",
      sourceFileId: source.id,
      title: parsedEpub.book.title,
      author: parsedEpub.book.author,
      cover: parsedEpub.coverBlob ?? null,
      chapters: parsedEpub.book.toc.length || null,
    });
    const prepared = await prepareNewBook(parsedEpub, source);
    return prepared.book;
  } catch (error) {
    if (error instanceof DuplicateBookError) throw error;
    const failure = asBookImportError(error);
    if (failure.kind === "unexpected")
      console.error("Error adding book:", error);
    throw failure;
  }
}
