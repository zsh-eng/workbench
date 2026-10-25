import { useReaderCheckpointQuery } from "@/features/reader/data/reader-cache/hooks";
import {
  readerCheckpointKeys,
  type ReaderCheckpointData,
} from "@/features/reader/data/reader-cache/queries";
import { useReaderCheckpointController } from "@/features/reader/hooks/use-reader-checkpoint-controller";
import { useSessionInitialReaderLocation } from "@/features/reader/hooks/use-session-initial-reader-location";
import * as database from "@/lib/db";
import type { ResolvedSpread } from "@/lib/pagination-v2";
import { syncV2Db } from "@/lib/sync-v2/db";
import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const bookId = "resume-book";
const queryKey = readerCheckpointKeys.currentDevice(bookId);
let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client }, children);
}

function spread(
  page: number,
  preview = false,
  pagesInChapter = 5,
): ResolvedSpread {
  return {
    intent: preview
      ? { kind: "preview", source: "scrubber" }
      : { kind: "linear", direction: "forward" },
    currentPage: page,
    totalPages: 5,
    currentSpread: page,
    totalSpreads: 5,
    chapterIndexStart: 2,
    chapterIndexEnd: 2,
    slots: [
      {
        kind: "page",
        slotIndex: 0,
        page: {
          chapterIndex: 2,
          currentPage: page,
          totalPages: 5,
          currentPageInChapter: page,
          totalPagesInChapter: pagesInChapter,
          content: [],
        },
      },
    ],
  };
}

function openReader() {
  return renderHook(
    () => {
      const query = useReaderCheckpointQuery(bookId);
      return useSessionInitialReaderLocation({
        bookId,
        totalChapters: 10,
        checkpoint: query.data?.checkpoint,
        checkpointReady: query.isSuccess,
      });
    },
    { wrapper },
  );
}

beforeEach(async () => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await syncV2Db.open();
  await database.upsertCurrentDeviceReadingCheckpoint({
    bookId,
    currentSpineIndex: 0,
    scrollProgress: 0,
    lastRead: 1,
  });
  await client.fetchQuery({
    queryKey,
    queryFn: async () => ({
      checkpoint: await database.getCurrentDeviceReadingCheckpoint(bookId),
    }),
    staleTime: Infinity,
  });
});

afterEach(async () => {
  cleanup();
  onlineManager.setOnline(true);
  await waitFor(() => expect(client.isMutating()).toBe(0));
  vi.restoreAllMocks();
  client.clear();
  await syncV2Db.delete();
});

it("keeps chapter progress under 1% as a percentage", async () => {
  // Page 2 of a 201-page chapter is 0.5% through it, not half way.
  const writer = renderHook(
    () =>
      useReaderCheckpointController({
        bookId,
        spread: spread(2, false, 201),
      }),
    { wrapper },
  );
  await waitFor(async () => {
    expect(
      await database.getCurrentDeviceReadingCheckpoint(bookId),
    ).toMatchObject({ currentSpineIndex: 2, scrollProgress: 0.5 });
  });
  writer.unmount();
  expect(openReader().result.current).toEqual({
    chapterIndex: 2,
    chapterProgress: 0.5,
    isRestore: true,
  });
});

it("reopens at the committed location with a warm cache and durable checkpoint", async () => {
  const opening = openReader();
  expect(opening.result.current?.chapterIndex).toBe(0);
  const writer = renderHook(
    () => useReaderCheckpointController({ bookId, spread: spread(3) }),
    { wrapper },
  );
  await waitFor(async () => {
    expect(
      await database.getCurrentDeviceReadingCheckpoint(bookId),
    ).toMatchObject({ currentSpineIndex: 2, scrollProgress: 50 });
  });
  // Writes must not change the active session's immutable opening location.
  expect(opening.result.current?.chapterIndex).toBe(0);
  writer.unmount();
  opening.unmount();
  expect(openReader().result.current).toEqual({
    chapterIndex: 2,
    chapterProgress: 50,
    isRestore: true,
  });
});

