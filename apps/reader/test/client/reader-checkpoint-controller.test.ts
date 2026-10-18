import {
  cleanup,
  renderHook as renderHookBase,
  act,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHECKPOINT_FLUSH_INTERVAL_MS,
  createReaderCheckpointSnapshot,
  createReaderCheckpointSnapshotFromLocation,
} from "@/features/reader/hooks/reader-checkpoint-controller";
import { readerLocationFromSpread } from "@/features/reader/reader-location";
import { useReaderCheckpointController } from "@/features/reader/hooks/use-reader-checkpoint-controller";
import { upsertCurrentDeviceReadingCheckpoint } from "@/lib/db";
import type { ResolvedSpread, SpreadIntent } from "@/lib/pagination-v2";

vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  upsertCurrentDeviceReadingCheckpoint: vi.fn(() =>
    Promise.resolve("checkpoint-id"),
  ),
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

let queryClient: QueryClient;
function renderHook<Result, Props>(
  callback: (props: Props) => Result,
  options?: { initialProps: Props },
) {
  return renderHookBase(callback, {
    ...options,
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children),
  });
}

const mockedUpsert = vi.mocked(upsertCurrentDeviceReadingCheckpoint);

function makeSpread(options: {
  intent: SpreadIntent;
  chapterIndex?: number;
  currentPageInChapter?: number;
  totalPagesInChapter?: number;
}): ResolvedSpread {
  const chapterIndex = options.chapterIndex ?? 2;
  const currentPageInChapter = options.currentPageInChapter ?? 1;
  const totalPagesInChapter = options.totalPagesInChapter ?? 5;

  return {
    slots: [
      {
        kind: "page",
        slotIndex: 0,
        page: {
          currentPage: currentPageInChapter,
          totalPages: 100,
          currentPageInChapter,
          totalPagesInChapter,
          chapterIndex,
          content: [],
        },
      },
    ],
    intent: options.intent,
    currentPage: currentPageInChapter,
    totalPages: 100,
    currentSpread: currentPageInChapter,
    totalSpreads: 100,
    chapterIndexStart: chapterIndex,
    chapterIndexEnd: chapterIndex,
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function flushReactWork(): Promise<void> {
  await act(async () => {
    await flushPromises();
  });
}

function setVisibilityState(value: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value,
  });
}

describe("reader checkpoint snapshot derivation", () => {
  it("derives a chapter-local percentage from the leading visible page", () => {
    const spread = makeSpread({
      intent: { kind: "linear", direction: "forward" },
      chapterIndex: 4,
      currentPageInChapter: 3,
      totalPagesInChapter: 5,
    });

    expect(createReaderCheckpointSnapshot("book-1", spread, false)).toEqual({
      bookId: "book-1",
      currentSpineIndex: 4,
      localPageIndex: 2,
      totalPagesInChapter: 5,
      scrollProgress: 50,
    });
  });

  it("adds whole-book progress only after the whole book is paginated", () => {
    const spread = makeSpread({
      intent: { kind: "linear", direction: "forward" },
      currentPageInChapter: 34,
      totalPagesInChapter: 40,
    });

    expect(
      createReaderCheckpointSnapshot("book-1", spread, true)?.bookProgress,
    ).toBeCloseTo(33 / 99);
    expect(
      createReaderCheckpointSnapshot("book-1", spread, false),
    ).not.toHaveProperty("bookProgress");
  });

  it("saves a scroll-mode location like the page that holds it", () => {
    const spread = makeSpread({
      intent: { kind: "linear", direction: "forward" },
      chapterIndex: 4,
      currentPageInChapter: 3,
      totalPagesInChapter: 5,
    });
    const anchor = {
      type: "block" as const,
      chapterIndex: 4,
      blockId: "p-12",
    };

    expect(
      createReaderCheckpointSnapshotFromLocation(
        "book-1",
        {
          chapterIndex: 4,
          pageIndexInChapter: 2,
          totalPagesInChapter: 5,
          currentPage: 3,
          totalPages: 100,
          anchor,
          intent: { kind: "linear", direction: "forward" },
        },
        true,
      ),
    ).toEqual(createReaderCheckpointSnapshot("book-1", spread, true));
    expect(readerLocationFromSpread(spread, anchor)?.anchor).toBe(anchor);
  });

  it("returns null without a book id or visible page", () => {
    const spread = makeSpread({
      intent: { kind: "linear", direction: "forward" },
    });

    expect(createReaderCheckpointSnapshot(undefined, spread, true)).toBeNull();
    expect(
      createReaderCheckpointSnapshot("book-1", { ...spread, slots: [] }, true),
    ).toBeNull();
  });
});

