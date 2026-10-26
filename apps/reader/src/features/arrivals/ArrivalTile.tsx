import { COVER_SHADOW } from "@/features/library/LibraryBooks";
import { describeImportError } from "@/lib/book-import-errors";
import type { Book } from "@/lib/db";
import { cn } from "@/lib/utils";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  arrivalError,
  useArrival,
  useArrivalEnvironment,
  useArrivalPlaces,
  type Arrival,
} from "./arrival-store";
import { LazyArrivingCover } from "./LazyArrivingCover";

export type ArrivalGridItem = { book: Book } | { arrivalKey: string };

/**
 * The covers grid with a place held for each arriving book. Places are held
 * only where the new books will stay: newest first, in a view that shows
 * books you want to read. Each batch keeps the order its files were chosen
 * in, and the books it has finished stand in their own places, so nothing
 * moves when the next one lands. Elsewhere books simply appear as they
 * finish, and draw their arrival where they land.
 */
export function useArrivalGrid(
  shown: readonly Book[],
  holdPlaces: boolean,
): ArrivalGridItem[] {
  const places = useArrivalPlaces();
  return useMemo(() => {
    if (!holdPlaces || places.length === 0)
      return shown.map((book) => ({ book }));
    const bySource = new Map(shown.map((book) => [book.sourceFileId, book]));
    const placed = new Set<string>();
    const items: ArrivalGridItem[] = [];
    for (const place of places) {
      const book =
        place.sourceFileId && !place.duplicate
          ? bySource.get(place.sourceFileId)
          : undefined;
      if (book) {
        items.push({ book });
        placed.add(book.id);
      } else if (!place.settled) {
        items.push({ arrivalKey: place.key });
      }
    }
    for (const book of shown) if (!placed.has(book.id)) items.push({ book });
    return items;
  }, [places, holdPlaces, shown]);
}

/** Arrivals not on the shelf yet: an empty library waits for them. */
export function usePendingArrivalCount(): number {
  return useArrivalPlaces().filter((place) => place.pending).length;
}

/** The title set in type, as the Library draws a book without a cover. */
export function TypeCover({
  title,
  author,
  className,
}: {
  title: string;
  author: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "flex flex-col justify-between overflow-hidden bg-secondary p-[9%] text-left text-secondary-foreground",
        className,
      )}
      style={{ containerType: "inline-size" }}
    >
      <span
        className="line-clamp-5 font-serif leading-[0.95] font-medium tracking-tight text-balance"
        style={{ fontSize: "clamp(9px, 14cqi, 28px)" }}
      >
        {title}
      </span>
      <span
        className="line-clamp-2 text-muted-foreground"
        style={{ fontSize: "clamp(6px, 7cqi, 12px)" }}
      >
        {author}
      </span>
    </span>
  );
}

const STEP_WORDS = {
  saving: "Opening the file…",
  reading: "Reading the book…",
  preparing: "Making the cover…",
} as const;

/** After this long in one step, the tile says which step it is in. */
const SLOW_STEP_MS = 2500;

export function useSlowStep(arrival: Arrival): string | null {
  const stage = arrival.progress.stage;
  const working = stage in STEP_WORDS;
  const [slow, setSlow] = useState<number | null>(null);
  useEffect(() => {
    if (!working) return;
    const left = arrival.changedAt + SLOW_STEP_MS - performance.now();
    const timer = window.setTimeout(
      () => setSlow(arrival.changedAt),
      Math.max(0, left),
    );
    return () => window.clearTimeout(timer);
  }, [arrival.changedAt, working]);
  return working && slow === arrival.changedAt
    ? STEP_WORDS[stage as keyof typeof STEP_WORDS]
    : null;
}

/**
 * The place an arriving book holds in the covers grid, until the book
 * itself stands there. It looks like the book's tile will: a cover the
 * size of the others, its title and author below.
 */
export function ArrivalTile({ arrivalKey }: { arrivalKey: string }) {
  const arrival = useArrival(arrivalKey);
  if (!arrival) return null;
  return <ArrivalPlaceTile arrival={arrival} />;
}

function ArrivalPlaceTile({ arrival }: { arrival: Arrival }) {
  const { records, source } = useArrivalEnvironment();
  const stage = arrival.progress.stage;
  const fileTitle = arrival.fileName.replace(/\.epub$/i, "");
  const title = arrival.title ?? fileTitle;
  const slowStep = useSlowStep(arrival);
  const failure =
    stage === "failed" ? describeImportError(arrivalError(arrival)) : null;
  const coverClass = cn(
    "aspect-[2/3] w-full rounded-[3px] transition-opacity duration-200",
    COVER_SHADOW,
    (stage === "queued" || stage === "duplicate" || stage === "failed") &&
      "opacity-45",
  );
  // Until the title is known the place keeps room for two lines of it, so
  // the rows below never move down when it comes; then it matches the tile
  // the book will have.
  const caption = (
    <>
      <h3
        className={cn(
          "mt-3 line-clamp-2 text-[13px] leading-snug font-normal",
          arrival.title === null && "min-h-[2lh] text-muted-foreground",
        )}
      >
        {title}
      </h3>
      <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">
        {stage === "duplicate"
          ? "Already in your library"
          : failure
            ? failure.title
            : (slowStep ?? arrival.author ?? " ")}
      </span>
    </>
  );

  if (stage === "duplicate" && arrival.existingBookId) {
    return (
      <li className="relative min-w-0" data-arrival-tile={stage}>
        <Link
          to={`/reader/${arrival.existingBookId}`}
          aria-label={`${title} is already in your library. Open it`}
          className="block rounded-[3px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className={cn("block bg-secondary", coverClass)} />
          {caption}
        </Link>
      </li>
    );
  }

  if (failure) {
    return (
      <li className="relative min-w-0" data-arrival-tile={stage}>
        {/* The actions sit on the empty cover, so the tile keeps the height
            of the books beside it and the shelf below does not move. */}
        <span className="relative block">
          <span className={cn("block bg-secondary", coverClass)} />
          <span className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-0.5 p-3 text-[12px]">
            {failure.retry && (
              <button
                type="button"
                onClick={() => source.retry(arrival.key)}
                className="h-8 rounded-full px-3 font-medium text-foreground outline-none hover:bg-foreground/[0.05] focus-visible:ring-2 focus-visible:ring-ring"
              >
                Try again
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                source.dismiss(arrival.key);
                records.dismiss(arrival.key);
              }}
              className="h-8 rounded-full px-3 text-muted-foreground outline-none hover:bg-foreground/[0.05] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              Dismiss
            </button>
          </span>
        </span>
        {caption}
      </li>
    );
  }

  return (
    <li
      className="relative min-w-0"
      data-arrival-tile={stage}
      aria-label={`Adding ${title}`}
      aria-busy="true"
    >
      <LazyArrivingCover
        arrival={arrival}
        plain={
          arrival.cover ? null : (
            <TypeCover
              title={title}
              author={arrival.author ?? ""}
              className="size-full"
            />
          )
        }
        plainReady={false}
        className={coverClass}
      />
      {caption}
    </li>
  );
}
