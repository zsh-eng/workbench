import { Button } from "@/components/ui/button";
import { DetentSheet } from "@/components/ui/detent-sheet";
import { COVER_SHADOW } from "@/features/library/LibraryBooks";
import { MEDIUM_DETENT } from "@/features/reader/ReaderDetentSheets";
import { useFileUrl } from "@/hooks/use-file-url";
import { cn } from "@/lib/utils";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  useArrival,
  useArrivalEnvironment,
  type Arrival,
  type ArrivalLook,
} from "./arrival-store";
import { TypeCover, useSlowStep } from "./ArrivalTile";
import {
  arrivalPainted,
  ArrivingCover,
  useCoverUrl,
  useDecoded,
} from "./ArrivingCover";
import { prefersReducedMotion } from "./engine/arrival-engine";

export interface ArrivalSheetProps {
  arrivalKey: string;
  /** Opens a book: the Reader in the app, a note in Design ideas. */
  onOpenBook: (bookId: string, title: string) => void;
  /** The sheet has closed and the cover is in its place. */
  onDone: () => void;
  /** Covers of books already on the shelf, when files do not hold them. */
  coverUrlFor?: (bookId: string) => string | undefined;
  /** Ink; Design ideas also show the calm and still fallbacks here. */
  look?: ArrivalLook;
}

/**
 * The cover's height: all that the medium detent leaves after the title,
 * the button and the bottom inset (about 9rem and the inset), so the sheet
 * still fits the detent without a scroll.
 */
const COVER_HEIGHT =
  "clamp(9rem, calc(55dvh - 9.5rem - max(1.25rem, env(safe-area-inset-bottom))), 22rem)";

/** The cover's way down from the sheet to its place in the grid. */
const FLIGHT = {
  duration: 460,
  easing: "cubic-bezier(0.32, 0.72, 0, 1)",
} as const;

interface Flight {
  from: DOMRect;
  to: DOMRect;
}

/** The longest the flying cover waits for the grid to draw the book. */
const PAINT_WAIT_MS = 1000;

/**
 * Resolves once the grid shows the book under the flying cover and a frame
 * has painted it, so the flyer never fades over a blank card. It waits a
 * second at most.
 */
function gridPainted(key: string, cancelled: () => boolean): Promise<void> {
  const start = performance.now();
  return new Promise((resolve) => {
    const check = () => {
      if (cancelled()) return resolve();
      const cover = [
        ...document.querySelectorAll(`[data-arrival-key="${CSS.escape(key)}"]`),
      ].find(
        (element) =>
          !element.closest("[data-arrival-flight], [data-arrival-sheet]"),
      );
      if (cover && arrivalPainted(cover))
        requestAnimationFrame(() => resolve());
      else if (performance.now() - start > PAINT_WAIT_MS) resolve();
      else requestAnimationFrame(check);
    };
    check();
  });
}

function headline(arrival: Arrival): string {
  switch (arrival.progress.stage) {
    case "ready":
      return "In your library";
    case "duplicate":
      return "Already in your library";
    case "failed":
      return "Couldn’t add this book";
    default:
      return "Adding to your library";
  }
}

/**
 * One book on its own arrives here, in a sheet at the medium detent over
 * the Library: the cover large, drawn in ink as the import works, then the
 * title, the author, its chapters and Read now. Closing the sheet sends the
 * cover down to the place the book holds in the grid, which waits empty
 * meanwhile, so the book stays one thing. A book still arriving goes on
 * arriving there, in the grid's look. The same file again shows the copy
 * you have; a file that fails offers Try again.
 */