it("reopens at the newest queued position without an older save or read rolling it back", async () => {
  const persist = database.upsertCurrentDeviceReadingCheckpoint;
  let finishSave!: () => void;
  const gate = new Promise<void>((resolve) => {
    finishSave = resolve;
  });
  vi.spyOn(
    database,
    "upsertCurrentDeviceReadingCheckpoint",
  ).mockImplementationOnce(async (checkpoint) => {
    await gate;
    return persist(checkpoint);
  });
  const staleCheckpoint =
    await database.getCurrentDeviceReadingCheckpoint(bookId);
  let finishRead!: () => void;
  const staleRead = client
    .fetchQuery({
      queryKey,
      queryFn: () =>
        new Promise<ReaderCheckpointData>((resolve) => {
          finishRead = () => resolve({ checkpoint: staleCheckpoint });
        }),
      staleTime: 0,
    })
    .catch(() => undefined);
  const writer = renderHook(
    ({ page, preview }) =>
      useReaderCheckpointController({ bookId, spread: spread(page, preview) }),
    {
      wrapper,
      initialProps: { page: 2, preview: false },
    },
  );
  writer.rerender({ page: 4, preview: false });
  writer.rerender({ page: 5, preview: true });
  writer.unmount();
  const reopened = openReader();
  expect(reopened.result.current).toEqual({
    chapterIndex: 2,
    chapterProgress: 75,
    isRestore: true,
  });
  expect(
    await database.getCurrentDeviceReadingCheckpoint(bookId),
  ).toMatchObject({ currentSpineIndex: 0 });
  await act(async () => {
    finishRead();
    await staleRead;
    finishSave();
  });
  await waitFor(async () => {
    expect(
      await database.getCurrentDeviceReadingCheckpoint(bookId),
    ).toMatchObject({ currentSpineIndex: 2, scrollProgress: 75 });
  });
  expect(
    client.getQueryData<ReaderCheckpointData>(queryKey)?.checkpoint
      ?.scrollProgress,
  ).toBe(75);
  expect(reopened.result.current?.chapterProgress).toBe(75);
});

it("serializes durable writes across Reader mounts while every request updates memory immediately", async () => {
  const persist = database.upsertCurrentDeviceReadingCheckpoint;
  let finishFirstSave!: () => void;
  const gate = new Promise<void>((resolve) => {
    finishFirstSave = resolve;
  });
  const saves = vi
    .spyOn(database, "upsertCurrentDeviceReadingCheckpoint")
    .mockImplementationOnce(async (checkpoint) => {
      await gate;
      return persist(checkpoint);
    });
  const first = renderHook(
    ({ page }) =>
      useReaderCheckpointController({ bookId, spread: spread(page) }),
    {
      wrapper,
      initialProps: { page: 2 },
    },
  );
  first.rerender({ page: 3 });
  first.rerender({ page: 4 });
  first.unmount();
  renderHook(
    () => useReaderCheckpointController({ bookId, spread: spread(5) }),
    { wrapper },
  );
  expect(
    client.getQueryData<ReaderCheckpointData>(queryKey)?.checkpoint
      ?.scrollProgress,
  ).toBe(100);
  await waitFor(() => expect(saves).toHaveBeenCalledTimes(1));
  await act(async () => {
    finishFirstSave();
  });
  await waitFor(() => expect(client.isMutating()).toBe(0));
  expect(
    saves.mock.calls.map(([checkpoint]) => checkpoint.scrollProgress),
  ).toEqual([25, 50, 75, 100]);
  expect(
    await database.getCurrentDeviceReadingCheckpoint(bookId),
  ).toMatchObject({ scrollProgress: 100 });
});

it("persists optimistically requested checkpoints while offline", async () => {
  onlineManager.setOnline(false);
  renderHook(
    () => useReaderCheckpointController({ bookId, spread: spread(3) }),
    { wrapper },
  );
  expect(
    client.getQueryData<ReaderCheckpointData>(queryKey)?.checkpoint
      ?.scrollProgress,
  ).toBe(50);
  await waitFor(async () => {
    expect(
      await database.getCurrentDeviceReadingCheckpoint(bookId),
    ).toMatchObject({ scrollProgress: 50 });
  });
});

it("retains the in-memory position after a storage failure and retries on the next flush", async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(
    database,
    "upsertCurrentDeviceReadingCheckpoint",
  ).mockRejectedValueOnce(new Error("storage temporarily unavailable"));
  const currentSpread = spread(3);
  renderHook(
    () => useReaderCheckpointController({ bookId, spread: currentSpread }),
    { wrapper },
  );
  await waitFor(() => expect(client.isMutating()).toBe(0));
  expect(
    client.getQueryData<ReaderCheckpointData>(queryKey)?.checkpoint
      ?.scrollProgress,
  ).toBe(50);
  expect(
    await database.getCurrentDeviceReadingCheckpoint(bookId),
  ).toMatchObject({ currentSpineIndex: 0 });
  act(() => window.dispatchEvent(new Event("pagehide")));
  await waitFor(async () => {
    expect(
      await database.getCurrentDeviceReadingCheckpoint(bookId),
    ).toMatchObject({ currentSpineIndex: 2, scrollProgress: 50 });
  });
});
