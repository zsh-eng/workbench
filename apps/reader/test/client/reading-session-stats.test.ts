import {
  buildReadingSessionsOverview,
  formatReadingDuration,
  getTotalRecordedReadingTime,
  getRecordedReadingTimeSummary,
  type ReadingSessionAnalyticsRecord,
  type ReadingSessionBookRecord,
} from "@/lib/reading-session-stats";
import { describe, expect, it } from "vitest";

const HOUR = 60 * 60 * 1000;
const NOW = new Date(2026, 7, 16, 12).getTime();
const books: ReadingSessionBookRecord[] = [
  { id: "book-a", title: "Book A", author: "Author A" },
  { id: "book-b", title: "Book B", author: "Author B" },
];

function session(
  id: string,
  bookId: string,
  daysAgo: number,
  activeMs: number,
): ReadingSessionAnalyticsRecord {
  return {
    id,
    bookId,
    startedAt: new Date(2026, 7, 16 - daysAgo, 9).getTime(),
    activeMs,
  };
}

describe("buildReadingSessionsOverview", () => {
  it("aggregates a rolling month without exposing session source details", () => {
    const overview = buildReadingSessionsOverview({
      sessions: [
        session("recent-a", "book-a", 2, HOUR),
        session("recent-b", "book-b", 8, HOUR / 2),
        session("old", "book-b", 45, HOUR * 2),
        session("empty", "book-a", 1, 0),
      ],
      books,
      range: { kind: "rolling", days: 30 },
      now: NOW,
    });

    expect(overview.totalActiveMs).toBe(HOUR * 1.5);
    expect(overview.sessionCount).toBe(2);
    expect(overview.bookCount).toBe(2);
    expect(overview.activeDays).toBe(2);
    expect(overview.averageSessionMs).toBe(HOUR * 0.75);
    expect(overview.timeBuckets).toHaveLength(30);
    expect(
      overview.timeBuckets.reduce((sum, item) => sum + item.activeMs, 0),
    ).toBe(HOUR * 1.5);
  });

  it("orders books by reading time and sessions by recency", () => {
    const overview = buildReadingSessionsOverview({
      sessions: [
        session("older-a", "book-a", 5, HOUR),
        session("newer-b", "book-b", 1, HOUR * 2),
        session("newest-a", "book-a", 0, HOUR * 2),
      ],
      books,
      range: { kind: "rolling", days: 7 },
      now: NOW,
    });

    expect(overview.bookSummaries.map((book) => book.bookId)).toEqual([
      "book-a",
      "book-b",
    ]);
    expect(overview.bookSummaries[0]).toMatchObject({
      activeMs: HOUR * 3,
      sessionCount: 2,
    });
    expect(overview.recentSessions.map((item) => item.id)).toEqual([
      "newest-a",
      "newer-b",
      "older-a",
    ]);
  });

  it("uses yearly buckets for a long all-time history", () => {
    const overview = buildReadingSessionsOverview({
      sessions: [
        {
          id: "old",
          bookId: "book-a",
          startedAt: new Date(2023, 1, 4, 9).getTime(),
          activeMs: HOUR,
        },
        session("new", "book-b", 0, HOUR),
      ],
      books,
      range: { kind: "all" },
      now: NOW,
    });

    expect(overview.timeBuckets.map((bucket) => bucket.shortLabel)).toEqual([
      "2023",
      "2024",
      "2025",
      "2026",
    ]);
    expect(overview.totalActiveMs).toBe(HOUR * 2);
  });

  it("filters a calendar month without including the rolling month", () => {
    const overview = buildReadingSessionsOverview({
      sessions: [
        {
          id: "july",
          bookId: "book-a",
          startedAt: new Date(2026, 6, 15, 9).getTime(),
          activeMs: HOUR,
        },
        session("august", "book-b", 1, HOUR * 2),
      ],
      books,
      range: { kind: "calendar-month", year: 2026, month: 6 },
      now: NOW,
    });

    expect(overview.totalActiveMs).toBe(HOUR);
    expect(overview.timeBuckets).toHaveLength(31);
    expect(overview.bookSummaries.map((book) => book.bookId)).toEqual([
      "book-a",
    ]);
  });

  it("filters a calendar year and keeps visits under five minutes out of recent reading", () => {
    const overview = buildReadingSessionsOverview({
      sessions: [
        {
          id: "last-year",
          bookId: "book-a",
          startedAt: new Date(2025, 4, 15, 9).getTime(),
          activeMs: HOUR,
        },
        {
          id: "short-last-year",
          bookId: "book-b",
          startedAt: new Date(2025, 6, 15, 9).getTime(),
          activeMs: 4 * 60 * 1000,
        },
        session("this-year", "book-b", 1, HOUR * 2),
      ],
      books,
      range: { kind: "calendar-year", year: 2025 },
      now: NOW,
    });

    expect(overview.sessionCount).toBe(2);
    expect(overview.timeBuckets).toHaveLength(12);
    expect(overview.recentSessions.map((item) => item.id)).toEqual([
      "last-year",
    ]);
  });

  it("counts a five-minute visit as recent reading", () => {
    const overview = buildReadingSessionsOverview({
      sessions: [session("five-minutes", "book-a", 0, 5 * 60 * 1000)],
      books,
      range: { kind: "rolling", days: 7 },
      now: NOW,
    });

    expect(overview.recentSessions.map((item) => item.id)).toEqual([
      "five-minutes",
    ]);
  });
});

