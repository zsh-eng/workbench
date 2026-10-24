/** The default gap: two minutes, as Arctic on iPhone counts reading time. */
export const DEFAULT_GAP_MS = 120_000;

/**
 * Active time under the gap rule.
 *
 * Boundaries are an opening (a start, or a return from a pause), an input,
 * and a pause. The interval from one boundary to the next counts when it is
 * longer than zero and at most `gapMs`; a longer interval counts for nothing,
 * not even up to the gap. A pause counts its interval and leaves none open, so
 * time away never counts. Nothing counts between boundaries: a timer can save
 * the total but never add to it.
 *
 * Times are milliseconds on one clock. A clock that runs backwards starts a
 * fresh boundary and subtracts nothing.
 */
export class ActiveTime {
  readonly gapMs: number;
  activeMs = 0;
  private since: number | null = null;

  constructor(gapMs: number = DEFAULT_GAP_MS) {
    if (!(gapMs > 0)) throw new RangeError("The gap must be positive.");
    this.gapMs = gapMs;
  }

  /** Whether an interval is open, so that the next boundary can count it. */
  get running(): boolean {
    return this.since !== null;
  }

  /** Opens an interval at `at` unless one is open. */
  resume(at: number): void {
    this.since ??= at;
  }

  /** Counts the interval that ends at this input and opens the next. */
  input(at: number): number {
    const counted = this.count(at);
    this.since = at;
    return counted;
  }

  /** Counts the open interval up to `at` and closes it. */
  pause(at: number): number {
    const counted = this.count(at);
    this.since = null;
    return counted;
  }

  private count(at: number): number {
    if (this.since === null) return 0;
    const gap = at - this.since;
    if (gap <= 0 || gap > this.gapMs) return 0;
    this.activeMs += gap;
    return gap;
  }
}
