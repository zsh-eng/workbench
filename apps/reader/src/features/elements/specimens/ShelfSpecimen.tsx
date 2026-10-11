import { APP_PAGE_FRAME } from "@/components/app-header-styles";
import { PlaceHeader, usePlaceSearch } from "@/components/PlaceHeader";
import {
  BookCover,
  BookTile,
  COVER_SHADOW,
  Hairline,
  ShelfBook,
} from "@/features/library/LibraryBooks";
import type { Book } from "@/lib/db";
import { cn } from "@/lib/utils";
import { useState, type MouseEvent } from "react";
import { SAMPLE_LIBRARY } from "./library-fixture";

export const SHELF_STATES = [
  { id: "three", label: "Three books" },
  { id: "one", label: "One book" },
  { id: "five", label: "Five books" },
] as const;

const READING_COUNT: Record<string, number> = { one: 1, three: 3, five: 5 };

export type ShelfVariant = "now" | "list" | "covers";

function variantFromUrl(): ShelfVariant {
  const variant = new URLSearchParams(location.search).get("variant");
  return variant === "list" || variant === "covers" ? variant : "now";
}

const noop = () => {};
const noRemove = async () => {};

/** Links stay in the frame; the sample books do not open. */
function keepLinksInPlace(event: MouseEvent) {
  if ((event.target as Element).closest("a")) event.preventDefault();
}

/**
 * The top of the phone Library with sample books: the Reading shelf, then
 * the covers below it. "now" is the shelf that ships, one wide card at a
 * time. "list" and "covers" are compact proposals for phones.
 */
export function ShelfSpecimen({ state }: { state: string; nonce: number }) {
  const [variant] = useState(variantFromUrl);
  const search = usePlaceSearch();
  const count = READING_COUNT[state] ?? 3;
  const reading = SAMPLE_LIBRARY.slice(0, count);
  const rest = SAMPLE_LIBRARY.slice(count);

  return (
    <div
      className="shelf-specimen min-h-dvh bg-background"
      onClickCapture={keepLinksInPlace}
    >
      {/* A phone has no hover, so book actions stay hidden there. The
          frame's host has a pointer; hide them as a phone would. */}
      <style>{`.shelf-specimen [aria-label^="Actions for"] { display: none }`}</style>
      <PlaceHeader
        current="library"
        search={search}
        label="Search library"
        placeholder="Title or author"
      />
      <div className={cn(APP_PAGE_FRAME, "pb-24")}>
        <section aria-label="Reading" className="mt-5">
          <h2 className="text-[12px] text-muted-foreground">
            Reading
            <span className="ml-1.5 font-numeric text-muted-foreground/60 tabular-nums">
              {reading.length}
            </span>
          </h2>
          {variant === "now" ? (
            <div className="-mx-4 mt-4 flex gap-6 overflow-x-auto px-4 pb-2 [scrollbar-width:none]">
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
            </div>
          ) : variant === "list" ? (
            <ul className="mt-4 grid gap-4">
              {reading.map(({ book, coverUrl, progress }) => (
                <ReadingRow
                  key={book.id}
                  book={book}
                  coverUrl={coverUrl}
                  progress={progress}
                />
              ))}
            </ul>
          ) : (
            <ul className="-mx-4 mt-4 flex gap-4 overflow-x-auto px-4 pb-2 [scrollbar-width:none]">
              {reading.map(({ book, coverUrl, progress }) => (
                <ReadingCover
                  key={book.id}
                  book={book}
                  coverUrl={coverUrl}
                  progress={progress}
                />
              ))}
            </ul>
          )}
        </section>
        <h2 className="sr-only">Books</h2>
        <ul className="mt-9 grid grid-cols-2 gap-x-5 gap-y-10">
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

interface ReadingBookProps {
  book: Book;
  coverUrl: string;
  progress: number;
}

/**
 * Proposal: each book you are reading on one row, with a small cover, the
 * title and the progress. Three books take about the height of one card.
 */
function ReadingRow({ book, coverUrl, progress }: ReadingBookProps) {
  return (
    <li>
      <a
        href={`/reader/${book.id}`}
        aria-label={`Open ${book.title}`}
        className="flex items-center gap-4 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4"
      >
        <BookCover
          book={book}
          coverUrl={coverUrl}
          className={cn(
            "h-[66px] w-[44px] shrink-0 rounded-[2px]",
            COVER_SHADOW,
          )}
        />
        <span className="min-w-0 flex-1">
          <h3 className="truncate font-serif text-[17px] leading-tight font-normal">
            {book.title}
          </h3>
          <span className="mt-0.5 block truncate text-[12.5px] text-muted-foreground">
            {book.author}
          </span>
          <span className="mt-2.5 flex items-center gap-3">
            <Hairline value={progress} className="flex-1" />
            <span className="w-8 text-right font-numeric text-[11.5px] text-muted-foreground tabular-nums">
              {Math.round(progress * 100)}%
            </span>
          </span>
        </span>
      </a>
    </li>
  );
}

/**
 * Proposal: smaller covers with the progress under each, so three or four
 * books show at once. The cover carries the title.
 */
function ReadingCover({ book, coverUrl, progress }: ReadingBookProps) {
  return (
    <li className="w-[92px] shrink-0">
      <a
        href={`/reader/${book.id}`}
        aria-label={`Open ${book.title}`}
        className="block rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4"
      >
        <BookCover
          book={book}
          coverUrl={coverUrl}
          className={cn("h-[138px] w-[92px] rounded-[3px]", COVER_SHADOW)}
        />
        <Hairline value={progress} className="mt-3" />
        <span className="mt-1.5 block font-numeric text-[11.5px] text-muted-foreground tabular-nums">
          {Math.round(progress * 100)}%
        </span>
      </a>
    </li>
  );
}