export function ArrivalSheet({
  arrivalKey,
  onOpenBook,
  onDone,
  coverUrlFor,
  look = "ink",
}: ArrivalSheetProps) {
  const { records, source } = useArrivalEnvironment();
  const live = useArrival(arrivalKey);
  // The record can leave while the sheet closes; the sheet keeps its words.
  const last = useRef(live);
  if (live) last.current = live;
  const arrival = live ?? last.current;
  const [isOpen, setOpen] = useState(true);
  const [flight, setFlight] = useState<Flight | null>(null);
  const coverRef = useRef<HTMLSpanElement>(null);
  const done = useRef(onDone);
  done.current = onDone;

  // Before the first paint, so the grid never draws the book the sheet shows.
  useLayoutEffect(() => {
    records.present(arrivalKey, true);
    return () => records.present(arrivalKey, false);
  }, [arrivalKey, records]);

  // The same file again: the sheet says so and shows the copy you have, so
  // the grid needs no place for a book that is not coming.
  const isDuplicate = arrival?.progress.stage === "duplicate";
  useEffect(() => {
    if (!isDuplicate) return;
    records.dismiss(arrivalKey);
    source.dismiss(arrivalKey);
  }, [arrivalKey, isDuplicate, records, source]);

  const finish = (after: number) =>
    window.setTimeout(() => done.current(), after);

  const close = () => {
    if (!isOpen) return;
    setOpen(false);
    const from = coverRef.current?.getBoundingClientRect();
    const place = document.querySelector(
      `[data-arrival-place="${CSS.escape(arrivalKey)}"]`,
    );
    const to = place?.getBoundingClientRect();
    const inView =
      to !== undefined &&
      to.width > 0 &&
      to.bottom > 0 &&
      to.top < window.innerHeight;
    // A file that failed has no cover to carry; its place shows Try again.
    const carries = arrival?.progress.stage !== "failed";
    if (
      from &&
      to &&
      inView &&
      carries &&
      look !== "still" &&
      !prefersReducedMotion()
    ) {
      setFlight({ from, to });
      return;
    }
    records.present(arrivalKey, false);
    finish(450);
  };

  if (!arrival) return null;
  const stage = arrival.progress.stage;
  const duplicate = stage === "duplicate";
  const bookId = duplicate ? arrival.existingBookId : arrival.bookId;
  const read = () => {
    if (!bookId) return;
    setOpen(false);
    records.present(arrivalKey, false);
    records.settle(arrivalKey);
    onOpenBook(bookId, arrival.title ?? "");
    finish(450);
  };

  return (
    <>
      <DetentSheet
        isOpen={isOpen}
        onOpenChange={(open) => {
          if (!open) close();
        }}
        title={headline(arrival)}
        snapPoints={[MEDIUM_DETENT]}
      >
        <div
          className="flex flex-col gap-5 px-5 pt-2 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
          data-arrival-sheet={stage}
        >
          <div className="flex items-end gap-4">
            <span
              ref={coverRef}
              className={cn(
                "relative block shrink-0 overflow-hidden rounded-[3px] bg-secondary",
                COVER_SHADOW,
                flight && "opacity-0",
                stage === "failed" && "opacity-45",
              )}
              style={{ height: COVER_HEIGHT, aspectRatio: "2 / 3" }}
            >
              {/* While the cover flies, the flyer is its only drawing. */}
              {duplicate ? (
                <ExistingCover arrival={arrival} coverUrlFor={coverUrlFor} />
              ) : stage === "failed" || flight ? null : (
                <SheetCover
                  arrival={arrival}
                  look={look}
                  className="size-full"
                />
              )}
            </span>
            <SheetWords arrival={arrival} />
          </div>
          {stage === "failed" ? (
            <Button
              size="lg"
              className="h-11 w-full rounded-full text-[15px]"
              onClick={() => source.retry(arrivalKey)}
            >
              Try again
            </Button>
          ) : (
            <Button
              size="lg"
              className="h-11 w-full rounded-full text-[15px]"
              disabled={!bookId}
              onClick={read}
            >
              Read now
            </Button>
          )}
        </div>
      </DetentSheet>
      {flight &&
        createPortal(
          <CoverFlight
            arrivalKey={arrivalKey}
            flight={flight}
            onLanded={() => records.present(arrivalKey, false)}
            onDone={() => done.current()}
          >
            <SheetCover arrival={arrival} look={look} className="size-full" />
          </CoverFlight>,
          document.body,
        )}
    </>
  );
}

