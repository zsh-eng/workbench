import { activity } from "@/lib/background-activity";
import {
  appArrivals,
  BOOK_IMPORT_KIND,
  type ArrivalRecord,
  type ArrivalRecords,
} from "@/lib/book-arrivals";
import type { ActivitySnapshot, Job } from "@workbench/background-activity";
import {
  createContext,
  createElement,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { arrivalFromJob, type ArrivalProgress } from "./arrival-progress";

/** An arriving book as the Library draws it: its record and its job. */
export interface Arrival extends ArrivalRecord {
  progress: ArrivalProgress;
  /** `performance.now()` when the progress last changed. */
  changedAt: number;
}

/**
 * How arrivals draw: `develop`, `light` and `ink` are shaders, `calm` is
 * CSS only, and `still` is what reduced motion gets: paper, then the cover.
 * The design review chose raking light for the Library's grid; one book on
 * its own arrives in the arrival sheet, in ink.
 */
export type ArrivalLook = "develop" | "light" | "ink" | "calm" | "still";

export const LIBRARY_ARRIVAL_LOOK: ArrivalLook = "light";

/** The jobs to read: the app's queue, or a demo's own. */
export interface ArrivalSource {
  subscribe(listener: () => void): () => void;
  getSnapshot(): ActivitySnapshot;
  retry(id: string): void;
  dismiss(id: string): void;
}

/** An arrival's place in the grid, apart from how far it has come. */
export interface ArrivalPlace {
  key: string;
  sourceFileId: ArrivalRecord["sourceFileId"];
  duplicate: boolean;
  settled: boolean;
  /** No book in the library yet. */
  pending: boolean;
}

/**
 * Where a book is. The job says while it is in the queue; the record says
 * how it ended, and stands in once the finished job has left the queue.
 */
function progressOf(
  record: ArrivalRecord,
  job: Job | undefined,
): ArrivalProgress {
  if (record.existingBookId) return { stage: "duplicate", fraction: 1 };
  if (job) return arrivalFromJob(job);
  if (record.bookId) return { stage: "ready", fraction: 1 };
  if (record.error) return { stage: "failed", fraction: 0 };
  return { stage: "queued", fraction: 0 };
}

/**
 * The records joined with their jobs, once per change, for every reader.
 * An arrival keeps its object while neither its record nor its job
 * changes, so a cover re-renders only for its own book.
 */
class ArrivalFeed {
  private records: readonly ArrivalRecord[] | null = null;
  private jobs: readonly Job[] | null = null;
  private arrivals: readonly Arrival[] = [];
  private views = new WeakMap<ArrivalRecord, { job?: Job; view: Arrival }>();
  private changes = new Map<string, { progress: string; at: number }>();
  private places: {
    arrivals: readonly Arrival[];
    signature: string;
    places: readonly ArrivalPlace[];
  } | null = null;

  private readonly store: ArrivalRecords;
  private readonly source: ArrivalSource;

  constructor(store: ArrivalRecords, source: ArrivalSource) {
    this.store = store;
    this.source = source;
  }

  subscribe = (listener: () => void) => {
    const stopRecords = this.store.subscribe(listener);
    const stopJobs = this.source.subscribe(listener);
    return () => {
      stopRecords();
      stopJobs();
    };
  };

  getSnapshot = (): readonly Arrival[] => {
    const records = this.store.getSnapshot();
    const jobs = this.source.getSnapshot().jobs;
    if (records === this.records && jobs === this.jobs) return this.arrivals;
    this.records = records;
    this.jobs = jobs;
    const byId = new Map(
      jobs
        .filter((job) => job.kind === BOOK_IMPORT_KIND)
        .map((job) => [job.id, job]),
    );
    const next = records.map((record) =>
      this.view(record, byId.get(record.key)),
    );
    const same =
      next.length === this.arrivals.length &&
      next.every((arrival, index) => arrival === this.arrivals[index]);
    if (!same) this.arrivals = next;
    return this.arrivals;
  };

  /**
   * Where the arrivals stand, without their progress: it changes only when
   * a place opens, gets its book, or goes. The grid reads this, so a step
   * of one import re-renders that book's cover and not the whole shelf.
   */
  getPlaces = (): readonly ArrivalPlace[] => {
    const arrivals = this.getSnapshot();
    if (this.places?.arrivals === arrivals) return this.places.places;
    const places = arrivals.map(
      (arrival): ArrivalPlace => ({
        key: arrival.key,
        sourceFileId: arrival.sourceFileId,
        duplicate: arrival.progress.stage === "duplicate",
        settled: arrival.settled,
        pending: !arrival.bookId && arrival.progress.stage !== "duplicate",
      }),
    );
    const signature = places
      .map((place) =>
        [
          place.key,
          place.sourceFileId,
          place.duplicate,
          place.settled,
          place.pending,
        ].join(" "),
      )
      .join("\n");
    if (this.places?.signature === signature) {
      this.places.arrivals = arrivals;
      return this.places.places;
    }
    this.places = { arrivals, signature, places };
    return places;
  };

  private view(record: ArrivalRecord, job: Job | undefined): Arrival {
    const cached = this.views.get(record);
    if (cached && cached.job === job) return cached.view;
    const progress = progressOf(record, job);
    const key = `${progress.stage}:${progress.fraction}`;
    const previous = this.changes.get(record.key);
    const at =
      previous && previous.progress === key ? previous.at : performance.now();
    this.changes.set(record.key, { progress: key, at });
    const previousView = cached?.view;
    // The job changed in a way the drawing does not see: keep the object.
    const view =
      previousView &&
      previousView.progress.stage === progress.stage &&
      previousView.progress.fraction === progress.fraction
        ? previousView
        : { ...record, progress, changedAt: at };
    this.views.set(record, { job, view });
    return view;
  }
}

interface ArrivalEnvironment {
  records: ArrivalRecords;
  source: ArrivalSource;
  look: ArrivalLook;
  /** A living cover's depth map for a book, when it has a scene. */
  reliefFor: (sourceFileId: string | null) => string | null;
}

interface ArrivalContextValue extends ArrivalEnvironment {
  feed: ArrivalFeed;
}

const appEnvironment: ArrivalContextValue = {
  records: appArrivals,
  source: activity,
  look: LIBRARY_ARRIVAL_LOOK,
  reliefFor: () => null,
  feed: new ArrivalFeed(appArrivals, activity),
};

const ArrivalContext = createContext<ArrivalContextValue>(appEnvironment);

/** Design ideas give a page its own records and queue, apart from the app's. */
export function ArrivalProvider({
  records,
  source,
  look,
  reliefFor,
  children,
}: ArrivalEnvironment & { children: ReactNode }) {
  const feed = useMemo(
    () => new ArrivalFeed(records, source),
    [records, source],
  );
  const value = useMemo(
    () => ({ records, source, look, reliefFor, feed }),
    [records, source, look, reliefFor, feed],
  );
  return createElement(ArrivalContext.Provider, { value }, children);
}

export function useArrivalEnvironment(): ArrivalEnvironment {
  return useContext(ArrivalContext);
}

export function useArrivalLook(): ArrivalLook {
  return useContext(ArrivalContext).look;
}

/** Every arrival's place, newest batch first and in order within a batch. */
export function useArrivalPlaces(): readonly ArrivalPlace[] {
  const { feed } = useContext(ArrivalContext);
  return useSyncExternalStore(feed.subscribe, feed.getPlaces);
}

/** One arrival, by its key. */
export function useArrival(key: string): Arrival | undefined {
  const { feed } = useContext(ArrivalContext);
  return useSyncExternalStore(feed.subscribe, () =>
    feed.getSnapshot().find((arrival) => arrival.key === key),
  );
}

/**
 * The arrival a book on the shelf is still drawing, by its file. A
 * duplicate never draws over the copy that was already there.
 */
export function useBookArrival(sourceFileId: string): Arrival | undefined {
  const { feed } = useContext(ArrivalContext);
  return useSyncExternalStore(feed.subscribe, () =>
    feed
      .getSnapshot()
      .find(
        (arrival) =>
          arrival.sourceFileId === sourceFileId &&
          !arrival.settled &&
          arrival.progress.stage !== "duplicate",
      ),
  );
}
