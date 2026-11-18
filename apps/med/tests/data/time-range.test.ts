import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  endsNow,
  momentText,
  parseMoment,
  parseRange,
  rangeLabel,
  rangePreview,
  shiftRange,
  zoomOutRange,
} from "../../src/shared/time-range";

// Wednesday, Nov 18 2026, 15:20, in the zone the tests run in.
const now = new Date(2026, 10, 18, 15, 20).getTime();
const at = (month: number, day: number, hours = 0, minutes = 0, year = 2026) =>
  String(new Date(year, month - 1, day, hours, minutes).getTime());
const dayEnd = (month: number, day: number) =>
  String(new Date(2026, month - 1, day + 1).getTime() - 1);
const range = (text: string) => {
  const read = parseRange(text, now);
  return "range" in read ? read.range : read.error;
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
});
afterEach(() => vi.useRealTimers());

test("a span that ends now stays relative, however a person writes it", () => {
  for (const text of ["6h", "6 hours", "last 6 hours", "past 6 hours", "Last 6 hours", "now-6h"])
    expect(range(text)).toEqual({ from: "now-6h", to: "now" });
  expect(range("90 days")).toEqual({ from: "now-90d", to: "now" });
  expect(range("3mo")).toEqual({ from: "now-3M", to: "now" });
  expect(range("past week")).toEqual({ from: "now-7d", to: "now" });
  expect(range("now-7d to now-1d")).toEqual({ from: "now-7d", to: "now-1d" });
});

test("calendar words are Grafana's rounded ranges, so a link to yesterday means yesterday", () => {
  expect(range("yesterday")).toEqual({ from: "now-1d/d", to: "now-1d/d" });
  expect(range("today")).toEqual({ from: "now/d", to: "now/d" });
  expect(range("last week")).toEqual({ from: "now-1w/w", to: "now-1w/w" });
  expect(range("this month")).toEqual({ from: "now/M", to: "now/M" });
  expect(range("since yesterday")).toEqual({ from: "now-1d/d", to: "now" });
});

test("days and times are moments: a day's end is its last millisecond, and a bare time borrows the first end's day", () => {
  expect(range("since 9:00")).toEqual({ from: at(11, 18, 9), to: "now" });
  // A time that has not come yet today is yesterday's.
  expect(range("since 16:00")).toEqual({ from: at(11, 17, 16), to: "now" });
  expect(range("16:00 to 18:00")).toEqual({ from: at(11, 17, 16), to: at(11, 17, 18) });
  expect(range("yesterday 14:00 to 16:30")).toEqual({
    from: at(11, 17, 14),
    to: at(11, 17, 16, 30),
  });
  expect(range("yesterday 2pm - 4:30pm")).toEqual({ from: at(11, 17, 14), to: at(11, 17, 16, 30) });
  expect(range("Nov 14 to Nov 16")).toEqual({ from: at(11, 14), to: dayEnd(11, 16) });
  expect(range("14 to 16 nov")).toEqual({ from: at(11, 14), to: dayEnd(11, 16) });
  expect(range("monday")).toEqual({ from: at(11, 16), to: dayEnd(11, 16) });
  expect(range("2026-11-14 09:00 to 2026-11-14 17:30")).toEqual({
    from: at(11, 14, 9),
    to: at(11, 14, 17, 30),
  });
  // Without a year, the latest such day: December typed in November is last year's.
  expect(range("Dec 30")).toEqual({
    from: at(12, 30, 0, 0, 2025),
    to: String(new Date(2025, 11, 31).getTime() - 1),
  });
});

test("words that are no range say what Med reads, and a range must run forward", () => {
  expect(range("whenever")).toMatch(/^Med does not read "whenever" as a range/);
  expect(range("Nov 16 to Nov 14")).toBe("The range ends before it starts.");
});

test("a range names itself as the picker's button does, and its preview says the moments", () => {
  expect(rangeLabel({ from: "now-6h", to: "now" }, now)).toBe("Last 6 hours");
  expect(rangeLabel({ from: "now-45m", to: "now" }, now)).toBe("Last 45 minutes");
  expect(rangeLabel({ from: "now-1d/d", to: "now" }, now)).toBe("Since yesterday");
  expect(rangeLabel({ from: at(11, 17, 14), to: at(11, 17, 16, 30) }, now)).toBe(
    "Nov 17, 14:00 – 16:30",
  );
  expect(rangeLabel({ from: at(11, 14), to: dayEnd(11, 16) }, now)).toBe("Nov 14 – Nov 16");
  expect(rangeLabel({ from: at(11, 18, 9), to: "now" }, now)).toBe("Since Nov 18, 09:00");
  expect(rangePreview({ from: at(11, 17, 14), to: at(11, 17, 16, 30) }, now)).toBe(
    "Tue Nov 17, 14:00 → 16:30 · 2 h 30 min",
  );
  expect(rangePreview({ from: "now-6h", to: "now" }, now)).toBe("Wed Nov 18, 09:20 → now · 6 h");
});

test("earlier and later move by half the span, not past now; zoom out doubles it", () => {
  expect(shiftRange({ from: "now-6h", to: "now" }, -1, now)).toEqual({
    from: at(11, 18, 6, 20),
    to: at(11, 18, 12, 20),
  });
  expect(shiftRange({ from: at(11, 18, 6, 20), to: at(11, 18, 12, 20) }, 1, now)).toEqual({
    from: at(11, 18, 9, 20),
    to: at(11, 18, 15, 20),
  });
  expect(endsNow({ from: "now-6h", to: "now" }, now)).toBe(true);
  expect(endsNow({ from: at(11, 17, 14), to: at(11, 17, 16) }, now)).toBe(false);
  expect(zoomOutRange({ from: "now-6h", to: "now" }, now)).toEqual({ from: "now-12h", to: "now" });
  expect(zoomOutRange({ from: at(11, 17, 14), to: at(11, 17, 16) }, now)).toEqual({
    from: at(11, 17, 13),
    to: at(11, 17, 17),
  });
});

test("From and To read and show one end", () => {
  expect(parseMoment("yesterday", false, now)).toBe("now-1d/d");
  expect(parseMoment("Nov 14", true, now)).toBe(dayEnd(11, 14));
  expect(parseMoment("2026-11-14 09:00", false, now)).toBe(at(11, 14, 9));
  expect(parseMoment("soon", false, now)).toBeNull();
  expect(momentText(at(11, 14, 9))).toBe("2026-11-14 09:00");
  expect(momentText("now-6h")).toBe("now-6h");
});
