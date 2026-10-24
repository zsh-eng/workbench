import { useEffect, useRef, useState } from "react";
import { connectTracker } from "./dom";
import type { Subject } from "./session";
import { ActivityTracker, type ActivityTrackerOptions } from "./tracker";

export interface UseActivityTrackerOptions<
  P,
> extends ActivityTrackerOptions<P> {
  /** Whether losing window focus pauses. Defaults to true. */
  pauseOnBlur?: boolean;
}

/**
 * One tracker for the component's life, fed by the page's signals. The open
 * session ends when the component unmounts. `app`, `gapMs`, `device`,
 * `checkpointMs`, `now` and `createId` are read once; `persist` and
 * `onError` may change between renders.
 */
export function useActivityTracker<P = null>(
  options: UseActivityTrackerOptions<P>,
): ActivityTracker<P> {
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });
  const [tracker] = useState(
    () =>
      new ActivityTracker<P>({
        ...options,
        persist: (session, context) =>
          latest.current.persist?.(session, context),
        onError: (error) => latest.current.onError?.(error),
      }),
  );
  const pauseOnBlur = options.pauseOnBlur ?? true;
  useEffect(
    () => connectTracker(tracker, { pauseOnBlur }),
    [tracker, pauseOnBlur],
  );
  useEffect(
    () => () => {
      tracker.end();
    },
    [tracker],
  );
  return tracker;
}

/**
 * Tracks time on `subject` while it is not null: a new subject begins a new
 * session, and null or unmounting ends it.
 */
export function useActivitySession<P = null>(
  subject: Subject | null,
  options: UseActivityTrackerOptions<P>,
): ActivityTracker<P> {
  const tracker = useActivityTracker(options);
  const kind = subject?.kind;
  const id = subject?.id;
  useEffect(() => {
    if (kind === undefined || id === undefined) return;
    tracker.begin({ kind, id });
    return () => {
      tracker.end();
    };
  }, [tracker, kind, id]);
  return tracker;
}
