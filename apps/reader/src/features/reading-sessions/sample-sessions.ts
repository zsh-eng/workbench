import { SAMPLE_LIBRARY } from "@/features/elements/specimens/library-fixture";
import {
  useReadingSessionsQuery,
  type ReadingSessionsData,
} from "@/hooks/use-reading-sessions-query";
import type { ReadingSession } from "@/lib/db";
import { useMemo } from "react";

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/**
 * When each sample book was read, in days before today, and how. The first
 * books are being read now; the rest fill the past year, with gaps.
 */
const READING_PLAN: {
  id: string;
  fromDay: number;
  toDay: number;
  /** Chance of reading it on a given day. */
  chance: number;
  /** Typical minutes on a weekday; weekends run about twice as long. */
  minutes: number;
}[] = [
  { id: "middlemarch", fromDay: 38, toDay: 0, chance: 0.7, minutes: 28 },
  { id: "walden", fromDay: 95, toDay: 1, chance: 0.18, minutes: 12 },
  { id: "alice", fromDay: 24, toDay: 20, chance: 0.9, minutes: 35 },
  { id: "frankenstein", fromDay: 70, toDay: 44, chance: 0.65, minutes: 30 },
  { id: "pride", fromDay: 160, toDay: 118, chance: 0.6, minutes: 26 },
  { id: "moby", fromDay: 330, toDay: 175, chance: 0.22, minutes: 22 },
  { id: "expectations", fromDay: 270, toDay: 215, chance: 0.5, minutes: 24 },
  { id: "innocence", fromDay: 390, toDay: 345, chance: 0.55, minutes: 25 },
];

/** A small seeded generator, so the sample is the same on every load. */
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function buildSample(now: number): {
  data: ReadingSessionsData;
  coverUrls: ReadonlyMap<string, string>;
} {
  const next = random(20261019);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const sessions: ReadingSession[] = [];
  for (const plan of READING_PLAN) {
    const bookId = `elements-${plan.id}`;
    let spine = 1;
    for (let day = plan.fromDay; day >= plan.toDay; day--) {
      if (next() > plan.chance) continue;
      const date = new Date(today.getTime() - day * DAY_MS);
      const weekend = date.getDay() === 0 || date.getDay() === 6;
      // Weekday reading is mostly late evening, weekends in the morning.
      const hour = weekend
        ? 9 + next() * 3
        : next() < 0.25
          ? 8
          : 21 + next() * 2;
      const visits = next() < 0.2 ? 2 : 1;
      for (let visit = 0; visit < visits; visit++) {
        const startedAt =
          date.getTime() + (hour + visit * 3.5) * 60 * MINUTE_MS;
        if (startedAt > now) continue;
        const scale = weekend ? 2 : 1;
        // Some opens are only a glance, under the five meaningful minutes.
        const glance = next() < 0.12;
        const activeMs = Math.round(
          (glance ? 1 + next() * 3 : plan.minutes * scale * (0.5 + next())) *
            MINUTE_MS,
        );
        const lastActiveAt = Math.min(now, startedAt + activeMs * 1.15);
        const startSpineIndex = spine;
        spine += glance ? 0 : 1;
        sessions.push({
          id: `sample-${plan.id}-${day}-${visit}`,
          bookId,
          deviceId: next() < 0.8 ? "sample-phone" : "sample-laptop",
          readerInstanceId: `sample-${plan.id}-${day}-${visit}`,
          startedAt,
          endedAt: lastActiveAt,
          lastActiveAt,
          activeMs,
          startSpineIndex,
          startScrollProgress: Math.round(next() * 80),
          endSpineIndex: spine,
          endScrollProgress: Math.round(next() * 100),
        });
      }
    }
  }
  return {
    data: {
      books: SAMPLE_LIBRARY.map((sample) => sample.book),
      sessions,
    },
    coverUrls: new Map(
      SAMPLE_LIBRARY.map((sample) => [sample.book.id, sample.coverUrl]),
    ),
  };
}

/**
 * The Sessions page's records. With `?sample` in the address, a made-up
 * year of reading with the Elements sample books replaces them, for
 * reviewing the page where there is no reading history, such as a dev
 * server.
 */
export function useSessionsSource() {
  const query = useReadingSessionsQuery();
  const sample = useMemo(
    () =>
      new URLSearchParams(window.location.search).has("sample")
        ? buildSample(Date.now())
        : null,
    [],
  );
  return {
    data: sample?.data ?? query.data,
    isLoading: sample ? false : query.isLoading,
    error: sample ? null : query.error,
    /** Covers for the sample books, which have no files to read covers from. */
    sampleCoverUrls: sample?.coverUrls ?? null,
  };
}
