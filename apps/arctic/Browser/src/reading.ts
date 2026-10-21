import { useEffect } from "react";
import { encodeSorted, type RecordStorage } from "./sync/storage";
import type { Session } from "./sync/session";

/**
 * Reading time, as Arctic on iPhone counts it (ReadingSessions.swift): a visit
 * is one opening of an article with text, `session/<UUID>` in `arctic-reading`.
 * Time between two of the reader's own actions counts when the gap is two
 * minutes or less; a longer gap counts for nothing. A hidden tab pauses.
 */
export const IDLE_MS = 120_000;
const CHECKPOINT_MS = 5_000;
const SWIFT_EPOCH_MS = 978_307_200_000;
const swiftDate = (ms: number) => (ms - SWIFT_EPOCH_MS) / 1000;

export type ReadingSession = {
  id: string;
  articleURL: string;
  startedAt: number;
  updatedAt: number;
  seconds: number;
};

const ACTIVITY = [
  "scroll",
  "wheel",
  "keydown",
  "pointerdown",
  "pointermove",
  "touchstart",
] as const;

/** Counts this visit while `active`; checkpoints every five seconds. */
export function useReadingClock(
  session: Session,
  articleURL: string,
  active: boolean,
) {
  useEffect(() => {
    if (!active) return;
    const id = crypto.randomUUID().toUpperCase();
    const startedAt = Date.now();
    let updatedAt = startedAt;
    let seconds = 0;
    let boundary =
      document.visibilityState === "visible" ? performance.now() : undefined;
    let dirty = false;
    let checkpoint = performance.now();

    const account = () => {
      if (boundary === undefined) return;
      const now = performance.now();
      const elapsed = now - boundary;
      boundary = now;
      if (elapsed <= 0 || elapsed > IDLE_MS) return;
      seconds += elapsed / 1000;
      updatedAt = Date.now();
      dirty = true;
    };
    const flush = (force: boolean) => {
      if (!dirty || (!force && performance.now() - checkpoint < CHECKPOINT_MS))
        return;
      checkpoint = performance.now();
      dirty = false;
      session.reading
        .write([
          {
            key: `session/${id}`,
            value: encodeSorted({
              articleURL,
              id,
              seconds: Math.round(seconds * 1000) / 1000,
              startedAt: swiftDate(startedAt),
              updatedAt: swiftDate(updatedAt),
            }),
          },
        ])
        .then(
          // Reading time uploads within a minute, or soon after a pause.
          () => session.syncSoon(force ? 3000 : 60_000),
          () => (dirty = true),
        );
    };
    const activity = () => {
      account();
      flush(false);
    };
    const pause = () => {
      account();
      boundary = undefined;
      flush(true);
    };
    const visibility = () => {
      if (document.visibilityState !== "visible") pause();
      else boundary ??= performance.now();
    };

    for (const type of ACTIVITY)
      window.addEventListener(type, activity, { passive: true });
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", pause);
    // The timer only saves counted time; it never counts time by itself.
    const timer = setInterval(() => flush(false), CHECKPOINT_MS);
    return () => {
      pause();
      clearInterval(timer);
      for (const type of ACTIVITY)
        window.removeEventListener(type, activity);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", pause);
    };
  }, [session, articleURL, active]);
}

/** Every reading session in the account, from this browser and others. */
export function readingSessions(storage: RecordStorage): ReadingSession[] {
  const sessions: ReadingSession[] = [];
  for (const key of storage.keys()) {
    if (!key.startsWith("session/")) continue;
    const view = storage.view(key);
    if (!view || view.isDeleted) continue;
    try {
      const value = JSON.parse(view.value);
      if (
        typeof value.articleURL !== "string" ||
        typeof value.seconds !== "number" ||
        !Number.isFinite(value.seconds) ||
        value.seconds < 0 ||
        typeof value.startedAt !== "number"
      )
        continue;
      sessions.push({
        id: String(value.id ?? key.slice("session/".length)),
        articleURL: value.articleURL,
        seconds: value.seconds,
        startedAt: value.startedAt * 1000 + SWIFT_EPOCH_MS,
        updatedAt:
          (Number(value.updatedAt) || value.startedAt) * 1000 + SWIFT_EPOCH_MS,
      });
    } catch {
      /* A damaged record is skipped; the others still count. */
    }
  }
  return sessions;
}

export type ReadingStats = {
  days: { date: Date; seconds: number }[];
  week: number;
  total: number;
  /** Articles read for a minute or more in the last seven days. */
  articles: number;
  visits: number;
  /** Seconds per article URL in the last seven days, most first. */
  byArticle: [string, number][];
};

/** Totals as the phone shows them: a visit belongs to the day it started. */
export function readingStats(
  sessions: ReadingSession[],
  now = new Date(),
): ReadingStats {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Array.from({ length: 7 }, (_, index) => ({
    date: new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6 + index),
    seconds: 0,
  }));
  const stats: ReadingStats = {
    days,
    week: 0,
    total: 0,
    articles: 0,
    visits: 0,
    byArticle: [],
  };
  const perArticle = new Map<string, number>();
  for (const visit of sessions) {
    if (visit.seconds <= 0 || visit.startedAt > now.getTime()) continue;
    stats.total += visit.seconds;
    const started = new Date(visit.startedAt);
    const day = days.find(
      (item) => item.date.getTime() === new Date(started.getFullYear(), started.getMonth(), started.getDate()).getTime(),
    );
    if (!day) continue;
    day.seconds += visit.seconds;
    stats.week += visit.seconds;
    stats.visits++;
    perArticle.set(
      visit.articleURL,
      (perArticle.get(visit.articleURL) ?? 0) + visit.seconds,
    );
  }
  stats.byArticle = [...perArticle].sort((a, b) => b[1] - a[1]);
  stats.articles = stats.byArticle.filter(([, seconds]) => seconds >= 60).length;
  return stats;
}

/** "<1 min", "12 min", "1 hr 5 min", as on the phone. */
export function duration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  if (seconds > 0 && minutes === 0) return "<1 min";
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return rest === 0
    ? `${Math.floor(minutes / 60)} hr`
    : `${Math.floor(minutes / 60)} hr ${rest} min`;
}
