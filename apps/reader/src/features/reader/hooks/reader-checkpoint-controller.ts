import type { ResolvedSpread, SpreadIntent } from "@/lib/pagination-v2";
import {
  readerLocationFromSpread,
  toChapterProgressPercent,
  type ReaderLocation,
} from "../reader-location";

export const CHECKPOINT_FLUSH_INTERVAL_MS = 5000;

export interface ReaderCheckpointSnapshot {
  bookId: string;
  currentSpineIndex: number;
  localPageIndex: number;
  totalPagesInChapter: number;
  scrollProgress: number;
  bookProgress?: number;
}

/**
 * Page numbers count only the chapters laid out so far, so the whole-book
 * fraction is exact only after pagination of the whole book is complete.
 */
function toBookProgress(location: ReaderLocation): number {
  if (location.totalPages <= 1) return 0;
  return (location.currentPage - 1) / (location.totalPages - 1);
}

/** The snapshot for a location in either reading mode. */
export function createReaderCheckpointSnapshotFromLocation(
  bookId: string | undefined,
  location: ReaderLocation | null,
  isFullyPaginated: boolean,
): ReaderCheckpointSnapshot | null {
  if (!bookId || !location) return null;

  return {
    bookId,
    currentSpineIndex: location.chapterIndex,
    localPageIndex: location.pageIndexInChapter,
    totalPagesInChapter: location.totalPagesInChapter,
    scrollProgress: toChapterProgressPercent(location),
    ...(isFullyPaginated ? { bookProgress: toBookProgress(location) } : {}),
  };
}

export function createReaderCheckpointSnapshot(
  bookId: string | undefined,
  spread: ResolvedSpread | null,
  isFullyPaginated: boolean,
): ReaderCheckpointSnapshot | null {
  return createReaderCheckpointSnapshotFromLocation(
    bookId,
    readerLocationFromSpread(spread),
    isFullyPaginated,
  );
}

export function shouldTrackCheckpointIntent(intent: SpreadIntent): boolean {
  return intent.kind !== "preview";
}

export function shouldFlushCheckpointImmediately(
  intent: SpreadIntent,
): boolean {
  return (
    intent.kind === "jump" ||
    intent.kind === "linear" ||
    intent.kind === "history"
  );
}

export function getReaderCheckpointSnapshotKey(
  snapshot: ReaderCheckpointSnapshot,
): string {
  return JSON.stringify([
    snapshot.bookId,
    snapshot.currentSpineIndex,
    snapshot.localPageIndex,
    snapshot.totalPagesInChapter,
    snapshot.bookProgress,
  ]);
}
