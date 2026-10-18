import {
  createReadingCheckpointId,
  type ReadingCheckpoint,
  upsertCurrentDeviceReadingCheckpoint,
} from "@/lib/db";
import { getOrCreateDeviceId } from "@/lib/device";
import type { ResolvedSpread } from "@/lib/pagination-v2";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import {
  readerCheckpointKeys,
  type ReaderCheckpointData,
} from "../data/reader-cache/queries";
import {
  CHECKPOINT_FLUSH_INTERVAL_MS,
  createReaderCheckpointSnapshotFromLocation,
  getReaderCheckpointSnapshotKey,
  type ReaderCheckpointSnapshot,
  shouldFlushCheckpointImmediately,
  shouldTrackCheckpointIntent,
} from "./reader-checkpoint-controller";
import {
  readerLocationFromSpread,
  type ReaderLocation,
} from "../reader-location";

interface UseReaderCheckpointControllerOptions {
  bookId?: string;
  spread: ResolvedSpread | null;
  /** Scroll mode's location; it replaces the spread while set. */
  location?: ReaderLocation | null;
  /** Page numbers are final, so the snapshot can include whole-book progress. */
  isFullyPaginated: boolean;
}

/**
 * Keeps the Reader checkpoint in sync with the current spread, or with the
 * scroll location while scroll mode is on.
 *
 * Responsibilities:
 * - derive a persistable `(chapterIndex, scrollProgress)` snapshot from the
 *   leading visible page of the current spread, plus whole-book progress once
 *   the whole book is paginated
 * - ignore non-committal navigation like scrubber preview
 * - flush immediately for committed page turns and jumps
 * - flush periodically and on lifecycle exits for restore/relayout snapshots
 *
 * Save requests optimistically update the resume cache through onMutate, then
 * TanStack Query serializes durable writes for this device and book.
 */
export function useReaderCheckpointController({
  bookId,
  spread,
  location: scrollLocation = null,
  isFullyPaginated,
}: UseReaderCheckpointControllerOptions): void {
  const queryClient = useQueryClient();
  const latestSnapshotRef = useRef<ReaderCheckpointSnapshot | null>(null);
  const lastRequestedRef = useRef<{
    key: string;
    checkpoint: Omit<ReadingCheckpoint, "id" | "deviceId">;
    pending: boolean;
  } | null>(null);

  const { mutate: saveCheckpoint } = useMutation({
    mutationKey: [...readerCheckpointKeys.currentDevice(bookId ?? ""), "save"],
    // Scope serializes durable writes across Reader mounts. onMutate still
    // runs immediately for each request, including requests waiting in scope.
    scope: {
      id: JSON.stringify(readerCheckpointKeys.currentDevice(bookId ?? "")),
    },
    networkMode: "always", // IndexedDB writes must also run while offline.
    mutationFn: upsertCurrentDeviceReadingCheckpoint,
    onMutate: (checkpoint) => {
      const queryKey = readerCheckpointKeys.currentDevice(checkpoint.bookId);
      const deviceId = getOrCreateDeviceId();
      // Cancellation takes effect synchronously. Publish before yielding so a
      // Reader opened in the same turn can capture the latest requested save.
      void queryClient.cancelQueries({ queryKey, exact: true });
      queryClient.setQueryData<ReaderCheckpointData>(queryKey, {
        checkpoint: {
          ...checkpoint,
          id: createReadingCheckpointId(checkpoint.bookId, deviceId),
          deviceId,
        },
      });
    },
    onError: (error, checkpoint) => {
      // A storage failure must not discard the user's in-memory position.
      // Allow the next periodic/lifecycle flush to retry the latest snapshot.
      if (lastRequestedRef.current?.checkpoint === checkpoint) {
        lastRequestedRef.current = null;
      }
      console.error("Failed to save Reader checkpoint:", error);
    },
    onSettled: (_data, _error, checkpoint) => {
      if (lastRequestedRef.current?.checkpoint === checkpoint) {
        lastRequestedRef.current.pending = false;
      }
    },
  });

  const flushLatest = useCallback(
    (options: { force?: boolean } = {}) => {
      const snapshot = latestSnapshotRef.current;
      if (!snapshot) return;

      const key = getReaderCheckpointSnapshotKey(snapshot);
      const lastRequested = lastRequestedRef.current;
      if (
        lastRequested?.key === key &&
        (!options.force || lastRequested.pending)
      )
        return;

      const checkpoint = {
        bookId: snapshot.bookId,
        currentSpineIndex: snapshot.currentSpineIndex,
        scrollProgress: snapshot.scrollProgress,
        ...(snapshot.bookProgress !== undefined
          ? { bookProgress: snapshot.bookProgress }
          : {}),
        lastRead: Date.now(),
      };
      lastRequestedRef.current = { key, checkpoint, pending: true };
      saveCheckpoint(checkpoint);
    },
    [saveCheckpoint],
  );

  useEffect(() => {
    latestSnapshotRef.current = null;
    lastRequestedRef.current = null;
  }, [bookId]);

  useEffect(() => {
    const location = scrollLocation ?? readerLocationFromSpread(spread);
    if (!bookId || !location || !shouldTrackCheckpointIntent(location.intent)) {
      return;
    }

    const checkpoint = createReaderCheckpointSnapshotFromLocation(
      bookId,
      location,
      isFullyPaginated,
    );
    if (!checkpoint) return;
    latestSnapshotRef.current = checkpoint;

    if (shouldFlushCheckpointImmediately(location.intent)) {
      flushLatest();
    }
  }, [bookId, spread, scrollLocation, isFullyPaginated, flushLatest]);

  useEffect(() => {
    if (!bookId) return;

    const intervalId = window.setInterval(() => {
      flushLatest();
    }, CHECKPOINT_FLUSH_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [bookId, flushLatest]);

  useEffect(() => {
    if (!bookId) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flushLatest({ force: true });
      }
    };

    const handlePageHide = () => {
      flushLatest({ force: true });
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", handlePageHide);
      flushLatest({ force: true });
    };
  }, [bookId, flushLatest]);
}
