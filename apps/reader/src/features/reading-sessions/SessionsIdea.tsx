import { AppHeader } from "@/components/AppNavigation";
import { APP_PAGE_FRAME } from "@/components/app-header-styles";
import { Button } from "@/components/ui/button";
import {
  BookCover,
  Hairline,
  useCoverRequest,
} from "@/features/library/LibraryBooks";
import { useLibraryCoverUrls } from "@/hooks/use-library-cover-urls";
import { useReadingSessionsQuery } from "@/hooks/use-reading-sessions-query";
import type { Book } from "@/lib/db";
import { beginReaderTrace } from "@/lib/reader-performance-trace";
import {
  buildReadingSessionsOverview,
  DEFAULT_READING_SESSION_RANGE,
  formatReadingDuration,
  MIN_MEANINGFUL_READING_MS,
  type ReadingSessionRange,
  type ReadingTimeBucket,
} from "@/lib/reading-session-stats";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  getMonthOptions,
  getRangeKey,
  getYearOptions,
  type RangeOption,
  type ReadingSessionScale,
} from "./ReadingSessions";

/**
 * An idea for the Sessions page, in the Library's frame and type: the
 * period as text, the totals set large, a quiet chart, then the books and
 * the latest visits. No cards; hairlines and type carry the structure.
 */

const SCALES: { value: ReadingSessionScale; label: string }[] = [
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "year", label: "Year" },
  { value: "all", label: "All" },
];

const INITIAL_RANGES: Record<ReadingSessionScale, ReadingSessionRange> = {
  week: { kind: "rolling", days: 7 },
  month: DEFAULT_READING_SESSION_RANGE,
  year: { kind: "rolling", days: 365 },
  all: { kind: "all" },
};

function rangeLabel(range: ReadingSessionRange): string {
  if (range.kind === "rolling") return `Last ${range.days} days`;
  if (range.kind === "calendar-month")
    return format(new Date(range.year, range.month, 1), "MMMM yyyy");
  if (range.kind === "calendar-year") return String(range.year);
  return "Since your first session";
}

function dayLabel(timestamp: number, now: number): string {
  const startOfDay = (value: number) => {
    const date = new Date(value);
    return new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
    ).getTime();
  };
  const days = Math.round(
    (startOfDay(now) - startOfDay(timestamp)) / 86_400_000,
  );
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return format(timestamp, "EEEE");
  return format(
    timestamp,
    new Date(timestamp).getFullYear() === new Date(now).getFullYear()
      ? "d MMMM"
      : "d MMMM yyyy",
  );
}

