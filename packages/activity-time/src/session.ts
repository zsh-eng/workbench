/**
 * The version of the `ActivitySession` shape. A new optional field keeps it;
 * a change that an older reader would misread increments it.
 */
export const ACTIVITY_SESSION_VERSION = 1;

/** What the time was spent on: an app's entity kind and its stable id. */
export interface Subject {
  /** For example "book" (Reader), "article" (Arctic) or "card" (Spaced). */
  kind: string;
  id: string;
}

/** Where a session started and where it is now, in the app's own terms. */
export interface Span<P> {
  start: P;
  end: P;
}

/**
 * Time spent on one subject during one visit, in every app.
 *
 * A session is a snapshot that only its creating tab or device writes, and
 * every write replaces the whole value. A retried or duplicated write leaves
 * the same record, and devices never merge into one record. `activeMs` and
 * `lastActiveAt` only grow, so an older snapshot is recognisably older.
 */
export interface ActivitySession<P = unknown> {
  v: typeof ACTIVITY_SESSION_VERSION;
  /** Random and minted once, when the session begins. */
  id: string;
  /** "reader", "arctic" or "spaced". */
  app: string;
  subject: Subject;
  /** The device that counted the time, when its records say. */
  device: string | null;
  /** Unix milliseconds. Stats assign the session to the local day it started. */
  startedAt: number;
  /** Unix milliseconds of the last input, or of the end of the last counted interval. */
  lastActiveAt: number;
  /** Unix milliseconds; null while open, or when the store does not keep it. */
  endedAt: number | null;
  /** Whole milliseconds counted under the gap rule. */
  activeMs: number;
  /** The gap that counted `activeMs`: a longer pause between inputs counted nothing. */
  gapMs: number;
  /** App-defined position at the start and now, or null. */
  position: Span<P> | null;
}

export function sameSubject(left: Subject, right: Subject): boolean {
  return left.kind === right.kind && left.id === right.id;
}

/** A string key for maps: `kind:id`. */
export function subjectKey(subject: Subject): string {
  return `${subject.kind}:${subject.id}`;
}
