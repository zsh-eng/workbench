import { getRuntimeStorage } from "@/features/sync-lab/runtime";
import type { Book, ReadingCheckpoint, ReadingStatus } from "@/lib/db";

/**
 * The Library's view rules. The books you are reading sit on the shelf, so
 * the filters cover everything else. A book with no status counts as one you
 * want to read.
 */
export type LibraryFilter = "all" | Exclude<ReadingStatus, "reading">;
export type LibrarySort = "recent" | "title" | "author" | "added";
export type LibraryLayout = "covers" | "list";

export const LIBRARY_FILTERS: { value: LibraryFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "want-to-read", label: "Want to read" },
  { value: "finished", label: "Finished" },
  { value: "dnf", label: "Did not finish" },
];

export const LIBRARY_SORTS: { value: LibrarySort; label: string }[] = [
  { value: "recent", label: "Recently read" },
  { value: "title", label: "Title" },
  { value: "author", label: "Author" },
  { value: "added", label: "Date added" },
];

export function matchesFilter(
  status: ReadingStatus | null,
  filter: LibraryFilter,
): boolean {
  if (status === "reading") return false;
  if (filter === "all") return true;
  return (status ?? "want-to-read") === filter;
}

function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase();
}

/** Whether every word of a search is in the title or the author. */
export function matchesSearch(book: Book, search: string): boolean {
  const haystack = fold(`${book.title} ${book.author}`);
  return fold(search)
    .split(/\s+/)
    .every((word) => haystack.includes(word));
}

function surname(author: string): string {
  return author.trim().split(/\s+/).at(-1) ?? author;
}

export function sortBooks(
  books: Book[],
  sort: LibrarySort,
  lastReadByBook: ReadonlyMap<string, number>,
): Book[] {
  const sorted = [...books];
  if (sort === "title")
    return sorted.sort((a, b) => a.title.localeCompare(b.title));
  if (sort === "author")
    return sorted.sort((a, b) =>
      surname(a.author).localeCompare(surname(b.author)),
    );
  if (sort === "added") return sorted.sort((a, b) => b.dateAdded - a.dateAdded);
  return sorted.sort(
    (a, b) =>
      (lastReadByBook.get(b.id) ?? 0) - (lastReadByBook.get(a.id) ?? 0) ||
      b.dateAdded - a.dateAdded,
  );
}

/**
 * How far through the book its latest position is, from 0 to 1. Chapters
 * count equally, so this is an estimate; exact pages exist only while the
 * Reader has the book open.
 */
export function readingProgress(
  book: Book,
  status: ReadingStatus | null,
  checkpoint: ReadingCheckpoint | undefined,
): number {
  if (status === "finished") return 1;
  if (!checkpoint) return 0;
  const chapters = Math.max(1, book.spine.length);
  const position =
    checkpoint.currentSpineIndex + checkpoint.scrollProgress / 100;
  return Math.min(1, Math.max(0, position / chapters));
}

const VIEW_STORAGE_KEY = "reader-library-view-v1";

export interface LibraryViewPreferences {
  sort: LibrarySort;
  layout: LibraryLayout;
}

const DEFAULT_VIEW: LibraryViewPreferences = {
  sort: "recent",
  layout: "covers",
};

/** Sorting and layout are preferences of this browser, not synced. */
export function readViewPreferences(): LibraryViewPreferences {
  try {
    const stored = JSON.parse(
      getRuntimeStorage().getItem(VIEW_STORAGE_KEY) ?? "null",
    ) as Partial<LibraryViewPreferences> | null;
    return {
      sort: LIBRARY_SORTS.some((option) => option.value === stored?.sort)
        ? stored!.sort!
        : DEFAULT_VIEW.sort,
      layout:
        stored?.layout === "list" || stored?.layout === "covers"
          ? stored.layout
          : DEFAULT_VIEW.layout,
    };
  } catch {
    return DEFAULT_VIEW;
  }
}

export function writeViewPreferences(view: LibraryViewPreferences): void {
  try {
    getRuntimeStorage().setItem(VIEW_STORAGE_KEY, JSON.stringify(view));
  } catch {
    // A blocked store keeps the choice for this visit only.
  }
}
