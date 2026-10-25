/** Per-device resume locations and Library last-read ordering. */
import { getOrCreateDeviceId } from "@/lib/device";
import { db, isNotDeleted } from "./database";

export interface ReadingCheckpoint {
  id: string; // Stable primary key: `resume:${deviceId}:${bookId}`
  bookId: string; // Foreign key to Book
  deviceId: string; // Device that owns this checkpoint
  currentSpineIndex: number; // Current chapter/spine index
  scrollProgress: number; // Chapter-local percentage in the range 0-100
  /**
   * Whole-book progress in the range 0-1: the leading page's place among all
   * pages. Only a Reader that has paginated the whole book knows it, so a
   * checkpoint saved before that, or by an older client, does not have it.
   */
  bookProgress?: number;
  lastRead: number; // Timestamp when this checkpoint was last updated
}

export function createReadingCheckpointId(
  bookId: string,
  deviceId: string,
): string {
  return `resume:${deviceId}:${bookId}`;
}

/**
 * Every writer passes a percentage. Values from 0 to 1 are percentages too:
 * page 2 of a 201-page chapter is 0.5% through it, not half way.
 */
function normalizeCheckpointScrollProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

export async function getReadingCheckpointForDevice(
  bookId: string,
  deviceId: string,
): Promise<ReadingCheckpoint | undefined> {
  const checkpoint = await db.readingCheckpoints.get(
    createReadingCheckpointId(bookId, deviceId),
  );
  return checkpoint && isNotDeleted(checkpoint) ? checkpoint : undefined;
}

export async function getCurrentDeviceReadingCheckpoint(
  bookId: string,
): Promise<ReadingCheckpoint | undefined> {
  return getReadingCheckpointForDevice(bookId, getOrCreateDeviceId());
}

export async function getReadingCheckpointsForBook(
  bookId: string,
): Promise<ReadingCheckpoint[]> {
  return db.readingCheckpoints
    .where("bookId")
    .equals(bookId)
    .filter(isNotDeleted)
    .toArray();
}

/**
 * The latest checkpoint per book across all devices: where the book was last
 * read, and when. The Library sorts by its time and shows its position as
 * reading progress. Checkpoints are written while reading (page turns,
 * periodic flushes, and tab hide), so a book read on another device still
 * sorts by its most recent activity.
 */
export async function getLatestReadingCheckpoints(): Promise<
  Map<string, ReadingCheckpoint>
> {
  const checkpoints = await db.readingCheckpoints
    .filter(isNotDeleted)
    .toArray();

  const latestByBook = new Map<string, ReadingCheckpoint>();
  for (const checkpoint of checkpoints) {
    const existing = latestByBook.get(checkpoint.bookId);
    if (!existing || checkpoint.lastRead > existing.lastRead) {
      latestByBook.set(checkpoint.bookId, checkpoint);
    }
  }
  return latestByBook;
}

export async function upsertReadingCheckpoint(
  checkpoint: Omit<ReadingCheckpoint, "id">,
): Promise<string> {
  const normalizedCheckpoint: ReadingCheckpoint = {
    ...checkpoint,
    id: createReadingCheckpointId(checkpoint.bookId, checkpoint.deviceId),
    scrollProgress: normalizeCheckpointScrollProgress(
      checkpoint.scrollProgress,
    ),
    ...(checkpoint.bookProgress !== undefined
      ? { bookProgress: Math.max(0, Math.min(1, checkpoint.bookProgress)) }
      : {}),
  };

  await db.readingCheckpoints.put({
    ...normalizedCheckpoint,
    isDeleted: false,
  });
  return normalizedCheckpoint.id;
}

export async function upsertCurrentDeviceReadingCheckpoint(
  checkpoint: Omit<ReadingCheckpoint, "id" | "deviceId">,
): Promise<string> {
  return upsertReadingCheckpoint({
    ...checkpoint,
    deviceId: getOrCreateDeviceId(),
  });
}
