import { ActiveTime, DEFAULT_GAP_MS } from "./active-time";
import {
  ACTIVITY_SESSION_VERSION,
  sameSubject,
  type ActivitySession,
  type Subject,
} from "./session";

/** A changed session saves at most this often, and at once on a pause or end. */
export const CHECKPOINT_MS = 5_000;

export interface PersistContext {
  /** The person paused or left: the value will not change until they return. */
  paused: boolean;
}

export type PersistActivitySession<P> = (
  session: ActivitySession<P>,
  context: PersistContext,
) => void | Promise<void>;

export interface ActivityTrackerOptions<P> {
  app: string;
  gapMs?: number;
  device?: string | null;
  checkpointMs?: number;
  /** Saves a snapshot. Writes run one at a time, in order. */
  persist?: PersistActivitySession<P>;
  onError?: (error: unknown) => void;
  /** Unix milliseconds. Elapsed time uses this clock too (see README). */
  now?: () => number;
  createId?: () => string;
}

interface Entry<P> {
  session: ActivitySession<P>;
  revision: number;
  queued: number;
  saved: number;
  queuedAt: number;
}

/**
 * Keeps one activity session at a time and saves it.
 *
 * The owner calls `begin` for the visible subject and reports inputs, pauses
 * and returns; `connectTracker` reports the browser's. Beginning another
 * subject ends the current session. Saves are snapshots: a newer one is never
 * overwritten by an older one, and a failed save is retried by the next flush.
 */
export class ActivityTracker<P = null> {
  readonly app: string;
  readonly gapMs: number;
  readonly checkpointMs: number;
  readonly now: () => number;
  private readonly device: string | null;
  private readonly persist: PersistActivitySession<P>;
  private readonly onError: (error: unknown) => void;
  private readonly createId: () => string;
  /** Sessions with unsaved changes, and the open one. */
  private readonly entries = new Map<string, Entry<P>>();
  private current: { entry: Entry<P>; time: ActiveTime } | null = null;
  private present = true;
  private chain: Promise<void> = Promise.resolve();

  constructor(options: ActivityTrackerOptions<P>) {
    this.app = options.app;
    this.gapMs = options.gapMs ?? DEFAULT_GAP_MS;
    this.checkpointMs = options.checkpointMs ?? CHECKPOINT_MS;
    this.now = options.now ?? Date.now;
    this.device = options.device ?? null;
    this.persist = options.persist ?? (() => undefined);
    this.onError = options.onError ?? (() => undefined);
    this.createId = options.createId ?? (() => crypto.randomUUID());
  }

  /** The open session as it would be saved now, or null. */
  get session(): ActivitySession<P> | null {
    return this.current ? copy(this.current.entry.session) : null;
  }

  /**
   * Starts a session for `subject`, ending another subject's. For the open
   * subject it only moves the position. The interval opens now unless the
   * page is away (hidden or unfocused); the next input or return opens it.
   */
  begin(subject: Subject, options: { position?: P; at?: number } = {}): void {
    const { position } = options;
    if (
      this.current &&
      sameSubject(this.current.entry.session.subject, subject)
    ) {
      if (position !== undefined) this.move(position);
      return;
    }
    const at = options.at ?? this.now();
    this.end(at);
    const time = new ActiveTime(this.gapMs);
    if (this.present) time.resume(at);
    const session: ActivitySession<P> = {
      v: ACTIVITY_SESSION_VERSION,
      id: this.createId(),
      app: this.app,
      subject: { kind: subject.kind, id: subject.id },
      device: this.device,
      startedAt: at,
      lastActiveAt: at,
      endedAt: null,
      activeMs: 0,
      gapMs: this.gapMs,
      position:
        position === undefined ? null : { start: position, end: position },
    };
    const entry = {
      session,
      revision: 1,
      queued: 0,
      saved: 0,
      queuedAt: -Infinity,
    };
    this.entries.set(session.id, entry);
    this.current = { entry, time };
    this.flush();
  }

  /** Records the subject's current position; the start position stays. */
  move(position: P): void {
    const entry = this.current?.entry;
    if (!entry) return;
    const span = entry.session.position;
    if (span && JSON.stringify(span.end) === JSON.stringify(position)) return;
    entry.session.position = {
      start: span ? span.start : position,
      end: position,
    };
    entry.revision++;
    this.flush();
  }

  /** A deliberate input. It also proves presence, so it ends a pause. */
  input(at: number = this.now()): void {
    this.present = true;
    if (!this.current) return;
    this.current.time.input(at);
    this.account(at, true);
    this.flush();
  }

  /** The person cannot be reading: count up to now, stop, and save. */
  pause(at: number = this.now()): void {
    this.present = false;
    if (this.current) this.account(at, this.current.time.pause(at) > 0);
    this.flush({ force: true });
  }

  /** The page is visible and focused again: open a fresh interval. */
  resume(at: number = this.now()): void {
    this.present = true;
    this.current?.time.resume(at);
  }

  /** Ends the open session: counts up to now, saves it, and returns it. */
  end(at: number = this.now()): ActivitySession<P> | null {
    const current = this.current;
    if (!current) return null;
    const { entry, time } = current;
    this.account(at, time.pause(at) > 0);
    entry.session.endedAt = at;
    entry.revision++;
    this.current = null;
    this.flush({ force: true });
    return copy(entry.session);
  }

  /**
   * Saves changed sessions. Without `force`, a session saves at most once per
   * checkpoint interval. Unchanged and already queued values are skipped.
   */
  flush(options: { force?: boolean } = {}): void {
    const now = this.now();
    for (const entry of this.entries.values()) {
      if (entry.revision === entry.saved || entry.revision === entry.queued) {
        continue;
      }
      // A failed save waits for the next interval too, so that a broken
      // store is not retried on every input.
      const recent =
        now >= entry.queuedAt && now - entry.queuedAt < this.checkpointMs;
      if (recent && !options.force) continue;
      this.enqueue(entry, now);
    }
  }

  /** Resolves when every save queued so far has settled. */
  whenIdle(): Promise<void> {
    return this.chain;
  }

  /**
   * Copies the counted time into the session. `present` says that `at` was a
   * moment of presence: an input, or the end of a counted interval.
   */
  private account(at: number, present: boolean): void {
    const current = this.current;
    if (!current) return;
    const { session } = current.entry;
    const activeMs = Math.round(current.time.activeMs);
    const lastActiveAt = present
      ? Math.max(session.lastActiveAt, at)
      : session.lastActiveAt;
    if (
      activeMs === session.activeMs &&
      lastActiveAt === session.lastActiveAt
    ) {
      return;
    }
    session.activeMs = activeMs;
    session.lastActiveAt = lastActiveAt;
    current.entry.revision++;
  }

  private enqueue(entry: Entry<P>, now: number): void {
    const snapshot = copy(entry.session);
    const revision = entry.revision;
    const context = { paused: snapshot.endedAt !== null || !this.present };
    entry.queued = revision;
    entry.queuedAt = now;
    this.chain = this.chain.then(async () => {
      try {
        await this.persist(snapshot, context);
        entry.saved = Math.max(entry.saved, revision);
        const ended = entry.session.endedAt !== null;
        if (ended && entry.saved === entry.revision) {
          this.entries.delete(entry.session.id);
        }
      } catch (error) {
        // The next flush retries, unless a newer value is already queued.
        if (entry.queued === revision) entry.queued = entry.saved;
        this.onError(error);
      }
    });
  }
}

function copy<P>(session: ActivitySession<P>): ActivitySession<P> {
  return {
    ...session,
    subject: { ...session.subject },
    position: session.position && { ...session.position },
  };
}
