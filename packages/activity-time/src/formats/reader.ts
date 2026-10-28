import { ACTIVITY_SESSION_VERSION, type ActivitySession } from "../session";

/** The device that counts a Reader session, as `deviceClass` tells it. */
export type ReaderDevice = "phone" | "tablet" | "desktop";

/**
 * The Reader's gap by device, chosen when a session begins. Paged reading
 * has quiet minutes between page turns; a phone's page holds less text than
 * a tablet's or a desktop's, so it gets the shorter gap. The device decides,
 * not the window: a phone on its side keeps a phone's gap.
 */
export const READER_GAP_MS: Readonly<Record<ReaderDevice, number>> = {
  phone: 3 * 60_000,
  tablet: 5 * 60_000,
  desktop: 5 * 60_000,
};

/**
 * The gap of a row without `gapMs`. Every Reader counted with ten minutes
 * until the gap went by device (28 October 2026), and those rows keep no
 * gap, as do rows that a Reader from before then still writes.
 */
export const READER_LEGACY_GAP_MS = 10 * 60_000;

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
  /** The gap that counted `activeMs`. Absent: `READER_LEGACY_GAP_MS`. */
  gapMs?: number;
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
    gapMs: row.gapMs ?? READER_LEGACY_GAP_MS,
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
    gapMs: session.gapMs,
  };
}
