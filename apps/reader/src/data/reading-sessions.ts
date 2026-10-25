/** Reading-duration records and cleanup of sessions left open by a device. */
import { getOrCreateDeviceId } from "@/lib/device";
import { READER_GAP_MS, type ReaderSessionRow } from "@workbench/activity-time";
import { db, isNotDeleted } from "./database";

/** A longer pause between inputs counts nothing (`packages/activity-time`). */
export const READING_SESSION_IDLE_TIMEOUT_MS = READER_GAP_MS;

/** The stored row; `fromReaderSession` reads it as a shared activity session. */
export interface ReadingSession extends ReaderSessionRow {
  id: string; // UUID primary key for this reader-open session
  bookId: string; // Foreign key to Book
  deviceId: string; // Device that owns this session
  readerInstanceId: string; // Ephemeral mounted reader/window instance
  startedAt: number; // Timestamp when the reader session began
  /**
   * Best-effort timestamp for when the reader session ended.
   *
   * Browser unload/pagehide writes are not guaranteed to complete. Future
   * cleanup/reporting should treat `lastActiveAt` as the practical end for
   * stale sessions where this remains null.
   */
  endedAt: number | null;
  lastActiveAt: number; // Last timestamp we considered plausibly active
  activeMs: number; // Accumulated active reading time, excluding idle gaps
  startSpineIndex: number;
  startScrollProgress: number; // Chapter-local percentage in the range 0-100
  endSpineIndex: number;
  endScrollProgress: number; // Chapter-local percentage in the range 0-100
}

/** Recorded time for one book, including sessions from other synced devices. */
export async function getBookReadingSessions(
  bookId: string,
): Promise<ReadingSession[]> {
  return db.readingSessions
    .where("bookId")
    .equals(bookId)
    .filter(isNotDeleted)
    .toArray();
}

type CurrentDeviceReadingSessionInput = Omit<ReadingSession, "deviceId">;

function withCurrentDeviceReadingSession(
  session: CurrentDeviceReadingSessionInput,
): ReadingSession {
  return {
    ...session,
    deviceId: getOrCreateDeviceId(),
  };
}

export async function createCurrentDeviceReadingSession(
  session: CurrentDeviceReadingSessionInput,
): Promise<string> {
  const record = withCurrentDeviceReadingSession(session);
  return db.readingSessions.add({ ...record, isDeleted: false });
}

export async function updateCurrentDeviceReadingSession(
  session: CurrentDeviceReadingSessionInput,
): Promise<string> {
  const record = withCurrentDeviceReadingSession(session);
  await db.readingSessions.put({ ...record, isDeleted: false });
  return record.id;
}
