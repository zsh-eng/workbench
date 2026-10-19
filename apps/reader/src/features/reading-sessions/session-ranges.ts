import {
  DEFAULT_READING_SESSION_RANGE,
  type ReadingSessionAnalyticsRecord,
  type ReadingSessionRange,
} from "@/lib/reading-session-stats";
import { format, subMonths } from "date-fns";

export type ReadingSessionScale = "week" | "month" | "year" | "all";

export interface RangeOption {
  label: string;
  range: ReadingSessionRange;
}

export function getRangeKey(range: ReadingSessionRange): string {
  if (range.kind === "rolling") return `rolling-${range.days}`;
  if (range.kind === "calendar-month") {
    return `month-${range.year}-${range.month}`;
  }
  if (range.kind === "calendar-year") return `year-${range.year}`;
  return "all";
}

export function getMonthOptions(now: Date): RangeOption[] {
  const calendarMonths = Array.from({ length: 12 }, (_, index) => {
    const date = subMonths(now, index);
    return {
      label: format(date, "MMM"),
      range: {
        kind: "calendar-month",
        year: date.getFullYear(),
        month: date.getMonth(),
      } satisfies ReadingSessionRange,
    };
  });

  return [
    { label: "Last 30 days", range: DEFAULT_READING_SESSION_RANGE },
    ...calendarMonths,
  ];
}

export function getYearOptions(
  sessions: readonly ReadingSessionAnalyticsRecord[],
  now: Date,
): RangeOption[] {
  const currentYear = now.getFullYear();
  const earliestRecordedYear = sessions.reduce((earliest, session) => {
    if (session.activeMs <= 0 || session.startedAt > now.getTime()) {
      return earliest;
    }
    return Math.min(earliest, new Date(session.startedAt).getFullYear());
  }, currentYear);
  const oldestVisibleYear = Math.min(currentYear - 1, earliestRecordedYear);
  const calendarYears = Array.from(
    { length: currentYear - oldestVisibleYear + 1 },
    (_, index) => currentYear - index,
  );

  return [
    {
      label: "Last 365 days",
      range: { kind: "rolling", days: 365 },
    },
    ...calendarYears.map((year) => ({
      label: String(year),
      range: { kind: "calendar-year", year } as ReadingSessionRange,
    })),
  ];
}
