import { registerLabDrain } from "@/features/sync-lab/runtime";
import { updateCurrentDeviceReadingSession } from "@/lib/db";
import type { ResolvedSpread, SpreadIntent } from "@/lib/pagination-v2";
import {
  READER_GAP_MS,
  toReaderSession,
  type ReaderPosition,
} from "@workbench/activity-time";
import { useActivityTracker } from "@workbench/activity-time/react";
import { deviceClass } from "@workbench/elements/size-class";
import { useEffect, useState } from "react";
import {
  readerLocationFromSpread,
  toChapterProgressPercent,
  type ReaderLocation,
} from "../../reader-location";

interface UseReaderReadingSessionOptions {
  bookId?: string;
  spread: ResolvedSpread | null;
  /** Scroll mode's location; it replaces the spread while set. */
  location?: ReaderLocation | null;
}

/** A scrubber preview is not a place the reader has been. */
export function shouldTrackReadingSessionIntent(intent: SpreadIntent): boolean {
  return intent.kind !== "preview";
}

/** Page turns, jumps and history moves are the reader's own actions. */
export function shouldRecordReadingSessionActivity(
  intent: SpreadIntent,
): boolean {
  return (
    intent.kind === "linear" ||
    intent.kind === "jump" ||
    intent.kind === "history"
  );
}

export function readerSessionPosition(
  location: ReaderLocation,
): ReaderPosition {
  return {
    spineIndex: location.chapterIndex,
    progress: toChapterProgressPercent(location),
  };
}

/**
 * The gap for a session that begins now: three minutes on a phone, five on
 * a tablet or desktop. The device decides, not the window (`deviceClass`),
 * so a phone on its side keeps a phone's gap and an iPad window beside
 * another app an iPad's.
 */
export function readerSessionGapMs(): number {
  return READER_GAP_MS[deviceClass()];
}

/**
 * Keeps one `readingSessions` row for the mounted reader's current book.
 *
 * The shared tracker (`packages/activity-time`) counts time by the gap rule
 * and saves the row. Each session takes the device's gap as it begins and
 * keeps it, whatever the window does later. The session starts at the first
 * real location, so loading does not count. Each later location moves its
 * end. The reader's own moves count as input, as do the browser's.
 */
export function useReaderReadingSession({
  bookId,
  spread,
  location: scrollLocation = null,
}: UseReaderReadingSessionOptions): void {
  const [readerInstanceId] = useState(() => crypto.randomUUID());
  const tracker = useActivityTracker<ReaderPosition>({
    app: "reader",
    gapMs: readerSessionGapMs,
    persist: async (session) => {
      await updateCurrentDeviceReadingSession(
        toReaderSession(session, readerInstanceId),
      );
    },
    onError: (error) => {
      console.error("Failed to save reading session:", error);
    },
  });

  useEffect(() => {
    if (!bookId) return;
    return () => {
      tracker.end();
    };
  }, [bookId, tracker]);

  useEffect(() => {
    const location = scrollLocation ?? readerLocationFromSpread(spread);
    if (
      !bookId ||
      !location ||
      !shouldTrackReadingSessionIntent(location.intent)
    ) {
      return;
    }
    tracker.begin(
      { kind: "book", id: bookId },
      { position: readerSessionPosition(location) },
    );
    if (shouldRecordReadingSessionActivity(location.intent)) tracker.input();
  }, [bookId, spread, scrollLocation, tracker]);

  // Register last so unmount first queues the final session snapshot.
  useEffect(() => registerLabDrain(() => tracker.whenIdle()), [tracker]);
}