describe("useReaderCheckpointController", () => {
  beforeEach(() => {
    queryClient = new QueryClient();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-25T00:00:00.000Z"));
    mockedUpsert.mockReset();
    mockedUpsert.mockResolvedValue("checkpoint-id");
    setVisibilityState("visible");
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    vi.useRealTimers();
  });

  it("ignores scrubber preview spreads", async () => {
    renderHook(() =>
      useReaderCheckpointController({
        bookId: "book-1",
        isFullyPaginated: false,
        spread: makeSpread({ intent: { kind: "preview", source: "scrubber" } }),
      }),
    );

    await flushReactWork();

    act(() => {
      vi.advanceTimersByTime(CHECKPOINT_FLUSH_INTERVAL_MS);
    });

    expect(mockedUpsert).not.toHaveBeenCalled();
  });

  it("persists committed linear navigation immediately without duplicating the same page", async () => {
    const { rerender } = renderHook(
      ({ spread }) =>
        useReaderCheckpointController({
          bookId: "book-1",
          spread,
        }),
      {
        initialProps: {
          spread: makeSpread({
            intent: { kind: "linear", direction: "forward" },
            chapterIndex: 3,
            currentPageInChapter: 3,
            totalPagesInChapter: 5,
          }),
        },
      },
    );

    await flushReactWork();

    expect(mockedUpsert).toHaveBeenCalledTimes(1);
    expect(mockedUpsert.mock.calls.at(-1)?.[0]).toEqual({
      bookId: "book-1",
      currentSpineIndex: 3,
      scrollProgress: 50,
      lastRead: Date.now(),
    });

    rerender({
      spread: makeSpread({
        intent: { kind: "linear", direction: "forward" },
        chapterIndex: 3,
        currentPageInChapter: 3,
        totalPagesInChapter: 5,
      }),
    });
    await flushReactWork();

    expect(mockedUpsert).toHaveBeenCalledTimes(1);
  });

  it("persists committed jump navigation immediately", async () => {
    renderHook(() =>
      useReaderCheckpointController({
        bookId: "book-1",
        isFullyPaginated: false,
        spread: makeSpread({
          intent: { kind: "jump", source: "chapter" },
          chapterIndex: 4,
        }),
      }),
    );

    await flushReactWork();

    expect(mockedUpsert).toHaveBeenCalledTimes(1);
    expect(mockedUpsert.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        bookId: "book-1",
        currentSpineIndex: 4,
      }),
    );
  });

  it("flushes restore snapshots on the periodic interval", async () => {
    renderHook(() =>
      useReaderCheckpointController({
        bookId: "book-1",
        isFullyPaginated: false,
        spread: makeSpread({ intent: { kind: "restore" } }),
      }),
    );

    await flushReactWork();
    expect(mockedUpsert).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(CHECKPOINT_FLUSH_INTERVAL_MS - 1);
    });
    expect(mockedUpsert).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    await flushReactWork();

    expect(mockedUpsert).toHaveBeenCalledTimes(1);
  });

  it("flushes the latest snapshot when the document becomes hidden", async () => {
    renderHook(() =>
      useReaderCheckpointController({
        bookId: "book-1",
        isFullyPaginated: false,
        spread: makeSpread({ intent: { kind: "restore" } }),
      }),
    );

    await flushReactWork();
    expect(mockedUpsert).not.toHaveBeenCalled();

    act(() => {
      setVisibilityState("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await flushReactWork();

    expect(mockedUpsert).toHaveBeenCalledTimes(1);
  });

  it("flushes the latest snapshot on pagehide", async () => {
    renderHook(() =>
      useReaderCheckpointController({
        bookId: "book-1",
        isFullyPaginated: false,
        spread: makeSpread({ intent: { kind: "restore" } }),
      }),
    );

    await flushReactWork();
    expect(mockedUpsert).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    await flushReactWork();

    expect(mockedUpsert).toHaveBeenCalledTimes(1);
  });

  it("flushes the latest snapshot on unmount", async () => {
    const { unmount } = renderHook(() =>
      useReaderCheckpointController({
        bookId: "book-1",
        isFullyPaginated: false,
        spread: makeSpread({ intent: { kind: "restore" } }),
      }),
    );

    await flushReactWork();
    expect(mockedUpsert).not.toHaveBeenCalled();

    unmount();
    await flushReactWork();

    expect(mockedUpsert).toHaveBeenCalledTimes(1);
  });
});
