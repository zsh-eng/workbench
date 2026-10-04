/** Local-time aggregates shared by the Sessions prototypes. */
import type { StudioBook, StudioHighlight, StudioSession } from "../data/sample-library";

export const DAY_MS = 86_400_000;

export function dayKey(time: number | Date): string {
  const date = new Date(time);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function startOfDay(time: number | Date): Date {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date;
}

export interface DayTotal {
  minutes: number;
  bookIds: Set<string>;
  sessions: number;
}

export function totalsByDay(sessions: StudioSession[]): Map<string, DayTotal> {
  const days = new Map<string, DayTotal>();
  for (const session of sessions) {
    const key = dayKey(session.startedAt);
    const day = days.get(key) ?? { minutes: 0, bookIds: new Set<string>(), sessions: 0 };
    day.minutes += session.activeMs / 60000;
    day.bookIds.add(session.bookId);
    day.sessions += 1;
    days.set(key, day);
  }
  return days;
}

export function highlightColorsByDay(highlights: StudioHighlight[]): Map<string, StudioHighlight["color"][]> {
  const days = new Map<string, StudioHighlight["color"][]>();
  for (const highlight of highlights) {
    const key = dayKey(highlight.createdAt);
    const list = days.get(key) ?? [];
    if (!list.includes(highlight.color)) list.push(highlight.color);
    days.set(key, list);
  }
  return days;
}

export interface BookTime {
  book: StudioBook;
  minutes: number;
  sessions: StudioSession[];
  first: number;
  last: number;
}

export function timeByBook(sessions: StudioSession[], books: StudioBook[]): BookTime[] {
  const booksById = new Map(books.map((book) => [book.id, book]));
  const totals = new Map<string, BookTime>();
  for (const session of sessions) {
    const book = booksById.get(session.bookId);
    if (!book) continue;
    const entry = totals.get(book.id) ?? {
      book,
      minutes: 0,
      sessions: [],
      first: session.startedAt,
      last: session.startedAt,
    };
    entry.minutes += session.activeMs / 60000;
    entry.sessions.push(session);
    entry.first = Math.min(entry.first, session.startedAt);
    entry.last = Math.max(entry.last, session.startedAt);
    totals.set(book.id, entry);
  }
  for (const entry of totals.values()) entry.sessions.sort((a, b) => a.startedAt - b.startedAt);
  return [...totals.values()];
}

/** Longest run of consecutive reading days, and the run that ends today. */
export function streaks(days: Map<string, DayTotal>, today: Date): { longest: number; current: number } {
  const keys = [...days.keys()]
    .map((key) => {
      const [year, month, day] = key.split("-").map(Number);
      return new Date(year, month, day).getTime();
    })
    .sort((a, b) => a - b);
  let longest = 0;
  let run = 0;
  let previous = Number.NEGATIVE_INFINITY;
  for (const time of keys) {
    // Round to tolerate daylight-saving days.
    run = Math.round((time - previous) / DAY_MS) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = time;
  }
  let current = 0;
  const cursor = startOfDay(today);
  if (!days.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (days.has(dayKey(cursor))) {
    current += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return { longest, current };
}

export function formatClock(minuteOfDay: number): string {
  const hour = Math.floor(minuteOfDay / 60) % 24;
  const minute = Math.floor(minuteOfDay % 60);
  const suffix = hour < 12 ? "am" : "pm";
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return minute === 0 ? `${display} ${suffix}` : `${display}:${String(minute).padStart(2, "0")} ${suffix}`;
}

export function minuteOfDay(time: number): number {
  const date = new Date(time);
  return date.getHours() * 60 + date.getMinutes();
}