describe("getTotalRecordedReadingTime", () => {
  it("counts active time across periods and ignores invalid future records", () => {
    expect(
      getTotalRecordedReadingTime(
        [
          session("recent", "book-a", 1, HOUR),
          session("older", "book-b", 120, HOUR * 2),
          session("empty", "book-a", 0, 0),
          {
            id: "future",
            bookId: "book-a",
            startedAt: new Date(2026, 7, 17, 9).getTime(),
            activeMs: HOUR * 4,
          },
        ],
        NOW,
      ),
    ).toBe(HOUR * 3);
  });
});

describe("reading session formatting", () => {
  it("uses readable minute and hour labels", () => {
    expect(formatReadingDuration(0)).toBe("0 min");
    expect(formatReadingDuration(35_000)).toBe("1 min");
    expect(formatReadingDuration(HOUR)).toBe("1 hr");
    expect(formatReadingDuration(HOUR + 25 * 60_000)).toBe("1 hr 25 min");
  });
});

describe("getRecordedReadingTimeSummary", () => {
  it("separates the local calendar day from all recorded time", () => {
    const today = new Date(2026, 7, 16).getTime();
    const record = (startedAt: number, activeMs: number) => ({
      id: String(startedAt),
      bookId: "book-a",
      startedAt,
      activeMs,
    });
    expect(
      getRecordedReadingTimeSummary(
        [
          record(today - 1, HOUR),
          record(today, HOUR / 2),
          record(NOW, HOUR / 4),
          record(NOW + 1, HOUR),
          record(today + 1, 0),
          record(today + 2, -HOUR),
        ],
        NOW,
      ),
    ).toEqual({ todayMs: HOUR * 0.75, totalMs: HOUR * 1.75 });
  });

  it("resets today's summary when the local day changes", () => {
    const records = [session("today", "book-a", 0, HOUR)];
    expect(getRecordedReadingTimeSummary(records, NOW)).toEqual({
      todayMs: HOUR,
      totalMs: HOUR,
    });
    expect(
      getRecordedReadingTimeSummary(records, new Date(2026, 7, 17).getTime()),
    ).toEqual({ todayMs: 0, totalMs: HOUR });
    expect(getRecordedReadingTimeSummary([], NOW)).toEqual({
      todayMs: 0,
      totalMs: 0,
    });
  });
});
