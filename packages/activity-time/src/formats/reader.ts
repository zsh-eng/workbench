import { ACTIVITY_SESSION_VERSION, type ActivitySession } from "../session";

/**
 * The Reader's gap. Paged reading has quiet minutes between page turns, so
 * the Reader keeps the ten minutes it has always counted with. Its rows do
 * not store the gap: add a field to them before this changes.
 */
export const READER_GAP_MS = 10 * 60_000;

/** A place in a book: a spine item and a percentage (0–100) through it. */
export interface ReaderPosition {
  spineIndex: number;
  progress: number;
}

/** A `readingSessions` row in the Reader's database and `reader` namespace. */
export interface ReaderSessionRow {
  id: string;
  bookId: string;
  deviceId: string;
  /** The mounted reader that counted it. */
  readerInstanceId: string;
  startedAt: number;
  endedAt: number | null;
  lastActiveAt: number;
  activeMs: number;
  startSpineIndex: number;
  startScrollProgress: number;
  endSpineIndex: number;
  endScrollProgress: number;
}

export function fromReaderSession(
  row: ReaderSessionRow,
): ActivitySession<ReaderPosition> {
  return {
    v: ACTIVITY_SESSION_VERSION,
    id: row.id,
    app: "reader",
    subject: { kind: "book", id: row.bookId },
    device: row.deviceId,
    startedAt: row.startedAt,
    lastActiveAt: row.lastActiveAt,
    endedAt: row.endedAt,
    activeMs: row.activeMs,
    gapMs: READER_GAP_MS,
    position: {
      start: {
        spineIndex: row.startSpineIndex,
        progress: row.startScrollProgress,
      },
      end: { spineIndex: row.endSpineIndex, progress: row.endScrollProgress },
    },
  };
}

/** The row for a session; the Reader's store adds `deviceId`. */
export function toReaderSession(
  session: ActivitySession<ReaderPosition>,
  readerInstanceId: string,
): Omit<ReaderSessionRow, "deviceId"> {
  const { position } = session;
  if (session.subject.kind !== "book" || !position) {
    throw new Error("A Reader session is for a book and has a position.");
  }
  return {
    id: session.id,
    bookId: session.subject.id,
    readerInstanceId,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    lastActiveAt: session.lastActiveAt,
    activeMs: session.activeMs,
    startSpineIndex: position.start.spineIndex,
    startScrollProgress: position.start.progress,
    endSpineIndex: position.end.spineIndex,
    endScrollProgress: position.end.progress,
  };
}
