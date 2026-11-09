import {
  captureReaderHandoffSessionStart,
  getLatestRemoteReadingCheckpoint,
  getLatestUnreadRemoteReadingCheckpoint,
  resolveHandoffCheckpointPage,
  useReaderHandoffPrompt,
} from "@/features/reader/hooks/use-reader-handoff-prompt";
import {
  readerCheckpointKeys,
  type ReaderCheckpointsData,
} from "@/features/reader/data/reader-cache/queries";
import type { ReadingCheckpoint } from "@/lib/db";
import {
  QueryClient,
  QueryClientProvider,
  type QueryClient as QueryClientType,
} from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Activity's namer, with one device it knows.
const namer = vi.hoisted(() => ({
  enabled: [] as boolean[],
  pill: (deviceId: string | null) =>
    deviceId === "device-remote"
      ? { words: "your iPad", type: "tablet" as const, here: false }
      : { words: "another device", type: null, here: false },
}));
vi.mock("@/features/sync-history/device-names", () => ({
  useSyncDeviceNames: ({ enabled = true }: { enabled?: boolean } = {}) => {
    namer.enabled.push(enabled);
    return { pill: namer.pill };
  },
}));

const BOOK_ID = "book-1";
const CURRENT_DEVICE_ID = "device-current";
const SESSION_STARTED_AT = 1_800_000_000_000;

function makeCheckpoint(
  overrides: Partial<ReadingCheckpoint> = {},
): ReadingCheckpoint {
  const bookId = overrides.bookId ?? BOOK_ID;
  const deviceId = overrides.deviceId ?? CURRENT_DEVICE_ID;

  return {
    id: `resume:${deviceId}:${bookId}`,
    bookId,
    deviceId,
    currentSpineIndex: 1,
    scrollProgress: 25,
    lastRead: 1000,
    ...overrides,
  };
}

function createQueryClient(): QueryClientType {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
}

function createWrapper(queryClient: QueryClientType) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  };
}

function setCheckpoints(
  queryClient: QueryClientType,
  checkpoints: ReadingCheckpoint[],
): void {
  queryClient.setQueryData<ReaderCheckpointsData>(
    readerCheckpointKeys.book(BOOK_ID),
    { checkpoints },
  );
}

afterEach(() => {
  cleanup();
});

describe("reader handoff checkpoint helpers", () => {
  it("selects the newest remote checkpoint by last-read time", () => {
    const olderRemote = makeCheckpoint({
      deviceId: "device-remote-a",
      lastRead: 1000,
    });
    const newerRemote = makeCheckpoint({
      deviceId: "device-remote-b",
      lastRead: 1001,
    });

    expect(
      getLatestRemoteReadingCheckpoint(
        [makeCheckpoint({ lastRead: 1002 }), olderRemote, newerRemote],
        CURRENT_DEVICE_ID,
      ),
    ).toBe(newerRemote);
  });

  it("ignores remote checkpoints that are not newer than the session-start current device checkpoint", () => {
    const currentCheckpoint = makeCheckpoint({
      lastRead: 1002,
    });
    const remoteCheckpoint = makeCheckpoint({
      deviceId: "device-remote",
      lastRead: 1001,
    });
    const sessionStart = captureReaderHandoffSessionStart({
      bookId: BOOK_ID,
      checkpoints: [currentCheckpoint, remoteCheckpoint],
      currentDeviceId: CURRENT_DEVICE_ID,
      startedAt: SESSION_STARTED_AT,
    });

    expect(
      getLatestUnreadRemoteReadingCheckpoint(
        [currentCheckpoint, remoteCheckpoint],
        sessionStart,
      ),
    ).toBeNull();
  });

  it("returns the latest remote checkpoint when it is newer than the session-start current device checkpoint", () => {
    const currentCheckpoint = makeCheckpoint({
      lastRead: 1000,
    });
    const remoteCheckpoint = makeCheckpoint({
      deviceId: "device-remote",
      lastRead: 1001,
    });
    const sessionStart = captureReaderHandoffSessionStart({
      bookId: BOOK_ID,
      checkpoints: [currentCheckpoint, remoteCheckpoint],
      currentDeviceId: CURRENT_DEVICE_ID,
      startedAt: SESSION_STARTED_AT,
    });

    expect(
      getLatestUnreadRemoteReadingCheckpoint(
        [currentCheckpoint, remoteCheckpoint],
        sessionStart,
      ),
    ).toBe(remoteCheckpoint);
  });

  it("resolves a checkpoint scroll progress to a global reader page", () => {
    const checkpoint = makeCheckpoint({
      currentSpineIndex: 1,
      scrollProgress: 50,
    });

    expect(resolveHandoffCheckpointPage(checkpoint, [1, 11, 21], 30)).toBe(16);
  });

  it("waits for chapter page starts before resolving the handoff page", () => {
    const checkpoint = makeCheckpoint({
      currentSpineIndex: 2,
      scrollProgress: 50,
    });

    expect(
      resolveHandoffCheckpointPage(checkpoint, [1, 11, null], 30),
    ).toBeNull();
  });
});