export function SessionsIdea() {
  const navigate = useNavigate();
  const query = useReadingSessionsQuery();
  const [now] = useState(() => new Date());
  const [scale, setScale] = useState<ReadingSessionScale>("month");
  const [ranges, setRanges] = useState(INITIAL_RANGES);
  const range = ranges[scale];
  const sessions = query.data?.sessions;
  const books = query.data?.books;

  const options: RangeOption[] = useMemo(() => {
    if (scale === "month") return getMonthOptions(now);
    if (scale === "year") return getYearOptions(sessions ?? [], now);
    return [{ label: rangeLabel(range), range }];
  }, [now, range, scale, sessions]);
  const index = options.findIndex(
    (option) => getRangeKey(option.range) === getRangeKey(range),
  );
  const step = (by: number) => {
    const next = options[index + by];
    if (next) setRanges((current) => ({ ...current, [scale]: next.range }));
  };

  const overview = useMemo(
    () =>
      buildReadingSessionsOverview({
        sessions: sessions ?? [],
        books: books ?? [],
        range,
        now: now.getTime(),
      }),
    [books, now, range, sessions],
  );
  const booksById = useMemo(
    () => new Map((books ?? []).map((book) => [book.id, book])),
    [books],
  );
  const summaryBooks = useMemo(
    () =>
      overview.bookSummaries
        .map((summary) => booksById.get(summary.bookId))
        .filter((book) => book !== undefined),
    [booksById, overview.bookSummaries],
  );
  const { coverUrls, requestCover } = useLibraryCoverUrls(summaryBooks);

  // Visits of five minutes or more, newest first, by day.
  const visits = useMemo(() => {
    const days: {
      label: string;
      visits: {
        id: string;
        book: Book | undefined;
        startedAt: number;
        activeMs: number;
      }[];
    }[] = [];
    const visible = buildVisibleSessions(sessions ?? [], range, now.getTime());
    for (const session of visible.slice(0, 14)) {
      const label = dayLabel(session.startedAt, now.getTime());
      const visit = {
        id: session.id,
        book: booksById.get(session.bookId),
        startedAt: session.startedAt,
        activeMs: session.activeMs,
      };
      const day = days.at(-1);
      if (day?.label === label) day.visits.push(visit);
      else days.push({ label, visits: [visit] });
    }
    return days;
  }, [booksById, now, range, sessions]);

  const recorded = useMemo(
    () =>
      (sessions ?? []).some(
        (session) => session.activeMs >= MIN_MEANINGFUL_READING_MS,
      ),
    [sessions],
  );
  const maxBookMs = overview.bookSummaries[0]?.activeMs ?? 0;
  const openBook = (book: Book) => {
    beginReaderTrace({
      bookId: book.id,
      bookTitle: book.title,
      source: "library",
    });
    navigate(`/reader/${book.id}`);
  };

  return (
    <div className="min-h-full bg-background">
      <h1 className="sr-only">Sessions</h1>
      <AppHeader current="sessions" className="pb-3" />
      <div className={cn(APP_PAGE_FRAME, "pb-24")}>
        {query.data && !recorded && (
          <div className="py-24 text-center md:py-32">
            <p className="font-serif text-[26px] leading-tight md:text-[34px]">
              No reading yet
            </p>
            <p className="mx-auto mt-3 max-w-sm text-[14px] text-muted-foreground">
              Time you spend in a book gathers here: how long, how often, and
              with which books.
            </p>
            <Button className="mt-6" render={<Link to="/" />}>
              Open the Library
            </Button>
          </div>
        )}

        {query.data && recorded && (
          <>
            <div className="mt-5 flex items-center justify-between gap-3 md:mt-8">
              <div
                role="group"
                aria-label="Period"
                className="flex items-center gap-3 md:gap-4"
              >
                {SCALES.map((option) => {
                  const active = option.value === scale;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setScale(option.value)}
                      className={cn(
                        "shrink-0 rounded-sm py-2 text-[13px] whitespace-nowrap outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring",
                        active
                          ? "font-medium text-foreground"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {options.length > 1 && (
                  <button
                    type="button"
                    aria-label="Earlier"
                    disabled={index >= options.length - 1}
                    onClick={() => step(1)}
                    className="grid size-8 place-items-center rounded-full text-muted-foreground outline-none transition-colors duration-150 hover:bg-foreground/[0.05] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-30"
                  >
                    <ChevronLeft className="size-4" strokeWidth={1.7} />
                  </button>
                )}
                <span
                  aria-live="polite"
                  className="min-w-0 text-center text-[13px] text-foreground tabular-nums md:min-w-[8.5rem]"
                >
                  {rangeLabel(range)}
                </span>
                {options.length > 1 && (
                  <button
                    type="button"
                    aria-label="Later"
                    disabled={index <= 0}
                    onClick={() => step(-1)}
                    className="grid size-8 place-items-center rounded-full text-muted-foreground outline-none transition-colors duration-150 hover:bg-foreground/[0.05] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-30"
                  >
                    <ChevronRight className="size-4" strokeWidth={1.7} />
                  </button>
                )}
              </div>
            </div>

            <dl className="mt-8 grid grid-cols-2 gap-x-6 gap-y-7 md:mt-12 md:grid-cols-4">
              <Total
                label="Reading time"
                value={formatReadingDuration(overview.totalActiveMs)}
              />
              <Total
                label={overview.activeDays === 1 ? "Day read" : "Days read"}
                value={String(overview.activeDays)}
              />
              <Total
                label="Typical visit"
                value={formatReadingDuration(overview.averageSessionMs)}
              />
              <Total
                label={overview.bookCount === 1 ? "Book" : "Books"}
                value={String(overview.bookCount)}
              />
            </dl>

            <TimeChart buckets={overview.timeBuckets} />

            {overview.sessionCount === 0 ? (
              <p className="py-16 text-center text-[14px] text-muted-foreground">
                No reading in this period.
              </p>
            ) : (
              <div className="mt-12 grid grid-cols-[minmax(0,1fr)] gap-x-16 gap-y-12 md:mt-16 md:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
                <section aria-labelledby="sessions-books">
                  <h2
                    id="sessions-books"
                    className="font-serif text-[19px] leading-tight"
                  >
                    Books
                  </h2>
                  <ol className="mt-4">
                    {overview.bookSummaries.map((summary) => {
                      const book = booksById.get(summary.bookId);
                      return (
                        <BookTime
                          key={summary.bookId}
                          book={book}
                          title={summary.title}
                          author={summary.author}
                          activeMs={summary.activeMs}
                          share={maxBookMs ? summary.activeMs / maxBookMs : 0}
                          visits={summary.sessionCount}
                          coverUrl={book ? coverUrls.get(book.id) : undefined}
                          onCoverRequest={requestCover}
                          onOpen={book ? () => openBook(book) : undefined}
                        />
                      );
                    })}
                  </ol>
                </section>
                <section aria-labelledby="sessions-recent">
                  <h2
                    id="sessions-recent"
                    className="font-serif text-[19px] leading-tight"
                  >
                    Recent
                  </h2>
                  {visits.map((day) => (
                    <div key={day.label} className="mt-4">
                      <h3 className="text-[12px] text-muted-foreground">
                        {day.label}
                      </h3>
                      <ol className="mt-1">
                        {day.visits.map((visit) => (
                          <li
                            key={visit.id}
                            className="flex items-baseline justify-between gap-4 border-b border-border/50 py-2.5 last:border-b-0"
                          >
                            <span className="min-w-0 truncate text-[14px]">
                              {visit.book?.title ?? "Unavailable book"}
                            </span>
                            <span className="shrink-0 font-numeric text-[12px] text-muted-foreground tabular-nums">
                              {format(visit.startedAt, "p")} ·{" "}
                              {formatReadingDuration(visit.activeMs)}
                            </span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  ))}
                </section>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function buildVisibleSessions(
  sessions: readonly {
    id: string;
    bookId: string;
    startedAt: number;
    activeMs: number;
  }[],
  range: ReadingSessionRange,
  now: number,
) {
  // The overview already applies the range; it keeps only six recent
  // visits, so the same window is applied here for a longer list.
  const start =
    range.kind === "rolling"
      ? now - range.days * 86_400_000
      : range.kind === "calendar-month"
        ? new Date(range.year, range.month, 1).getTime()
        : range.kind === "calendar-year"
          ? new Date(range.year, 0, 1).getTime()
          : 0;
  const end =
    range.kind === "calendar-month"
      ? new Date(range.year, range.month + 1, 1).getTime()
      : range.kind === "calendar-year"
        ? new Date(range.year + 1, 0, 1).getTime()
        : now;
  return sessions
    .filter(
      (session) =>
        session.activeMs >= MIN_MEANINGFUL_READING_MS &&
        session.startedAt >= start &&
        session.startedAt < Math.min(end, now + 1),
    )
    .sort((a, b) => b.startedAt - a.startedAt);
}

function Total({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col-reverse gap-2">
      <dt className="text-[12px] text-muted-foreground">{label}</dt>
      <dd className="font-serif text-[30px] leading-none tracking-[-0.01em] tabular-nums md:text-[40px]">
        {value}
      </dd>
    </div>
  );
}

/** Bars in the text colour, quiet until you point at one. */
function TimeChart({ buckets }: { buckets: ReadingTimeBucket[] }) {
  const max = Math.max(...buckets.map((bucket) => bucket.activeMs), 1);
  const labelEvery = buckets.length > 14 ? Math.ceil(buckets.length / 6) : 1;
  return (
    <div className="mt-10 md:mt-14" aria-label="Reading time by period">
      <ol
        className="grid h-36 items-end gap-[3px] border-b border-border md:h-44 md:gap-1"
        style={{
          gridTemplateColumns: `repeat(${buckets.length}, minmax(0, 1fr))`,
        }}
      >
        {buckets.map((bucket) => (
          <li key={bucket.key} className="group relative flex h-full items-end">
            {bucket.activeMs > 0 && (
              <span
                tabIndex={0}
                role="img"
                aria-label={`${bucket.label}: ${formatReadingDuration(bucket.activeMs)}`}
                className="block w-full rounded-t-[2px] bg-foreground/[0.16] outline-none transition-colors duration-150 group-hover:bg-foreground/70 focus-visible:bg-foreground/70"
                style={{
                  height: `${Math.max(2, (bucket.activeMs / max) * 100)}%`,
                }}
              />
            )}
            {bucket.activeMs > 0 && (
              <span className="pointer-events-none absolute bottom-[calc(100%+6px)] left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-[11px] text-background group-focus-within:block group-hover:block">
                {bucket.label} · {formatReadingDuration(bucket.activeMs)}
              </span>
            )}
          </li>
        ))}
      </ol>
      <ol
        aria-hidden="true"
        className="mt-2 grid gap-[3px] md:gap-1"
        style={{
          gridTemplateColumns: `repeat(${buckets.length}, minmax(0, 1fr))`,
        }}
      >
        {buckets.map((bucket, index) => (
          <li
            key={bucket.key}
            className="overflow-visible text-[11px] whitespace-nowrap text-muted-foreground"
          >
            {index % labelEvery === 0 ? bucket.shortLabel : ""}
          </li>
        ))}
      </ol>
    </div>
  );
}

function BookTime({
  book,
  title,
  author,
  activeMs,
  share,
  visits,
  coverUrl,
  onCoverRequest,
  onOpen,
}: {
  book: Book | undefined;
  title: string;
  author: string;
  activeMs: number;
  share: number;
  visits: number;
  coverUrl: string | undefined;
  onCoverRequest: (book: Book) => void;
  onOpen?: () => void;
}) {
  const [element, setElement] = useState<HTMLElement | null>(null);
  useCoverRequest(element, book ?? PLACEHOLDER_BOOK, coverUrl, onCoverRequest);
  return (
    <li ref={setElement}>
      <button
        type="button"
        disabled={!onOpen}
        onClick={onOpen}
        aria-label={`Open ${title}`}
        className="group -mx-3 flex w-[calc(100%+1.5rem)] items-center gap-4 rounded-xl px-3 py-2.5 text-left outline-none transition-colors duration-150 hover:bg-foreground/[0.025] focus-visible:ring-2 focus-visible:ring-ring"
      >
        {book ? (
          <BookCover
            book={book}
            coverUrl={coverUrl}
            compact
            className="aspect-[2/3] w-9 shrink-0 rounded-[2px] shadow-[0_1px_2px_rgb(0_0_0/0.1)]"
          />
        ) : (
          <span className="aspect-[2/3] w-9 shrink-0 rounded-[2px] bg-secondary" />
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-4">
            <span className="min-w-0 truncate text-[14px]">{title}</span>
            <span className="shrink-0 font-numeric text-[12px] text-muted-foreground tabular-nums">
              {formatReadingDuration(activeMs)}
            </span>
          </span>
          <span className="mt-0.5 flex items-baseline justify-between gap-4 text-[12px] text-muted-foreground">
            <span className="min-w-0 truncate">{author}</span>
            <span className="shrink-0 tabular-nums">
              {visits} {visits === 1 ? "visit" : "visits"}
            </span>
          </span>
          <Hairline value={share} className="mt-2" />
        </span>
      </button>
    </li>
  );
}

/** Covers load only for books that still exist. */
const PLACEHOLDER_BOOK = { id: "", cover: undefined } as unknown as Book;
