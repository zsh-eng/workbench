import { grafanaTime } from "./grafana-time";

// A dashboard's time range, as Grafana keeps one: each end is a time relative
// to now (now-6h, now/d, now-1d/d) or a moment in milliseconds. A relative
// range stays relative, so a link to "Last 6 hours" opens the six hours
// before whenever it opens. The picker's field reads what a person types (6h,
// yesterday, since 9:00, Nov 14 to Nov 16), and so do `med dashboard --range`
// and the agents that call it.

export interface TimeRange {
  from: string;
  to: string;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const UNIT_NAMES: Record<string, string> = {
  s: "second",
  m: "minute",
  h: "hour",
  d: "day",
  w: "week",
  M: "month",
  y: "year",
};

/** The picker's ready ranges, as Grafana lists them. */
export const QUICK_RANGES: readonly (TimeRange & {
  label: string;
  group: "Relative" | "Calendar";
})[] = [
  ...(
    [
      ["now-5m", "Last 5 minutes"],
      ["now-15m", "Last 15 minutes"],
      ["now-30m", "Last 30 minutes"],
      ["now-1h", "Last hour"],
      ["now-3h", "Last 3 hours"],
      ["now-6h", "Last 6 hours"],
      ["now-12h", "Last 12 hours"],
      ["now-24h", "Last 24 hours"],
      ["now-2d", "Last 2 days"],
      ["now-7d", "Last 7 days"],
      ["now-30d", "Last 30 days"],
      ["now-90d", "Last 90 days"],
      ["now-6M", "Last 6 months"],
      ["now-1y", "Last 12 months"],
    ] as const
  ).map(([from, label]) => ({ from, to: "now", label, group: "Relative" as const })),
  ...(
    [
      ["now/d", "now/d", "Today"],
      ["now/d", "now", "Today so far"],
      ["now-1d/d", "now-1d/d", "Yesterday"],
      ["now/w", "now/w", "This week"],
      ["now/w", "now", "This week so far"],
      ["now-1w/w", "now-1w/w", "Previous week"],
      ["now/M", "now/M", "This month"],
      ["now/M", "now", "This month so far"],
      ["now-1M/M", "now-1M/M", "Previous month"],
      ["now/y", "now/y", "This year"],
      ["now/y", "now", "This year so far"],
      ["now-1y/y", "now-1y/y", "Previous year"],
    ] as const
  ).map(([from, to, label]) => ({ from, to, label, group: "Calendar" as const })),
];

const RELATIVE = /^now(?:[+-]\d+[smhdwMy]|\/[smhdwMy])*$/;
export const isRelative = (time: string) => RELATIVE.test(time.trim());
/** A moment, in milliseconds since 1970. */
const isMoment = (time: string) => /^\d{10,}$/.test(time);

/** Both ends in milliseconds; null for a range that is not one. */
export function resolveRange(range: TimeRange, now: number): [number, number] | null {
  const from = grafanaTime(range.from, now);
  const to = grafanaTime(range.to, now, true);
  return from !== null && to !== null && from < to ? [from, to] : null;
}

/** Each end as a chart source reads it in `${from}` and `${to}`: a relative
 * time as written, a moment as an ISO time. */
export const timeValue = (time: string) =>
  isMoment(time) ? new Date(Number(time)).toISOString() : time;

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const pad = (value: number) => String(value).padStart(2, "0");
const clock = (date: Date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;
const dayOf = (date: Date, now: Date) =>
  `${months[date.getMonth()]} ${date.getDate()}${date.getFullYear() !== now.getFullYear() ? `, ${date.getFullYear()}` : ""}`;
const midnight = (date: Date) =>
  date.getHours() === 0 && date.getMinutes() === 0 && date.getSeconds() === 0;
/** The last moment of a day, as a rounded `to` ends: 23:59:59.999. */
const dayEnd = (date: Date) =>
  date.getHours() === 23 && date.getMinutes() === 59 && date.getSeconds() === 59;

/** A span in words: "2 h 30 min", "3 days". */
export function spanWords(span: number) {
  if (span < HOUR) return `${Math.max(1, Math.round(span / MINUTE))} min`;
  if (span < DAY) {
    const hours = Math.floor(span / HOUR);
    const minutes = Math.round((span - hours * HOUR) / MINUTE);
    return minutes ? `${hours} h ${minutes} min` : `${hours} h`;
  }
  const whole = Math.round(span / DAY);
  if (Math.abs(span - whole * DAY) < MINUTE) return `${whole} day${whole === 1 ? "" : "s"}`;
  return `${(span / DAY).toFixed(1)} days`;
}

/** Two moments as a picker's button says them: "Nov 17, 14:00 – 16:30",
 * "Nov 14 – Nov 16" for whole days. */
export function momentsLabel(from: number, to: number, now: number) {
  const start = new Date(from);
  const end = new Date(to);
  const today = new Date(now);
  if (midnight(start) && (dayEnd(end) || midnight(end))) {
    // Whole days: a `to` at midnight ends the day before.
    const last = midnight(end) ? new Date(to - 1) : end;
    return start.toDateString() === last.toDateString()
      ? dayOf(start, today)
      : `${dayOf(start, today)} – ${dayOf(last, today)}`;
  }
  return start.toDateString() === end.toDateString()
    ? `${dayOf(start, today)}, ${clock(start)} – ${clock(end)}`
    : `${dayOf(start, today)}, ${clock(start)} – ${dayOf(end, today)}, ${clock(end)}`;
}

const RELATIVE_WORDS: Record<string, string> = {
  "now/d": "today",
  "now-1d/d": "yesterday",
  "now/w": "this week",
  "now-1w/w": "last week",
  "now/M": "this month",
  "now-1M/M": "last month",
  "now/y": "this year",
};

/** A range in a few words: a ready range's name, "Last 45 minutes", "Since
 * Nov 17, 09:00", or its two moments. */
export function rangeLabel(range: TimeRange, now = Date.now()) {
  const quick = QUICK_RANGES.find((entry) => entry.from === range.from && entry.to === range.to);
  if (quick) return quick.label;
  const last = /^now-(\d+)([smhdwMy])$/.exec(range.from);
  if (last && range.to === "now") {
    const count = Number(last[1]);
    const unit = UNIT_NAMES[last[2]!]!;
    // "Last week" is the week before this one.
    if (count === 1) return "smh".includes(last[2]!) ? `Last ${unit}` : `Last 1 ${unit}`;
    return `Last ${count} ${unit}s`;
  }
  if (range.to === "now" && RELATIVE_WORDS[range.from])
    return `Since ${RELATIVE_WORDS[range.from]}`;
  if (isRelative(range.from) && isRelative(range.to)) return `${range.from} to ${range.to}`;
  const resolved = resolveRange(range, now);
  if (!resolved) return `${range.from} to ${range.to}`;
  if (range.to === "now") {
    const start = new Date(resolved[0]);
    return `Since ${dayOf(start, new Date(now))}${midnight(start) ? "" : `, ${clock(start)}`}`;
  }
  return momentsLabel(resolved[0], resolved[1], now);
}

/** What the range covers now, to read under the field: "Mon Nov 17, 14:00 →
 * 16:30 · 2 h 30 min". */
export function rangePreview(range: TimeRange, now = Date.now()) {
  const resolved = resolveRange(range, now);
  if (!resolved) return "";
  const [from, to] = resolved;
  const start = new Date(from);
  const end = new Date(to);
  const today = new Date(now);
  const day = (date: Date) => `${days[date.getDay()]} ${dayOf(date, today)}`;
  const tail =
    range.to === "now"
      ? "now"
      : start.toDateString() === end.toDateString()
        ? clock(end)
        : `${day(end)}, ${clock(end)}`;
  return `${day(start)}, ${clock(start)} → ${tail} · ${spanWords(to + (dayEnd(end) ? 1 : 0) - from)}`;
}

// What a person types, as moments and spans.

const UNIT_WORDS: [RegExp, string][] = [
  [/^(?:s|secs?|seconds?)$/, "s"],
  [/^(?:m|mins?|minutes?)$/, "m"],
  [/^(?:h|hrs?|hours?)$/, "h"],
  [/^(?:d|days?)$/, "d"],
  [/^(?:w|wks?|weeks?)$/, "w"],
  [/^(?:mo|mos|mons?|months?)$/, "M"],
  [/^(?:y|yrs?|years?)$/, "y"],
];
const unitOf = (word: string) => UNIT_WORDS.find(([pattern]) => pattern.test(word))?.[1];

const MONTH_WORDS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];
const monthOf = (word: string) => {
  const index = MONTH_WORDS.indexOf(word.slice(0, 3));
  return index >= 0 && /^[a-z]+\.?$/.test(word) ? index : -1;
};
const WEEKDAY_WORDS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const weekdayOf = (word: string) => {
  const index = WEEKDAY_WORDS.indexOf(word.slice(0, 3));
  return index >= 0 && /^[a-z]+$/.test(word) && word.length <= 9 ? index : -1;
};

interface Moment {
  /** A relative time, or a moment in milliseconds. */
  at: string;
  /** The day it falls on, at midnight, when it names one. */
  day?: number;
  /** It names a time of day. */
  timed: boolean;
}

/** A time of day: 9:00, 09:30, 9am, 9:30 pm, noon, midnight. Minutes from midnight. */
function clockOf(text: string): number | null {
  if (text === "noon") return 12 * 60;
  if (text === "midnight") return 0;
  const match = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(text);
  if (!match || (!match[2] && !match[3])) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2] ?? 0);
  if (minutes > 59) return null;
  if (match[3]) {
    if (hours < 1 || hours > 12) return null;
    hours = (hours % 12) + (match[3] === "pm" ? 12 : 0);
  } else if (hours > 23) return null;
  return hours * 60 + minutes;
}

