import { subjectKey, type Subject } from "./session";

/** The fields stats read; any richer session shape works. */
export interface TimedSession {
  subject: Subject;
  startedAt: number;
  activeMs: number;
}

export interface SubjectTime {
  subject: Subject;
  activeMs: number;
  sessions: number;
  lastStartedAt: number;
}

export interface TimeSummary<T extends TimedSession> {
  activeMs: number;
  /** The sessions that count, newest first. */
  sessions: T[];
  /** Local days with time. */
  days: number;
  /** Time per bucket of the start time; days unless `bucket` says otherwise. */
  buckets: Map<string, number>;
  /** Most time first, then the most recently started. */
  subjects: SubjectTime[];
}

export interface SummaryOptions {
  /** Unix milliseconds, inclusive. */
  from?: number;
  /** Unix milliseconds, inclusive. Pass now: a device clock ahead can date a session later. */
  to: number;
  bucket?: (startedAt: number) => string;
}

/**
 * Totals as every app shows them: a session belongs to the local day it
 * started, and counts when it has time and started from `from` to `to`.
 */
export function summarizeTime<T extends TimedSession>(
  sessions: Iterable<T>,
  { from = -Infinity, to, bucket = localDay }: SummaryOptions,
): TimeSummary<T> {
  const counted: T[] = [];
  const buckets = new Map<string, number>();
  const subjects = new Map<string, SubjectTime>();
  const days = new Set<string>();
  let activeMs = 0;
  for (const session of sessions) {
    const { startedAt } = session;
    if (!(session.activeMs > 0) || startedAt < from || startedAt > to) continue;
    counted.push(session);
    activeMs += session.activeMs;
    days.add(localDay(startedAt));
    const key = bucket(startedAt);
    buckets.set(key, (buckets.get(key) ?? 0) + session.activeMs);
    const total = subjects.get(subjectKey(session.subject));
    if (total) {
      total.activeMs += session.activeMs;
      total.sessions += 1;
      total.lastStartedAt = Math.max(total.lastStartedAt, startedAt);
    } else {
      subjects.set(subjectKey(session.subject), {
        subject: session.subject,
        activeMs: session.activeMs,
        sessions: 1,
        lastStartedAt: startedAt,
      });
    }
  }
  return {
    activeMs,
    sessions: counted.sort((a, b) => b.startedAt - a.startedAt),
    days: days.size,
    buckets,
    subjects: [...subjects.values()].sort(
      (a, b) => b.activeMs - a.activeMs || b.lastStartedAt - a.lastStartedAt,
    ),
  };
}

/** The local calendar day of a time, as `yyyy-mm-dd`. */
export function localDay(ms: number): string {
  const date = new Date(ms);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}
