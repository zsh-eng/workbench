import { summarizeTime } from "@workbench/activity-time";
import {
  differenceInCalendarMonths,
  eachDayOfInterval,
  eachMonthOfInterval,
  eachYearOfInterval,
  endOfMonth,
  endOfYear,
  format,
  startOfDay,
  startOfMonth,
  startOfYear,
  subDays,
} from "date-fns";

export type ReadingSessionRange =
  | { kind: "rolling"; days: 7 | 30 | 365 }
  | { kind: "calendar-month"; year: number; month: number }
  | { kind: "calendar-year"; year: number }
  | { kind: "all" };

export const DEFAULT_READING_SESSION_RANGE: ReadingSessionRange = {
  kind: "rolling",
  days: 30,
};

export const MIN_MEANINGFUL_READING_MS = 5 * 60 * 1000;

export interface ReadingSessionAnalyticsRecord {
  id: string;
  bookId: string;
  startedAt: number;
  activeMs: number;
}

export interface ReadingSessionBookRecord {
  id: string;
  title: string;
  author: string;
}

export interface ReadingTimeBucket {
  key: string;
  label: string;
  shortLabel: string;
  activeMs: number;
}

export interface ReadingBookSummary {
  bookId: string;
  title: string;
  author: string;
  activeMs: number;
  sessionCount: number;
  lastReadAt: number;
}

export interface RecentReadingSession {
  id: string;
  bookId: string;
  bookTitle: string;
  startedAt: number;
  activeMs: number;
}

export interface ReadingSessionsOverview {
  totalActiveMs: number;
  sessionCount: number;
  bookCount: number;
  activeDays: number;
  averageSessionMs: number;
  timeBuckets: ReadingTimeBucket[];
  bookSummaries: ReadingBookSummary[];
  recentSessions: RecentReadingSession[];
}

type BucketGranularity = "day" | "month" | "year";

interface BucketDefinition {
  date: Date;
  granularity: BucketGranularity;
  label: string;
  shortLabel: string;
}

interface DateRange {
  start: Date;
  end: Date;
}

function getBucketKey(date: Date, granularity: BucketGranularity): string {
  if (granularity === "day") return format(date, "yyyy-MM-dd");
  if (granularity === "month") return format(date, "yyyy-MM");
  return format(date, "yyyy");
}

function getAllTimeStart(
  now: Date,
  sessions: readonly ReadingSessionAnalyticsRecord[],
): Date {
  const earliestSession = sessions.reduce<number | null>(
    (earliest, session) => {
      if (session.activeMs <= 0 || session.startedAt > now.getTime()) {
        return earliest;
      }
      if (earliest === null) return session.startedAt;
      return Math.min(earliest, session.startedAt);
    },
    null,
  );

  return earliestSession === null
    ? startOfMonth(now)
    : startOfMonth(new Date(earliestSession));
}

function getDateRange(
  range: ReadingSessionRange,
  now: Date,
  sessions: readonly ReadingSessionAnalyticsRecord[],
): DateRange {
  if (range.kind === "rolling") {
    return {
      start: startOfDay(subDays(now, range.days - 1)),
      end: now,
    };
  }

  if (range.kind === "calendar-month") {
    const month = new Date(range.year, range.month, 1);
    return { start: startOfMonth(month), end: endOfMonth(month) };
  }

  if (range.kind === "calendar-year") {
    const year = new Date(range.year, 0, 1);
    return { start: startOfYear(year), end: endOfYear(year) };
  }

  return { start: getAllTimeStart(now, sessions), end: now };
}

function getBucketDefinitions(
  range: ReadingSessionRange,
  start: Date,
  end: Date,
): BucketDefinition[] {
  if (
    (range.kind === "rolling" && range.days !== 365) ||
    range.kind === "calendar-month"
  ) {
    return eachDayOfInterval({ start, end }).map((date) => ({
      date,
      granularity: "day",
      label: format(date, "EEEE, d MMMM"),
      shortLabel:
        range.kind === "rolling" && range.days === 7
          ? format(date, "EEE")
          : format(date, "d"),
    }));
  }

  const monthCount = differenceInCalendarMonths(startOfMonth(end), start) + 1;
  const useYears = range.kind === "all" && monthCount > 18;
  if (useYears) {
    return eachYearOfInterval({
      start: startOfYear(start),
      end,
    }).map((date) => ({
      date,
      granularity: "year",
      label: format(date, "yyyy"),
      shortLabel: format(date, "yyyy"),
    }));
  }

  return eachMonthOfInterval({ start, end }).map((date) => ({
    date,
    granularity: "month",
    label: format(date, "MMMM yyyy"),
    shortLabel:
      range.kind === "all" ? format(date, "MMM yy") : format(date, "MMM"),
  }));
}