const startOfDay = (time: number) => {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};
const addDays = (day: number, count: number) => {
  const date = new Date(day);
  date.setDate(date.getDate() + count);
  return date.getTime();
};

/** A day that the words name: today, yesterday, a weekday, Nov 14, 14 Nov
 * 2026, 2026-11-14. Its midnight, and the relative time for a word. */
function dayOfWords(text: string, now: number): { day: number; relative?: string } | null {
  const today = startOfDay(now);
  if (text === "today") return { day: today, relative: "now/d" };
  if (text === "yesterday") return { day: addDays(today, -1), relative: "now-1d/d" };
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (iso) {
    const date = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return date.getMonth() === Number(iso[2]) - 1 ? { day: date.getTime() } : null;
  }
  const words = text.replace(/,/g, " ").split(/\s+/).filter(Boolean);
  const weekday = words.length <= 2 && weekdayOf(words.at(-1)!);
  if (
    weekday !== false &&
    weekday >= 0 &&
    (words.length === 1 || words[0] === "last" || words[0] === "on")
  ) {
    // The latest such day before today; on that weekday itself, a week ago
    // with "last", else today.
    const back = (new Date(today).getDay() - weekday + 7) % 7;
    return { day: addDays(today, back === 0 && words[0] === "last" ? -7 : -back) };
  }
  let month = -1;
  let date = 0;
  let year: number | undefined;
  for (const word of words) {
    const named = monthOf(word.replace(/\.$/, ""));
    if (named >= 0 && month < 0) month = named;
    else if (/^\d{1,2}(?:st|nd|rd|th)?$/.test(word) && !date) date = parseInt(word, 10);
    else if (/^\d{4}$/.test(word) && year === undefined) year = Number(word);
    else return null;
  }
  if (month < 0 || date < 1 || date > 31) return null;
  const current = new Date(now).getFullYear();
  let found = new Date(year ?? current, month, date);
  // Without a year, the latest such day: Dec 30 typed in January is last year's.
  if (year === undefined && found.getTime() > today + DAY)
    found = new Date(current - 1, month, date);
  return found.getDate() === date ? { day: found.getTime() } : null;
}

