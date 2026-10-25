/**
 * React hooks over an activity manager, or anything with its
 * `subscribe`/`getSnapshot`. They work with React 18 and 19.
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  summarizeActivity,
  type ActivitySummary,
  type SummaryOptions,
} from "./summary";
import type { ActivitySnapshot, Job } from "./types";

export type ActivitySource = {
  subscribe(listener: () => void): () => void;
  getSnapshot(): ActivitySnapshot;
};

/** Every job; re-renders on any change. */
export function useActivity(source: ActivitySource): ActivitySnapshot;
/**
 * One part of the snapshot. `select` must return a value from the snapshot,
 * such as a job, or a primitive, so that an unchanged part is the same value.
 */
export function useActivity<T>(
  source: ActivitySource,
  select: (snapshot: ActivitySnapshot) => T,
): T;
export function useActivity<T>(
  source: ActivitySource,
  select?: (snapshot: ActivitySnapshot) => T,
): ActivitySnapshot | T {
  const read = () => {
    const snapshot = source.getSnapshot();
    return select ? select(snapshot) : snapshot;
  };
  return useSyncExternalStore(source.subscribe, read, read);
}

/** One job by id; re-renders only when that job changes. */
export function useJob(
  source: ActivitySource,
  id: string | null,
): Job | undefined {
  return useActivity(source, (snapshot) =>
    id === null ? undefined : snapshot.jobs.find((job) => job.id === id),
  );
}

/**
 * The jobs that match, as one array that keeps its identity while the
 * matching jobs do. `match` should not change between renders.
 */
export function useJobs(
  source: ActivitySource,
  match: (job: Job) => boolean,
): readonly Job[] {
  const cache = useRef<readonly Job[]>([]);
  return useActivity(source, (snapshot) => {
    const next = snapshot.jobs.filter(match);
    const previous = cache.current;
    if (
      next.length === previous.length &&
      next.every((job, index) => job === previous[index])
    )
      return previous;
    cache.current = next;
    return next;
  });
}

/**
 * What to show now (see `summarizeActivity`). It re-renders when the
 * snapshot changes and when a show delay or a done confirmation ends.
 */
export function useActivitySummary(
  source: ActivitySource,
  options?: SummaryOptions & { now?: () => number },
): ActivitySummary {
  const snapshot = useActivity(source);
  const clock = options?.now ?? Date.now;
  const [tick, setTick] = useState(0);
  const summary = useMemo(
    () => summarizeActivity(snapshot, clock(), options),
    // `tick` reads the clock again when a delay ends.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snapshot, tick, options?.showAfterMs, options?.doneLingerMs],
  );
  const { nextChangeAt } = summary;
  useEffect(() => {
    if (nextChangeAt === null) return;
    const timer = setTimeout(
      () => setTick((value) => value + 1),
      Math.max(0, nextChangeAt - clock()) + 1,
    );
    return () => clearTimeout(timer);
  }, [nextChangeAt, clock]);
  return summary;
}

/** The time, again every `intervalMs` while `active`: for "Retrying in 8 s". */
export function useNow(active: boolean, intervalMs = 1_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [active, intervalMs]);
  return now;
}
