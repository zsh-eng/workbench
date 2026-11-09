import { useSyncDeviceNames } from "@/features/sync-history/device-names";
import type { ReadingCheckpoint } from "@/lib/db";
import { getOrCreateDeviceId } from "@/lib/device";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useReaderCheckpointsQuery } from "../data/reader-cache/hooks";
import type { ReaderHandoffPrompt } from "../types";

const EMPTY_READING_CHECKPOINTS: readonly ReadingCheckpoint[] = [];

export interface ReaderHandoffSessionStart {
  bookId: string;
  currentDeviceId: string;
  currentDeviceCheckpoint: ReadingCheckpoint | null;
  startedAt: number;
}

export interface ReaderHandoffPromptState {
  show: boolean;
  checkpoint: ReadingCheckpoint | null;
}

export interface UseReaderHandoffPromptOptions {
  bookId?: string;
  enabled?: boolean;
  currentDeviceId?: string;
  /**
   * Stable session start timestamp. Passing this from the caller keeps the
   * handoff baseline tied to reader-open time instead of hook render timing.
   */
  sessionStartedAt?: number;
  chapterStartPages?: (number | null)[];
  totalPages?: number;
  /** The first page on screen, and how many show beside it. */
  currentPage?: number;
  pagesShown?: number;
  onJumpToPage?: (page: number) => void;
}

export interface UseReaderHandoffPromptResult {
  promptState: ReaderHandoffPromptState;
  prompt: ReaderHandoffPrompt | undefined;
  dismissPrompt: () => void;
}

function useStableSessionStartedAt(explicitStartedAt: number | undefined) {
  const startedAtRef = useRef<number | null>(null);

  if (explicitStartedAt !== undefined) {
    return explicitStartedAt;
  }

  if (startedAtRef.current === null) {
    startedAtRef.current = Date.now();
  }

  return startedAtRef.current;
}

function useCurrentDeviceId(explicitDeviceId: string | undefined): string {
  const [fallbackDeviceId] = useState(
    () => explicitDeviceId ?? getOrCreateDeviceId(),
  );

  return explicitDeviceId ?? fallbackDeviceId;
}