/** One end of a range. `end` makes a day its last moment, as a `to`. */
function momentOf(text: string, now: number, end: boolean, borrowDay?: number): Moment | null {
  const raw = text.trim();
  const value = raw.toLowerCase();
  if (!value) return null;
  if (value === "now") return { at: "now", timed: true };
  if (RELATIVE.test(raw)) return grafanaTime(raw, now) === null ? null : { at: raw, timed: true };
  if (/^\d{10,13}$/.test(value)) {
    const ms = Number(value) < 1e11 ? Number(value) * 1000 : Number(value);
    return { at: String(ms), timed: true };
  }
  // An ISO time, with its zone or in the reader's.
  if (/^\d{4}-\d{1,2}-\d{1,2}[ t]\d{1,2}:\d{2}/.test(value)) {
    const parsed = Date.parse(raw.replace(" ", "T"));
    return Number.isNaN(parsed)
      ? null
      : { at: String(parsed), day: startOfDay(parsed), timed: true };
  }
  // A day with a time: "yesterday 14:00", "Nov 14 at 9am", "14:00 yesterday".
  const words = value
    .replace(/\bat\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const split = /^(.*?)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?|noon|midnight)$/.exec(words);
  const before = /^(\d{1,2}(?::\d{2})?\s*(?:am|pm)?|noon|midnight)\s+(.+)$/.exec(words);
  for (const [dayText, clockText] of [
    split ? [split[1]!, split[2]!] : null,
    before ? [before[2]!, before[1]!] : null,
  ].filter((pair): pair is [string, string] => !!pair)) {
    const minutes = clockOf(clockText.trim());
    if (minutes === null) continue;
    let day = dayText ? dayOfWords(dayText, now)?.day : (borrowDay ?? startOfDay(now));
    if (day === undefined) continue;
    const at = new Date(day);
    at.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    // A time alone that has not come yet today is yesterday's: "since 9:00" at 08:30.
    if (!dayText && borrowDay === undefined && at.getTime() > now) {
      at.setDate(at.getDate() - 1);
      day = addDays(day, -1);
    }
    return { at: String(at.getTime()), day, timed: true };
  }
  const day = dayOfWords(words, now);
  if (!day) return null;
  if (day.relative) return { at: day.relative, day: day.day, timed: false };
  return {
    at: String(end ? addDays(day.day, 1) - 1 : day.day),
    day: day.day,
    timed: false,
  };
}

