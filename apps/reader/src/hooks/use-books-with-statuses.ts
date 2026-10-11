/**
 * Combined hook for fetching books with their reading statuses
 * This prevents flicker by loading both data sources together
 */

import {
  getAllBooks,
  getAllReadingStatuses,
  getLatestReadingCheckpoints,
  type Book,
  type ReadingCheckpoint,
  type ReadingStatus,
} from "@/lib/db";
import {
  compareBooksByDateAddedDesc,
  compareBooksByLastReadDesc,
} from "@/lib/library-sort";
import { useQuery } from "@tanstack/react-query";
import { bookKeys } from "./use-book-loader";
import { readingStatusKeys } from "./use-reading-status";

export interface CategorizedBooks {
  /** Books currently being read, most recently read first */
  continueReading: Book[];
  /** Books in the library (not started or want-to-read), most recently added first */
  library: Book[];
  /** Books that have been finished, most recently added first */
  finished: Book[];
  /** All books for counting/filtering purposes */
  all: Book[];
}

/**
 * Hook for fetching all books with their reading statuses in a single query.
 * Returns books already categorized by reading status and sorted:
 * - "continueReading" by most recently read (reading checkpoint lastRead,
 *   falling back to most recently added for never-read books)
 * - "library" and "finished" by most recently added
 * This prevents the flicker that occurs when books and statuses load separately.
 */
export function useBooksWithStatuses() {
  return useQuery({
    networkMode: "always", // Books and reading statuses are stored in IndexedDB.
    // Combine query keys since this depends on all three data sources.
    // Query invalidation also tracks readingState and readingCheckpoints for
    // this combined view, so status and last-read changes refresh the list.
    queryKey: [...bookKeys.list(), ...readingStatusKeys.allStatuses()],
    queryFn: async (): Promise<{
      books: Book[];
      statuses: Map<string, ReadingStatus>;
      lastReadByBook: Map<string, number>;
      /** The latest checkpoint per book across devices, for reading progress. */
      latestCheckpoints: Map<string, ReadingCheckpoint>;
      categorized: CategorizedBooks;
    }> => {
      // Fetch all sources in parallel: book metadata, reading statuses, and
      // the latest reading checkpoint per book.
      const [books, statuses, latestCheckpoints] = await Promise.all([
        getAllBooks(),
        getAllReadingStatuses(),
        getLatestReadingCheckpoints(),
      ]);
      const lastReadByBook = new Map(
        [...latestCheckpoints].map(([bookId, checkpoint]) => [
          bookId,
          checkpoint.lastRead,
        ]),
      );

      // Categorize books by status
      const continueReading: Book[] = [];
      const library: Book[] = [];
      const finished: Book[] = [];

      for (const book of books) {
        const status = statuses.get(book.id);

        if (status === "reading") {
          continueReading.push(book);
        } else if (status === "finished") {
          finished.push(book);
        } else {
          // null, "want-to-read", or "dnf" go to library section
          library.push(book);
        }
      }

      // Ordering: books being read sort by most recently read (checkpoint
      // lastRead, falling back to dateAdded); everything else sorts by most
      // recently added.
      continueReading.sort(compareBooksByLastReadDesc(lastReadByBook));
      library.sort(compareBooksByDateAddedDesc);
      finished.sort(compareBooksByDateAddedDesc);

      return {
        books,
        statuses,
        lastReadByBook,
        latestCheckpoints,
        categorized: {
          continueReading,
          library,
          finished,
          all: books,
        },
      };
    },
    // This query reads only local IndexedDB, so keeping it immediately stale
    // is cheap and guarantees the continue-reading order reflects the latest
    // progress save every time the library mounts.
    staleTime: 0,
    gcTime: 30 * 60 * 1000, // 30 minutes
    refetchOnWindowFocus: false,
  });
}
