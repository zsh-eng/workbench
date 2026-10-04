/**
 * Shared pieces for the quieter Library and Margin plates: restrained motion,
 * covers with a soft shadow, hairline progress and short date labels.
 */
import { cn } from "@/lib/utils";
import { motion } from "motion/react";
import type { ReactNode } from "react";
import type { StudioBook, StudioLibrary, StudioStatus } from "./data/sample-library";
import { TypographicCover } from "./primitives";

/** Critically damped: settles without overshoot. */
export const QUIET_SPRING = { type: "spring", stiffness: 420, damping: 44, mass: 0.8 } as const;
export const QUIET_EASE = [0.2, 0, 0, 1] as const;
export const QUIET_FADE = { duration: 0.18, ease: QUIET_EASE } as const;

export const STATUS_LABEL: Record<StudioStatus, string> = {
  reading: "Reading",
  "want-to-read": "Up next",
  finished: "Finished",
  dnf: "Set aside",
};

export const STATUS_ORDER: StudioStatus[] = ["reading", "want-to-read", "finished", "dnf"];

/**
 * Library plates show the reader's own books when there are enough of them.
 * Sample books otherwise; the two are never mixed on one shelf.
 */
export function shelfBooks(library: StudioLibrary): StudioBook[] {
  const own = library.books.filter((book) => book.origin === "library");
  return own.length >= 3 ? own : library.books.filter((book) => book.origin === "sample");
}

const DAY_MS = 86_400_000;
const MONTH_DAY = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });
const MONTH_DAY_YEAR = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });

/** "2 h ago", "Yesterday", "4 days ago", "12 Mar". */
export function relativeDay(time: number | null, now = Date.now()): string {
  if (time === null) return "—";
  const minutes = Math.max(0, Math.round((now - time) / 60000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 20) return `${hours} h ago`;
  const days = Math.round((now - time) / DAY_MS);
  if (days <= 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  const date = new Date(time);
  return date.getFullYear() === new Date(now).getFullYear()
    ? MONTH_DAY.format(date)
    : MONTH_DAY_YEAR.format(date);
}

export interface BookActivity {
  minutes: number;
  highlights: number;
  sessions: number;
}

export function activityByBook(library: StudioLibrary): Map<string, BookActivity> {
  const activity = new Map<string, BookActivity>();
  const entry = (bookId: string) => {
    const current = activity.get(bookId) ?? { minutes: 0, highlights: 0, sessions: 0 };
    activity.set(bookId, current);
    return current;
  };
  for (const session of library.sessions) {
    const current = entry(session.bookId);
    current.minutes += session.activeMs / 60000;
    current.sessions += 1;
  }
  for (const highlight of library.highlights) entry(highlight.bookId).highlights += 1;
  return activity;
}

export function shortDate(time: number): string {
  const date = new Date(time);
  return date.getFullYear() === new Date().getFullYear() ? MONTH_DAY.format(date) : MONTH_DAY_YEAR.format(date);
}

export function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** A cover with a soft two-layer shadow and a faint spine edge. */
export function QuietCover({
  book,
  className,
  compact = false,
}: {
  book: StudioBook;
  className?: string;
  compact?: boolean;
}) {
  return (
    <span
      className={cn(
        "relative block overflow-hidden rounded-[3px] rounded-r-[5px] shadow-[0_1px_1px_rgba(0,0,0,0.06),0_10px_24px_-12px_rgba(0,0,0,0.35)]",
        className,
      )}
    >
      <TypographicCover book={book} compact={compact} className="size-full" />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0 w-[6%] bg-gradient-to-r from-black/15 to-transparent"
      />
    </span>
  );
}

export function ProgressLine({
  value,
  className,
  delay = 0,
}: {
  value: number;
  className?: string;
  delay?: number;
}) {
  return (
    <span className={cn("relative block h-[2px] overflow-hidden rounded-full bg-foreground/10", className)}>
      <motion.span
        className="absolute inset-y-0 left-0 block rounded-full bg-foreground/70"
        initial={{ width: 0 }}
        animate={{ width: `${Math.max(value > 0 ? 2 : 0, value * 100)}%` }}
        transition={{ duration: 0.6, ease: QUIET_EASE, delay }}
      />
    </span>
  );
}

/** Minutes remaining, from time spent and progress. */
export function estimateMinutesLeft(minutesSpent: number, progress: number): number | null {
  if (progress < 0.04 || progress >= 1 || minutesSpent <= 0) return null;
  return Math.round((minutesSpent / progress) * (1 - progress));
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))} min`;
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

export function QuietKbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[5px] border border-border bg-muted/60 px-1 font-sans text-[10px] font-medium text-muted-foreground">
      {children}
    </kbd>
  );
}