/** "6h", "90 days", "last 6 hours", "past week": a span that ends now. */
function spanOf(text: string): string | null {
  const match = /^(?:(?:last|past|previous)\s+)?(\d+)?\s*([a-z]+)$/i.exec(text.trim());
  if (!match) return null;
  const count = match[1] ? Number(match[1]) : 1;
  // M is months only as Grafana writes it; m is minutes.
  const unit = match[2] === "M" ? "M" : unitOf(match[2]!.toLowerCase());
  if (!unit || count < 1) return null;
  // "Last week" is the week before this one, "past week" the last seven days.
  if (!match[1] && /^last\s/i.test(text) && "wMy".includes(unit)) return null;
  if (!match[1] && !/^(?:last|past|previous)\s/i.test(text)) return null;
  // "Past week" and "past month" are the days before now, as Grafana lists them.
  if (!match[1] && unit === "w") return "now-7d";
  if (!match[1] && unit === "M") return "now-30d";
  return `now-${count}${unit}`;
}

const CALENDAR_WORDS: Record<string, TimeRange> = {
  "last week": { from: "now-1w/w", to: "now-1w/w" },
  "last month": { from: "now-1M/M", to: "now-1M/M" },
  "last year": { from: "now-1y/y", to: "now-1y/y" },
  "this week": { from: "now/w", to: "now/w" },
  "this month": { from: "now/M", to: "now/M" },
  "this year": { from: "now/y", to: "now/y" },
};

/**
 * The range that a person's words name, as ends that stay relative where the
 * words are (yesterday, last 6 hours) and moments where they name a time.
 * Typed in the picker, given to `med dashboard --range`, or written as a
 * dashboard's first range.
 */
