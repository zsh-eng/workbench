import { APP_PAGE_FRAME } from "@/components/app-header-styles";
import { PlaceHeader, usePlaceSearch } from "@/components/PlaceHeader";
import {
  BookTile,
  ReadingShelf,
  ShelfBook,
} from "@/features/library/LibraryBooks";
import { cn } from "@/lib/utils";
import type { MouseEvent } from "react";
import { SAMPLE_LIBRARY } from "./library-fixture";

export const SHELF_STATES = [
  { id: "three", label: "Three books" },
  { id: "one", label: "One book" },
  { id: "five", label: "Five books" },
] as const;

const READING_COUNT: Record<string, number> = { one: 1, three: 3, five: 5 };

const noop = () => {};
const noRemove = async () => {};

/** Links stay in the frame; the sample books do not open. */
function keepLinksInPlace(event: MouseEvent) {
  if ((event.target as Element).closest("a")) event.preventDefault();
}

/**
 * The top of the Library with sample books: the Reading shelf, then the
 * covers below it. A phone shows small covers with their progress; a wider
 * window shows a card with the title for each book.
 */
export function ShelfSpecimen({ state }: { state: string; nonce: number }) {
  const search = usePlaceSearch();
  const count = READING_COUNT[state] ?? 3;
  const reading = SAMPLE_LIBRARY.slice(0, count);
  const rest = SAMPLE_LIBRARY.slice(count);

  return (
    <div
      className="shelf-specimen min-h-dvh bg-background"
      onClickCapture={keepLinksInPlace}
    >
      {/* Book actions change the real library, so the sample hides them. */}
      <style>{`.shelf-specimen [aria-label^="Actions for"] { display: none }`}</style>
      <PlaceHeader
        current="library"
        search={search}
        label="Search library"
        placeholder="Title or author"
      />
      <div className={cn(APP_PAGE_FRAME, "pb-24")}>
        <ReadingShelf count={reading.length}>
          {reading.map(({ book, coverUrl, progress }) => (
            <ShelfBook
              key={book.id}
              book={book}
              status="reading"
              coverUrl={coverUrl}
              progress={progress}
              onCoverRequest={noop}
              onPrefetch={noop}
              onRemove={noRemove}
            />
          ))}
        </ReadingShelf>
        <h2 className="sr-only">Books</h2>
        <ul className="mt-9 grid grid-cols-2 gap-x-5 gap-y-10 sm:grid-cols-3 md:mt-14 md:grid-cols-[repeat(auto-fill,minmax(128px,1fr))] md:gap-x-8">
          {rest.map(({ book, coverUrl }) => (
            <BookTile
              key={book.id}
              book={book}
              status={null}
              coverUrl={coverUrl}
              onCoverRequest={noop}
              onPrefetch={noop}
              onRemove={noRemove}
            />
          ))}
        </ul>
      </div>
    </div>
  );
}
