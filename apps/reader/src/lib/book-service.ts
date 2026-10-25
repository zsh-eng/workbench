import { prepareBook, prepareNewBook } from "@/lib/book-preparation";
import type { Book } from "@/lib/db";
import { getBookBySourceFileId } from "@/lib/db";
import { parseEPUB } from "@/lib/epub-parser";
import { files, type FileId } from "@/lib/files";

export class DuplicateBookError extends Error {
  existingBook: Book;

  constructor(message: string, existingBook: Book) {
    super(message);
    this.name = "DuplicateBookError";
    this.existingBook = existingBook;
  }
}

/**
 * The steps of an import, in order, as each starts. Reading follows the
 * stored file; preparing (the cover, then the write) knows what the EPUB
 * says about itself.
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
    };

export interface AddBookOptions {
  onStep?: (step: BookImportStep) => void;
  /** When the book counts as added; a batch sets it to keep its order. */
  dateAdded?: number;
}

/**
 * Add a book from an EPUB file
 * Throws DuplicateBookError if the source file already exists in the library.
 */
export async function addBookFromFile(
  file: File,
  options: AddBookOptions = {},
): Promise<Book> {
  // Validate file type
  if (!file.name.toLowerCase().endsWith(".epub")) {
    throw new Error("Only EPUB files are supported");
  }

  try {
    options.onStep?.({ stage: "saving" });
    const sourceFileId = await files.put(file, {
      mediaType: "application/epub+zip",
    });
    const existingBook = await getBookBySourceFileId(sourceFileId);
    if (existingBook) {
      const prepared = await prepareBook(existingBook, file);
      throw new DuplicateBookError(
        "A book with this file already exists in your library",
        prepared.book,
      );
    }

    options.onStep?.({ stage: "reading", sourceFileId });
    const parsedEpub = await parseEPUB(file, {
      sourceFileId,
      fileName: file.name,
    });
    if (options.dateAdded !== undefined)
      parsedEpub.book.dateAdded = options.dateAdded;

    options.onStep?.({
      stage: "preparing",
      sourceFileId,
      title: parsedEpub.book.title,
      author: parsedEpub.book.author,
      cover: parsedEpub.coverBlob ?? null,
    });
    const prepared = await prepareNewBook(parsedEpub);
    return prepared.book;
  } catch (error) {
    // Re-throw DuplicateBookError as-is
    if (error instanceof DuplicateBookError) {
      throw error;
    }

    console.error("Error adding book:", error);
    throw new Error(
      `Failed to add book: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}
