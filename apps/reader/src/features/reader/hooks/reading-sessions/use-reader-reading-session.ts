import { registerLabDrain } from "@/features/sync-lab/runtime";
import { updateCurrentDeviceReadingSession } from "@/lib/db";
import type { ResolvedSpread } from "@/lib/pagination-v2";
import { useEffect, useRef } from "react";
import {
  readerLocationFromSpread,
  type ReaderLocation,
} from "../../reader-location";
import {
  createReaderReadingSessionPositionFromLocation,
  ReaderReadingSessionController,
  READING_SESSION_FLUSH_INTERVAL_MS,
  shouldRecordReadingSessionActivity,
  shouldTrackReadingSessionIntent,
} from "./reader-reading-session-controller";

interface UseReaderReadingSessionOptions {
  bookId?: string;
  spread: ResolvedSpread | null;
  /** Scroll mode's location; it replaces the spread while set. */
  location?: ReaderLocation | null;
}

/**
 * Persists one mutable reading-session row for the mounted reader instance.
 *
 * The controller handles the active-time accounting; this hook only wires
 * reader spreads and browser lifecycle/activity events into that controller.
 */
export function useReaderReadingSession({
  bookId,
  spread,
  location: scrollLocation = null,
}: UseReaderReadingSessionOptions): void {
  const controllerRef = useRef<ReaderReadingSessionController | null>(null);
  if (controllerRef.current === null) {
    controllerRef.current = new ReaderReadingSessionController({
      persist: async (session) => {
        await updateCurrentDeviceReadingSession(session);
      },
      onError: (error) => {
        console.error("Failed to save reading session:", error);
      },
    });
  }

  const controller = controllerRef.current;

  useEffect(() => {
    const location = scrollLocation ?? readerLocationFromSpread(spread);
    if (
      !bookId ||
      !location ||
      !shouldTrackReadingSessionIntent(location.intent)
    ) {
      return;
    }

    const position = createReaderReadingSessionPositionFromLocation(
      bookId,
      location,
    );
    if (!position) return;

    controller.setPosition(position, {
      now: Date.now(),
      recordActivity: shouldRecordReadingSessionActivity(location.intent),
    });
    controller.flushLatest();
  }, [bookId, spread, scrollLocation, controller]);

  useEffect(() => {
    if (!bookId) return;

    const intervalId = window.setInterval(() => {
      controller.flushLatest();
    }, READING_SESSION_FLUSH_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [bookId, controller]);

  useEffect(() => {
    if (!bookId) return;

    const recordActivity = (event: Event) => {
      controller.recordActivity(Date.now());
      // A touch can immediately reveal reading time. Save its activity boundary
      // now; continuous wheel and keyboard input keep the periodic flush.
      if (event.type === "pointerdown" || event.type === "touchstart") {
        controller.flushLatest();
      }
    };

    window.addEventListener("keydown", recordActivity);
    window.addEventListener("pointerdown", recordActivity);
    window.addEventListener("touchstart", recordActivity, { passive: true });
    window.addEventListener("wheel", recordActivity, { passive: true });

    return () => {
      window.removeEventListener("keydown", recordActivity);
      window.removeEventListener("pointerdown", recordActivity);
      window.removeEventListener("touchstart", recordActivity);
      window.removeEventListener("wheel", recordActivity);
    };
  }, [bookId, controller]);

  useEffect(() => {
    if (!bookId) return;

    const handleVisibilityChange = () => {
      const now = Date.now();
      controller.setVisible(document.visibilityState === "visible", now);
      if (document.visibilityState === "hidden") {
        controller.flushLatest({ force: true });
      }
    };

    const handlePageHide = () => {
      controller.endSession(Date.now());
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", handlePageHide);
      controller.endSession(Date.now());
    };
  }, [bookId, controller]);

  // Register last so unmount first queues the final session snapshot.
  useEffect(() => registerLabDrain(() => controller.whenIdle()), [controller]);
}
