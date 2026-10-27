/** Reading-status history and the latest status for each book. */
import type { SyncV2ReadingState as StoredReadingState } from "@/lib/sync-v2/db";
import type { ReadingState } from "@/types/reading-state";
import Dexie from "dexie";
import { db, isNotDeleted } from "./database";

export type { ReadingState, ReadingStatus } from "@/types/reading-state";

export async function setReadingStatus(
  bookId: string,
  status: ReadingState["status"],
): Promise<string> {
  const now = Date.now();
  const entry: ReadingState = {
    id: crypto.randomUUID(),
    bookId,
    status,
    timestamp: now,
    createdAt: now,
  };
  return db.readingState.add({ ...entry, isDeleted: false });
}

export async function getReadingStatus(
  bookId: string,
): Promise<ReadingState["status"] | null> {
  const latest = await db.readingState
    .where("[bookId+timestamp]")
    .between([bookId, Dexie.minKey], [bookId, Dexie.maxKey])
    .filter(isNotDeleted)
    .reverse()
    .first();

  return latest?.status ?? null;
}

export async function getAllReadingStatuses(): Promise<
  Map<string, ReadingState["status"]>
> {
  // Get all reading state entries, grouped by bookId, return latest per book
  // One read of the table, not a cursor (see `getAllBooks`).
  const allEntries = (await db.readingState.toArray()).filter(isNotDeleted);

  // Group by bookId and find latest for each
  const latestByBook = new Map<string, StoredReadingState>();
  for (const entry of allEntries) {
    const existing = latestByBook.get(entry.bookId);
    if (!existing || entry.timestamp > existing.timestamp) {
      latestByBook.set(entry.bookId, entry);
    }
  }

  // Convert to status-only map
  const result = new Map<string, ReadingState["status"]>();
  for (const [bookId, entry] of latestByBook) {
    result.set(bookId, entry.status);
  }
  return result;
}

export async function getReadingHistory(
  bookId: string,
): Promise<ReadingState[]> {
  return db.readingState
    .where("bookId")
    .equals(bookId)
    .filter(isNotDeleted)
    .sortBy("timestamp");
}
