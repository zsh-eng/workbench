import {
  ARCTIC_GAP_MS,
  decodeArcticSession,
  encodeArcticSession,
  localDay,
  summarizeTime,
  type ActivitySession,
} from "@workbench/activity-time";
import { useActivitySession } from "@workbench/activity-time/react";
import type { RecordStorage } from "./sync/storage";
import type { Session } from "./sync/session";

/**
 * Reading time, as Arctic on iPhone counts it (ReadingSessions.swift), with
 * the shared rule in `packages/activity-time`: a visit is one opening of an
 * article with text, `session/<UUID>` in `arctic-reading`, in the phone's
 * format. Time between two of the reader's own actions counts when the gap is
 * three minutes or less; a longer gap counts for nothing. A hidden tab, or
 * another window in focus, pauses.
 */
type ReadingSession = ActivitySession<null>;

const PREFIX = "session/";

/** Counts this visit while `active`; checkpoints every five seconds. */
export function useReadingClock(
  session: Session,
  articleURL: string,
  active: boolean,
) {
  useActivitySession(active ? { kind: "article", id: articleURL } : null, {
    app: "arctic",
    gapMs: ARCTIC_GAP_MS,
    // The phone writes upper-case UUIDs.
    createId: () => crypto.randomUUID().toUpperCase(),
    persist: async (visit, { paused }) => {
      // A moment is not a visit. (React's development mode also mounts the
      // reader twice, which would leave one.)
      if (visit.activeMs < 1000) return;
      const key = PREFIX + visit.id;
      const value = encodeArcticSession(visit);
      // No second copy of the same value: the phone's format has no end time.
      if (!value || session.reading.view(key)?.value === value) return;
      await session.reading.write([{ key, value }]);
      // Reading time uploads within a minute, or soon after a pause.
      session.syncSoon(paused ? 3000 : 60_000);
    },
  });
}

/** Every reading session in the account, from this browser and others. */
export function readingSessions(storage: RecordStorage): ReadingSession[] {
  const sessions: ReadingSession[] = [];
  for (const key of storage.keys()) {
    if (!key.startsWith(PREFIX)) continue;
    const view = storage.view(key);
    if (!view || view.isDeleted) continue;
    // A damaged record is skipped; the others still count.
    const visit = decodeArcticSession(view.value, key.slice(PREFIX.length));
    if (visit) sessions.push(visit);
  }
  return sessions;
}

type ReadingStats = {
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
  const dates = Array.from(
    { length: 7 },
    (_, index) =>
      new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6 + index),
  );
  const week = summarizeTime(sessions, {
    from: dates[0]!.getTime(),
    to: now.getTime(),
  });
  return {
    days: dates.map((date) => ({
      date,
      seconds: (week.buckets.get(localDay(date.getTime())) ?? 0) / 1000,
    })),
    week: week.activeMs / 1000,
    total: summarizeTime(sessions, { to: now.getTime() }).activeMs / 1000,
    articles: week.subjects.filter((article) => article.activeMs >= 60_000)
      .length,
    visits: week.sessions.length,
    byArticle: week.subjects.map((article) => [
      article.subject.id,
      article.activeMs / 1000,
    ]),
  };
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