function SheetWords({ arrival }: { arrival: Arrival }) {
  const slowStep = useSlowStep(arrival);
  const stage = arrival.progress.stage;
  const fileTitle = arrival.fileName.replace(/\.epub$/i, "");
  const detail =
    stage === "failed"
      ? "Try again, or choose another file."
      : (slowStep ??
        (arrival.chapters
          ? `${arrival.chapters} chapter${arrival.chapters === 1 ? "" : "s"}`
          : null));
  return (
    <div className="min-w-0 flex-1 pb-1">
      <h2
        className={cn(
          "line-clamp-4 font-serif text-[22px] leading-[1.15] text-balance",
          arrival.title === null && "text-muted-foreground",
        )}
      >
        {arrival.title ?? fileTitle}
      </h2>
      <p className="mt-1.5 line-clamp-2 min-h-[1lh] text-[14px] text-muted-foreground">
        {arrival.author ?? " "}
      </p>
      <p className="mt-3 min-h-[1lh] text-[12px] text-muted-foreground tabular-nums">
        {detail ?? " "}
      </p>
    </div>
  );
}

/** The arriving cover, in ink, then the cover itself. */
function SheetCover({
  arrival,
  look,
  className,
}: {
  arrival: Arrival;
  look: ArrivalLook;
  className?: string;
}) {
  const url = useCoverUrl(arrival.cover);
  const decoded = useDecoded(url);
  const plain: ReactNode = url ? (
    <img
      src={url}
      alt=""
      draggable={false}
      className="size-full object-cover select-none"
    />
  ) : (
    <TypeCover
      title={arrival.title ?? ""}
      author={arrival.author ?? ""}
      className="size-full"
    />
  );
  return (
    <ArrivingCover
      arrival={arrival}
      look={look}
      plain={plain}
      plainReady={url ? decoded : true}
      // The grid settles the book once it holds it again.
      onSettled={() => {}}
      className={className}
    />
  );
}

/** The copy already in the library. */
function ExistingCover({
  arrival,
  coverUrlFor,
}: {
  arrival: Arrival;
  coverUrlFor?: (bookId: string) => string | undefined;
}) {
  const given = arrival.existingBookId
    ? coverUrlFor?.(arrival.existingBookId)
    : undefined;
  const { url: stored } = useFileUrl(arrival.existingCover ?? undefined, {
    skip: given !== undefined || !arrival.existingCover,
  });
  const url = given ?? stored;
  return url ? (
    <img
      src={url}
      alt=""
      draggable={false}
      className="size-full object-cover select-none"
    />
  ) : (
    <TypeCover
      title={arrival.title ?? ""}
      author={arrival.author ?? ""}
      className="size-full"
    />
  );
}

/**
 * The cover on its way from the sheet to the grid: placed where it lands
 * and moved there by its transform alone, so the compositor carries it.
 * It fades once the place below it has painted the book.
 */
function CoverFlight({
  arrivalKey,
  flight,
  onLanded,
  onDone,
  children,
}: {
  arrivalKey: string;
  flight: Flight;
  onLanded: () => void;
  onDone: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const landed = useRef(onLanded);
  landed.current = onLanded;
  const finished = useRef(onDone);
  finished.current = onDone;
  const { from, to } = flight;

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const scale = from.width / to.width;
    const move = element.animate(
      [
        {
          transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${scale})`,
        },
        { transform: "none" },
      ],
      FLIGHT,
    );
    let cancelled = false;
    void move.finished
      .then(() => {
        if (cancelled) return;
        landed.current();
        return gridPainted(arrivalKey, () => cancelled);
      })
      .then(() => {
        if (cancelled) return;
        return element.animate([{ opacity: 1 }, { opacity: 0 }], {
          duration: 160,
          fill: "forwards",
        }).finished;
      })
      .then(() => {
        if (!cancelled) finished.current();
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      move.cancel();
    };
  }, [arrivalKey, from, to]);

  return (
    <div
      ref={ref}
      aria-hidden="true"
      data-arrival-flight=""
      className={cn(
        "pointer-events-none fixed z-[60] overflow-hidden rounded-[3px] bg-secondary",
        COVER_SHADOW,
      )}
      style={{
        left: to.left,
        top: to.top,
        width: to.width,
        height: to.height,
        transformOrigin: "0 0",
      }}
    >
      {children}
    </div>
  );
}