describe("useReaderHandoffPrompt", () => {
  it("defers cached handoff data until the query is enabled", async () => {
    const queryClient = createQueryClient();
    const currentCheckpoint = makeCheckpoint({
      lastRead: 1000,
    });
    const remoteCheckpoint = makeCheckpoint({
      deviceId: "device-remote",
      lastRead: 1001,
    });
    setCheckpoints(queryClient, [currentCheckpoint, remoteCheckpoint]);

    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useReaderHandoffPrompt({
          bookId: BOOK_ID,
          enabled,
          currentDeviceId: CURRENT_DEVICE_ID,
          sessionStartedAt: SESSION_STARTED_AT,
        }),
      {
        initialProps: { enabled: false },
        wrapper: createWrapper(queryClient),
      },
    );

    expect(result.current.promptState.show).toBe(false);
    rerender({ enabled: true });

    await waitFor(() => {
      expect(result.current.promptState.show).toBe(true);
    });

    queryClient.clear();
  });

  it("shows an initial remote checkpoint that is newer than the session-start current device checkpoint", async () => {
    const queryClient = createQueryClient();
    const currentCheckpoint = makeCheckpoint({
      lastRead: 1000,
    });
    const remoteCheckpoint = makeCheckpoint({
      deviceId: "device-remote",
      currentSpineIndex: 4,
      scrollProgress: 75,
      lastRead: 1001,
    });
    setCheckpoints(queryClient, [currentCheckpoint, remoteCheckpoint]);

    const { result } = renderHook(
      () =>
        useReaderHandoffPrompt({
          bookId: BOOK_ID,
          currentDeviceId: CURRENT_DEVICE_ID,
          sessionStartedAt: SESSION_STARTED_AT,
        }),
      { wrapper: createWrapper(queryClient) },
    );

    await waitFor(() => {
      expect(result.current.promptState.show).toBe(true);
    });
    expect(result.current.promptState.checkpoint).toBe(remoteCheckpoint);

    queryClient.clear();
  });

  it("returns a jump prompt once the checkpoint page can be resolved", async () => {
    const queryClient = createQueryClient();
    const currentCheckpoint = makeCheckpoint({
      lastRead: 1000,
    });
    const remoteCheckpoint = makeCheckpoint({
      deviceId: "device-remote",
      currentSpineIndex: 1,
      scrollProgress: 50,
      lastRead: 1001,
    });
    const onJumpToPage = vi.fn();
    setCheckpoints(queryClient, [currentCheckpoint, remoteCheckpoint]);

    const { result } = renderHook(
      () =>
        useReaderHandoffPrompt({
          bookId: BOOK_ID,
          currentDeviceId: CURRENT_DEVICE_ID,
          sessionStartedAt: SESSION_STARTED_AT,
          chapterStartPages: [1, 11, 21],
          totalPages: 30,
          onJumpToPage,
        }),
      { wrapper: createWrapper(queryClient) },
    );

    await waitFor(() => {
      expect(result.current.prompt?.targetPage).toBe(16);
    });
    expect(result.current.prompt?.source).toEqual({
      words: "your iPad",
      type: "tablet",
    });

    act(() => {
      result.current.prompt?.onJump();
    });

    expect(onJumpToPage).toHaveBeenCalledWith(16);
    expect(result.current.promptState.show).toBe(false);
    expect(result.current.prompt).toBeUndefined();

    queryClient.clear();
  });

  it("asks for device names only once another device has a newer position", async () => {
    const queryClient = createQueryClient();
    const currentCheckpoint = makeCheckpoint({ lastRead: 1000 });
    setCheckpoints(queryClient, [currentCheckpoint]);
    namer.enabled.length = 0;

    const { result } = renderHook(
      () =>
        useReaderHandoffPrompt({
          bookId: BOOK_ID,
          currentDeviceId: CURRENT_DEVICE_ID,
          sessionStartedAt: SESSION_STARTED_AT,
        }),
      { wrapper: createWrapper(queryClient) },
    );
    await waitFor(() => {
      expect(namer.enabled.length).toBeGreaterThan(0);
    });
    expect(namer.enabled).not.toContain(true);

    act(() => {
      setCheckpoints(queryClient, [
        currentCheckpoint,
        makeCheckpoint({ deviceId: "device-remote", lastRead: 1001 }),
      ]);
    });
    await waitFor(() => {
      expect(result.current.promptState.show).toBe(true);
    });
    expect(namer.enabled.at(-1)).toBe(true);

    queryClient.clear();
  });

  it("offers no jump to the spread already on screen, then or after the reader moves on", async () => {
    const queryClient = createQueryClient();
    setCheckpoints(queryClient, [
      makeCheckpoint({ lastRead: 1000 }),
      makeCheckpoint({
        deviceId: "device-remote",
        currentSpineIndex: 1,
        scrollProgress: 50,
        lastRead: 1001,
      }),
    ]);

    // Page 16 is the right-hand page of the spread at 15.
    const { result, rerender } = renderHook(
      ({ currentPage }: { currentPage: number }) =>
        useReaderHandoffPrompt({
          bookId: BOOK_ID,
          currentDeviceId: CURRENT_DEVICE_ID,
          sessionStartedAt: SESSION_STARTED_AT,
          chapterStartPages: [1, 11, 21],
          totalPages: 30,
          currentPage,
          pagesShown: 2,
          onJumpToPage: vi.fn(),
        }),
      {
        initialProps: { currentPage: 15 },
        wrapper: createWrapper(queryClient),
      },
    );

    await waitFor(() => {
      expect(result.current.promptState.checkpoint).not.toBeNull();
    });
    await waitFor(() => {
      expect(result.current.promptState.show).toBe(false);
    });
    expect(result.current.prompt).toBeUndefined();

    rerender({ currentPage: 17 });
    expect(result.current.prompt).toBeUndefined();

    queryClient.clear();
  });

  it("offers the jump from another spread", async () => {
    const queryClient = createQueryClient();
    setCheckpoints(queryClient, [
      makeCheckpoint({ lastRead: 1000 }),
      makeCheckpoint({
        deviceId: "device-remote",
        currentSpineIndex: 1,
        scrollProgress: 50,
        lastRead: 1001,
      }),
    ]);

    const { result } = renderHook(
      () =>
        useReaderHandoffPrompt({
          bookId: BOOK_ID,
          currentDeviceId: CURRENT_DEVICE_ID,
          sessionStartedAt: SESSION_STARTED_AT,
          chapterStartPages: [1, 11, 21],
          totalPages: 30,
          currentPage: 13,
          pagesShown: 2,
          onJumpToPage: vi.fn(),
        }),
      { wrapper: createWrapper(queryClient) },
    );

    await waitFor(() => {
      expect(result.current.prompt?.targetPage).toBe(16);
    });

    queryClient.clear();
  });

  it("keeps a dismissed prompt hidden until a strictly newer remote checkpoint arrives", async () => {
    const queryClient = createQueryClient();
    const currentCheckpoint = makeCheckpoint({
      lastRead: 1000,
    });
    const remoteCheckpoint = makeCheckpoint({
      deviceId: "device-remote",
      lastRead: 1001,
    });
    setCheckpoints(queryClient, [currentCheckpoint, remoteCheckpoint]);

    const { result } = renderHook(
      () =>
        useReaderHandoffPrompt({
          bookId: BOOK_ID,
          currentDeviceId: CURRENT_DEVICE_ID,
          sessionStartedAt: SESSION_STARTED_AT,
        }),
      { wrapper: createWrapper(queryClient) },
    );

    await waitFor(() => {
      expect(result.current.promptState.show).toBe(true);
    });

    act(() => {
      result.current.dismissPrompt();
    });
    expect(result.current.promptState.show).toBe(false);

    act(() => {
      setCheckpoints(queryClient, [
        currentCheckpoint,
        {
          ...remoteCheckpoint,
          lastRead: remoteCheckpoint.lastRead + 1,
        },
      ]);
    });
    expect(result.current.promptState.show).toBe(false);

    const newerRemoteCheckpoint = makeCheckpoint({
      deviceId: "device-remote",
      currentSpineIndex: 5,
      lastRead: 1002,
    });
    act(() => {
      setCheckpoints(queryClient, [currentCheckpoint, newerRemoteCheckpoint]);
    });

    await waitFor(() => {
      expect(result.current.promptState.show).toBe(true);
    });
    expect(result.current.promptState.checkpoint).toEqual(
      newerRemoteCheckpoint,
    );

    queryClient.clear();
  });

  it("does not move the session-start baseline when the current device checkpoint updates", async () => {
    const queryClient = createQueryClient();
    const sessionStartCheckpoint = makeCheckpoint({
      lastRead: 1000,
    });
    setCheckpoints(queryClient, [sessionStartCheckpoint]);

    const { result } = renderHook(
      () =>
        useReaderHandoffPrompt({
          bookId: BOOK_ID,
          currentDeviceId: CURRENT_DEVICE_ID,
          sessionStartedAt: SESSION_STARTED_AT,
        }),
      { wrapper: createWrapper(queryClient) },
    );

    await waitFor(() => {
      expect(result.current.promptState.show).toBe(false);
    });

    const laterCurrentCheckpoint = makeCheckpoint({
      lastRead: 1003,
    });
    const remoteAfterSessionStart = makeCheckpoint({
      deviceId: "device-remote",
      lastRead: 1002,
    });
    act(() => {
      setCheckpoints(queryClient, [
        laterCurrentCheckpoint,
        remoteAfterSessionStart,
      ]);
    });

    await waitFor(() => {
      expect(result.current.promptState.show).toBe(true);
    });
    expect(result.current.promptState.checkpoint).toEqual(
      remoteAfterSessionStart,
    );

    queryClient.clear();
  });
});