export function formatReadingSessionRange(range: ReadingSessionRange): string {
  if (range.kind === "rolling") return `Last ${range.days} days`;
  if (range.kind === "calendar-month") {
    return format(new Date(range.year, range.month, 1), "MMM");
  }
  if (range.kind === "calendar-year") return String(range.year);
  return "All recorded time";
}

/** Reader rows as the shared stats read them: time on a book. */
function asBookTime<T extends ReadingSessionAnalyticsRecord>(
  sessions: readonly T[],
) {
  return sessions.map((session) => ({
    ...session,
    subject: { kind: "book", id: session.bookId },
  }));
}

export function getTotalRecordedReadingTime(
  sessions: readonly ReadingSessionAnalyticsRecord[],
  now = Date.now(),
): number {
  return summarizeTime(asBookTime(sessions), { to: now }).activeMs;
}

/** Uses the same session-start day assignment as the Sessions page. */
export function getRecordedReadingTimeSummary(
  sessions: readonly ReadingSessionAnalyticsRecord[],
  now = Date.now(),
): { todayMs: number; totalMs: number } {
  const todayStart = startOfDay(now).getTime();
  return {
    todayMs: getTotalRecordedReadingTime(
      sessions.filter((session) => session.startedAt >= todayStart),
      now,
    ),
    totalMs: getTotalRecordedReadingTime(sessions, now),
  };
}

/**
 * Builds the product-facing reading summary from session records. Reading time
 * is assigned to the session start bucket because sessions store accumulated
 * active time, not a timestamp for every active interval. The totals follow
 * the shared rules of `summarizeTime` (`packages/activity-time`).
 */
export function buildReadingSessionsOverview({
  sessions,
  books,
  range,
  now = Date.now(),
}: {
  sessions: readonly ReadingSessionAnalyticsRecord[];
  books: readonly ReadingSessionBookRecord[];
  range: ReadingSessionRange;
  now?: number;
}): ReadingSessionsOverview {
  const nowDate = new Date(now);
  const dateRange = getDateRange(range, nowDate, sessions);
  const booksById = new Map(books.map((book) => [book.id, book]));
  const bucketDefinitions = getBucketDefinitions(
    range,
    dateRange.start,
    dateRange.end,
  );
  const granularity = bucketDefinitions[0]?.granularity ?? "month";
  const summary = summarizeTime(asBookTime(sessions), {
    from: dateRange.start.getTime(),
    to: Math.min(dateRange.end.getTime(), now),
    bucket: (startedAt) => getBucketKey(new Date(startedAt), granularity),
  });
  const totalActiveMs = summary.activeMs;
  const sessionCount = summary.sessions.length;

  return {
    totalActiveMs,
    sessionCount,
    bookCount: summary.subjects.length,
    activeDays: summary.days,
    averageSessionMs: sessionCount === 0 ? 0 : totalActiveMs / sessionCount,
    timeBuckets: bucketDefinitions.map((bucket) => {
      const key = getBucketKey(bucket.date, bucket.granularity);
      return {
        key,
        label: bucket.label,
        shortLabel: bucket.shortLabel,
        activeMs: summary.buckets.get(key) ?? 0,
      };
    }),
    bookSummaries: summary.subjects.map((total) => {
      const book = booksById.get(total.subject.id);
      return {
        bookId: total.subject.id,
        title: book?.title ?? "Unavailable book",
        author: book?.author ?? "",
        activeMs: total.activeMs,
        sessionCount: total.sessions,
        lastReadAt: total.lastStartedAt,
      };
    }),
    recentSessions: summary.sessions
      .filter((session) => session.activeMs >= MIN_MEANINGFUL_READING_MS)
      .slice(0, 6)
      .map((session) => ({
        id: session.id,
        bookId: session.bookId,
        bookTitle: booksById.get(session.bookId)?.title ?? "Unavailable book",
        startedAt: session.startedAt,
        activeMs: session.activeMs,
      })),
  };
}

export function formatReadingDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return "0 min";

  const totalMinutes = Math.max(1, Math.round(milliseconds / 60_000));
  if (totalMinutes < 60) return `${totalMinutes} min`;

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (minutes === 0) return `${hours} hr`;
  return `${hours} hr ${minutes} min`;
}