export function parseRange(
  text: string,
  now = Date.now(),
): { range: TimeRange } | { error: string } {
  const value = text.trim().replace(/\s+/g, " ");
  const lower = value.toLowerCase();
  if (!value) return { error: "Type a range, such as 6h, yesterday, or since 9:00." };
  const fail = {
    error: `Med does not read "${value}" as a range. Try 6h, yesterday, since 9:00, Nov 14 to Nov 16, or now-7d.`,
  };
  const check = (range: TimeRange) => {
    const resolved = resolveRange(range, now);
    if (!resolved) return { error: "The range ends before it starts." };
    return { range };
  };
  const quick = QUICK_RANGES.find((entry) => entry.label.toLowerCase() === lower);
  if (quick) return { range: { from: quick.from, to: quick.to } };
  if (CALENDAR_WORDS[lower]) return { range: CALENDAR_WORDS[lower] };
  // Grafana's own: "now-6h", "now-7d to now-1d".
  if (RELATIVE.test(value) && value !== "now")
    return grafanaTime(value, now) === null ? fail : check({ from: value, to: "now" });
  const span = spanOf(value) ?? (/^\d+\s*[a-z]+$/i.test(value) ? spanOf(`last ${value}`) : null);
  if (span) return { range: { from: span, to: "now" } };
  const since = /^(?:since|from|after)\s+(.+)$/i.exec(value);
  if (since) {
    const from = momentOf(since[1]!, now, false);
    return from ? check({ from: from.at, to: "now" }) : fail;
  }
  // Two ends: "Nov 14 to Nov 16", "yesterday 14:00 - 16:30", "9:00 → 12:00".
  const ends = value.split(/\s+(?:to|until|till|through|–|—|-|→|->)\s+|\s*(?:→|\.\.)\s*/i);
  if (ends.length === 2) {
    const [left, right] = ends as [string, string];
    // "14 to 16 Nov": the first end takes the second's month.
    const bare = /^\d{1,2}$/.test(left.trim())
      ? right.replace(/^\s*\d{1,2}(?:st|nd|rd|th)?/, left.trim())
      : left;
    const from = momentOf(bare, now, false);
    if (!from) return fail;
    const to = momentOf(right, now, true, from.day);
    if (!to) return fail;
    return check({ from: from.at, to: to.at });
  }
  // One day, whole: "yesterday", "Monday", "Nov 14".
  const day = momentOf(value, now, false);
  if (day && !day.timed) {
    if (day.at === "now/d" || day.at === "now-1d/d") return { range: { from: day.at, to: day.at } };
    return check({ from: day.at, to: String(addDays(day.day!, 1) - 1) });
  }
  if (day?.timed) return check({ from: day.at, to: "now" });
  return fail;
}

/** The range a moment or two later or earlier, by half its span, as
 * Grafana's arrows move it. It does not go past now. */
export function shiftRange(range: TimeRange, direction: -1 | 1, now = Date.now()): TimeRange {
  const resolved = resolveRange(range, now);
  if (!resolved) return range;
  const [from, to] = resolved;
  const span = to - from;
  let start = from + (direction * span) / 2;
  let end = to + (direction * span) / 2;
  if (end > now) {
    end = now;
    start = now - span;
  }
  return { from: String(Math.round(start)), to: String(Math.round(end)) };
}

/** Whether the range ends now, or later: it cannot move later. */
export function endsNow(range: TimeRange, now = Date.now()) {
  const resolved = resolveRange(range, now);
  return !resolved || resolved[1] >= now - MINUTE;
}

/** Twice the span, about the same middle, as Grafana's zoom out: "Last 6
 * hours" becomes "Last 12 hours". */
export function zoomOutRange(range: TimeRange, now = Date.now()): TimeRange {
  const last = /^now-(\d+)([smhdwMy])$/.exec(range.from);
  if (last && range.to === "now")
    return { from: `now-${Number(last[1]) * 2}${last[2]}`, to: "now" };
  const resolved = resolveRange(range, now);
  if (!resolved) return range;
  const [from, to] = resolved;
  const span = to - from;
  let start = from - span / 2;
  let end = to + span / 2;
  if (end > now) {
    start -= end - now;
    end = now;
  }
  return { from: String(Math.round(start)), to: String(Math.round(end)) };
}

/** Two moments, as a chart's drag picks them. */
export const momentRange = (from: number, to: number): TimeRange => ({
  from: String(Math.round(Math.min(from, to))),
  to: String(Math.round(Math.max(from, to))),
});

/** One end as a person types it: now-6h, yesterday, Nov 14 09:00, an ISO
 * time. `end` makes a day its last moment. Null for words that name none. */
export function parseMoment(text: string, end: boolean, now = Date.now()): string | null {
  return momentOf(text, now, end)?.at ?? null;
}

/** An end as the picker's From and To fields show it: a relative time as
 * written, a moment as "2026-11-14 09:00" in the reader's zone. */
export function momentText(time: string) {
  if (!isMoment(time)) return time;
  const date = new Date(Number(time));
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${clock(date)}`;
}

/** The reader's time zone, as the picker's foot names it: "Asia/Singapore,
 * UTC+08:00". */
export function zoneLabel(now = Date.now()) {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const offset = -new Date(now).getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const hours = Math.floor(Math.abs(offset) / 60);
  return `${zone}, UTC${sign}${pad(hours)}:${pad(Math.abs(offset) % 60)}`;
}