function clampPercentage(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function isCheckpointForRemoteDevice(
  checkpoint: ReadingCheckpoint,
  currentDeviceId: string,
): boolean {
  return checkpoint.deviceId !== currentDeviceId;
}

function compareCheckpoints(
  a: ReadingCheckpoint,
  b: ReadingCheckpoint,
): number {
  if (a.lastRead !== b.lastRead) return a.lastRead - b.lastRead;

  const deviceCompare = a.deviceId.localeCompare(b.deviceId);
  if (deviceCompare !== 0) return deviceCompare;
  return a.id.localeCompare(b.id);
}

export function getLatestRemoteReadingCheckpoint(
  checkpoints: readonly ReadingCheckpoint[],
  currentDeviceId: string,
): ReadingCheckpoint | null {
  let latestCheckpoint: ReadingCheckpoint | null = null;

  for (const checkpoint of checkpoints) {
    if (!isCheckpointForRemoteDevice(checkpoint, currentDeviceId)) {
      continue;
    }

    if (
      latestCheckpoint === null ||
      compareCheckpoints(checkpoint, latestCheckpoint) > 0
    ) {
      latestCheckpoint = checkpoint;
    }
  }

  return latestCheckpoint;
}

export function captureReaderHandoffSessionStart(options: {
  bookId: string;
  checkpoints: readonly ReadingCheckpoint[];
  currentDeviceId: string;
  startedAt: number;
}): ReaderHandoffSessionStart {
  const currentDeviceCheckpoint =
    options.checkpoints.find(
      (checkpoint) => checkpoint.deviceId === options.currentDeviceId,
    ) ?? null;

  return {
    bookId: options.bookId,
    currentDeviceId: options.currentDeviceId,
    currentDeviceCheckpoint,
    startedAt: options.startedAt,
  };
}

export function getLatestUnreadRemoteReadingCheckpoint(
  checkpoints: readonly ReadingCheckpoint[],
  sessionStart: ReaderHandoffSessionStart,
): ReadingCheckpoint | null {
  const latestRemoteCheckpoint = getLatestRemoteReadingCheckpoint(
    checkpoints,
    sessionStart.currentDeviceId,
  );
  if (latestRemoteCheckpoint === null) return null;

  if (
    sessionStart.currentDeviceCheckpoint !== null &&
    compareCheckpoints(
      latestRemoteCheckpoint,
      sessionStart.currentDeviceCheckpoint,
    ) <= 0
  ) {
    return null;
  }

  return latestRemoteCheckpoint;
}

function shouldShowPrompt(
  checkpoint: ReadingCheckpoint | null,
  dismissedCheckpointVersion: string | null,
): boolean {
  if (checkpoint === null) return false;
  if (dismissedCheckpointVersion === null) return true;

  return getCheckpointVersion(checkpoint) !== dismissedCheckpointVersion;
}

function getCheckpointVersion(checkpoint: ReadingCheckpoint): string {
  return JSON.stringify([
    checkpoint.id,
    checkpoint.lastRead,
    checkpoint.currentSpineIndex,
    checkpoint.scrollProgress,
  ]);
}

/**
 * Converts a synced chapter checkpoint into the global page number used by the
 * paginated reader footer. The prompt stays hidden until chapter page starts
 * are known, which avoids showing a jump control before it has a real target.
 */
export function resolveHandoffCheckpointPage(
  checkpoint: ReadingCheckpoint,
  chapterStartPages: (number | null)[],
  totalPages: number,
): number | null {
  const chapterIndex = checkpoint.currentSpineIndex;
  const chapterStartPage = chapterStartPages[chapterIndex];
  if (chapterStartPage === null || chapterStartPage === undefined) return null;
  if (totalPages <= 0 || chapterStartPage > totalPages) return null;

  const nextChapterStartPage =
    chapterStartPages
      .slice(chapterIndex + 1)
      .find((startPage): startPage is number => startPage !== null) ?? null;
  const chapterEndExclusive = nextChapterStartPage ?? totalPages + 1;
  const chapterPageCount = chapterEndExclusive - chapterStartPage;
  if (chapterPageCount <= 0) return null;

  const progress = clampPercentage(checkpoint.scrollProgress);
  const localPageOffset = Math.round((progress / 100) * (chapterPageCount - 1));

  return Math.min(totalPages, chapterStartPage + localPageOffset);
}

/**
 * Derives the reader handoff prompt from the book's per-device checkpoints.
 *
 * React Query remains the source of truth for loading and invalidation. This
 * hook only captures the current device's checkpoint at session start, then
 * resolves a newer remote checkpoint into a jump prompt for the footer.
 */
export function useReaderHandoffPrompt({
  bookId,
  enabled = true,
  currentDeviceId: explicitCurrentDeviceId,
  sessionStartedAt: explicitSessionStartedAt,
  chapterStartPages,
  totalPages,
  currentPage,
  pagesShown = 1,
  onJumpToPage,
}: UseReaderHandoffPromptOptions): UseReaderHandoffPromptResult {
  const currentDeviceId = useCurrentDeviceId(explicitCurrentDeviceId);
  const sessionStartedAt = useStableSessionStartedAt(explicitSessionStartedAt);
  const checkpointsQuery = useReaderCheckpointsQuery(bookId, enabled);
  const checkpoints = enabled
    ? (checkpointsQuery.data?.checkpoints ?? EMPTY_READING_CHECKPOINTS)
    : EMPTY_READING_CHECKPOINTS;
  const [sessionStart, setSessionStart] =
    useState<ReaderHandoffSessionStart | null>(null);
  const [dismissedCheckpointVersion, setDismissedCheckpointVersion] = useState<
    string | null
  >(null);

  useEffect(() => {
    setSessionStart(null);
    setDismissedCheckpointVersion(null);
  }, [bookId, currentDeviceId, sessionStartedAt]);

  useEffect(() => {
    if (
      sessionStart !== null ||
      !enabled ||
      !bookId ||
      !currentDeviceId ||
      !checkpointsQuery.isSuccess
    ) {
      return;
    }

    setSessionStart(
      captureReaderHandoffSessionStart({
        bookId,
        checkpoints,
        currentDeviceId,
        startedAt: sessionStartedAt,
      }),
    );
  }, [
    bookId,
    checkpoints,
    checkpointsQuery.isSuccess,
    currentDeviceId,
    enabled,
    sessionStart,
    sessionStartedAt,
  ]);

  const latestUnreadCheckpoint = useMemo(() => {
    if (sessionStart === null) return null;

    return getLatestUnreadRemoteReadingCheckpoint(checkpoints, sessionStart);
  }, [checkpoints, sessionStart]);

  const promptState = useMemo<ReaderHandoffPromptState>(
    () => ({
      show: shouldShowPrompt(
        latestUnreadCheckpoint,
        dismissedCheckpointVersion,
      ),
      checkpoint: latestUnreadCheckpoint,
    }),
    [dismissedCheckpointVersion, latestUnreadCheckpoint],
  );

  const dismissPrompt = useCallback(() => {
    if (latestUnreadCheckpoint === null) return;

    setDismissedCheckpointVersion(getCheckpointVersion(latestUnreadCheckpoint));
  }, [latestUnreadCheckpoint]);

  const handoffTargetPage = useMemo(() => {
    if (
      latestUnreadCheckpoint === null ||
      chapterStartPages === undefined ||
      totalPages === undefined
    ) {
      return null;
    }

    return resolveHandoffCheckpointPage(
      latestUnreadCheckpoint,
      chapterStartPages,
      totalPages,
    );
  }, [chapterStartPages, latestUnreadCheckpoint, totalPages]);

  // A position already on screen needs no prompt, then or later: the
  // reader is where the other device left off.
  const alreadyThere =
    handoffTargetPage !== null &&
    currentPage !== undefined &&
    handoffTargetPage >= currentPage &&
    handoffTargetPage < currentPage + pagesShown;
  useEffect(() => {
    if (alreadyThere) dismissPrompt();
  }, [alreadyThere, dismissPrompt]);

  // Named as Activity names it. The server is asked only once there is a
  // device to name; until then the remembered names serve.
  const names = useSyncDeviceNames({
    enabled: latestUnreadCheckpoint !== null,
  });
  const sourceDeviceId = latestUnreadCheckpoint?.deviceId ?? null;
  const source = useMemo(() => {
    const { words, type } = names.pill(sourceDeviceId);
    return { words, type };
  }, [names, sourceDeviceId]);

  const prompt = useMemo<ReaderHandoffPrompt | undefined>(() => {
    if (
      !promptState.show ||
      alreadyThere ||
      handoffTargetPage === null ||
      onJumpToPage === undefined
    ) {
      return undefined;
    }

    return {
      source,
      targetPage: handoffTargetPage,
      onJump: () => {
        onJumpToPage(handoffTargetPage);
        dismissPrompt();
      },
      onDismiss: dismissPrompt,
    };
  }, [
    alreadyThere,
    dismissPrompt,
    handoffTargetPage,
    onJumpToPage,
    promptState,
    source,
  ]);

  return {
    promptState,
    prompt,
    dismissPrompt,
  };
}
