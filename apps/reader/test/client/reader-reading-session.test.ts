import {
  readerSessionGapMs,
  readerSessionPosition,
  useReaderReadingSession,
} from "@/features/reader/hooks/reading-sessions/use-reader-reading-session";
import { readerLocationFromSpread } from "@/features/reader/reader-location";
import { updateCurrentDeviceReadingSession } from "@/lib/db";
import type { ResolvedSpread, SpreadIntent } from "@/lib/pagination-v2";
import { CHECKPOINT_MS } from "@workbench/activity-time";
import { widthClass } from "@workbench/elements/size-class";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  updateCurrentDeviceReadingSession: vi.fn(() => Promise.resolve("session-id")),
}));

const mockedUpdateSession = vi.mocked(updateCurrentDeviceReadingSession);

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

const forward: SpreadIntent = { kind: "linear", direction: "forward" };

async function flushReactWork(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 4; i++) await Promise.resolve();
  });
}

function setVisibilityState(value: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value,
  });
}

function wait(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe("reading session position", () => {
  it("is the leading page's spine item and chapter percentage", () => {
    const spread = makeSpread({
      intent: forward,
      chapterIndex: 4,
      currentPageInChapter: 3,
      totalPagesInChapter: 5,
    });

    expect(readerSessionPosition(readerLocationFromSpread(spread)!)).toEqual({
      spineIndex: 4,
      progress: 50,
    });
  });
});

interface Size {
  width: number;
  height: number;
}

/**
 * Answers the size-class media queries and `screen` as a device would: a
 * touch screen or not, its screen, and the window on it.
 */
function useDevice(device: { touch: boolean; screen: Size; window: Size }) {
  vi.stubGlobal("screen", device.screen);
  vi.stubGlobal("matchMedia", (query: string) => {
    const size = /^\((width|height) (<|>=) (\d+)px\)$/.exec(query);
    let matches = query === "(any-pointer: coarse)" && device.touch;
    if (size) {
      const value = device.window[size[1] as keyof Size];
      matches = size[2] === "<" ? value < +size[3] : value >= +size[3];
    }
    return {
      matches,
      media: query,
      addEventListener() {},
      removeEventListener() {},
    };
  });
}

const PHONE = { width: 390, height: 844 };
const PHONE_TURNED = { width: 844, height: 390 };
const IPAD = { width: 820, height: 1180 };

describe("reading session gap", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    [
      "a phone",
      { touch: true, screen: PHONE, window: PHONE },
      "compact",
      180_000,
    ],
    [
      "a phone on its side",
      {
        touch: true,
        screen: PHONE_TURNED,
        window: { width: 844, height: 340 },
      },
      "expanded",
      180_000,
    ],
    [
      "a tablet",
      { touch: true, screen: IPAD, window: IPAD },
      "medium",
      300_000,
    ],
    [
      "an iPad window beside another app",
      { touch: true, screen: IPAD, window: { width: 500, height: 1180 } },
      "compact",
      300_000,
    ],
    [
      "a desktop",
      {
        touch: false,
        screen: { width: 1440, height: 900 },
        window: { width: 1280, height: 800 },
      },
      "expanded",
      300_000,
    ],
  ] as const)(
    "on %s follows the device, not the window",
    (_device, device, windowClass, gapMs) => {
      useDevice(device);
      // The window's own class can say otherwise; the gap does not follow it.
      expect(widthClass()).toBe(windowClass);
      expect(readerSessionGapMs()).toBe(gapMs);
    },
  );
});

describe("useReaderReadingSession", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-25T00:00:00.000Z"));
    mockedUpdateSession.mockReset();
    mockedUpdateSession.mockResolvedValue("session-id");
    setVisibilityState("visible");
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("ignores scrubber preview spreads", async () => {
    renderHook(() =>
      useReaderReadingSession({
        bookId: "book-1",
        spread: makeSpread({ intent: { kind: "preview", source: "scrubber" } }),
      }),
    );
    await flushReactWork();
    wait(CHECKPOINT_MS);
    await flushReactWork();

    expect(mockedUpdateSession).not.toHaveBeenCalled();
  });

  it("creates the row at the first real spread and saves only changes", async () => {
    renderHook(() =>
      useReaderReadingSession({
        bookId: "book-1",
        spread: makeSpread({
          intent: { kind: "restore" },
          chapterIndex: 3,
          currentPageInChapter: 3,
          totalPagesInChapter: 5,
        }),
      }),
    );
    await flushReactWork();

    expect(mockedUpdateSession).toHaveBeenCalledTimes(1);
    expect(mockedUpdateSession).toHaveBeenLastCalledWith(
      expect.objectContaining({
        bookId: "book-1",
        startedAt: Date.now(),
        endedAt: null,
        activeMs: 0,
        startSpineIndex: 3,
        startScrollProgress: 50,
        endSpineIndex: 3,
        endScrollProgress: 50,
      }),
    );

    wait(CHECKPOINT_MS);
    await flushReactWork();
    expect(mockedUpdateSession).toHaveBeenCalledTimes(1);
  });

  it("counts browser input and page turns, and discards a quiet stretch longer than the gap", async () => {
    const { rerender } = renderHook(
      ({ spread }) => useReaderReadingSession({ bookId: "book-1", spread }),
      { initialProps: { spread: makeSpread({ intent: { kind: "restore" } }) } },
    );
    await flushReactWork();

    wait(60_000);
    act(() => {
      window.dispatchEvent(new Event("wheel"));
    });
    await flushReactWork();
    expect(mockedUpdateSession).toHaveBeenLastCalledWith(
      expect.objectContaining({ activeMs: 60_000, lastActiveAt: Date.now() }),
    );

    // A page turn after eleven quiet minutes counts nothing, but moves the end.
    wait(11 * 60_000);
    rerender({ spread: makeSpread({ intent: forward, chapterIndex: 4 }) });
    wait(30_000);
    rerender({ spread: makeSpread({ intent: forward, chapterIndex: 5 }) });
    wait(CHECKPOINT_MS);
    await flushReactWork();

    expect(mockedUpdateSession).toHaveBeenLastCalledWith(
      expect.objectContaining({
        activeMs: 90_000,
        startSpineIndex: 2,
        endSpineIndex: 5,
      }),
    );
  });

  it("saves when the page is hidden, and ends the row on unmount", async () => {
    const { unmount } = renderHook(() =>
      useReaderReadingSession({
        bookId: "book-1",
        spread: makeSpread({ intent: { kind: "restore" } }),
      }),
    );
    await flushReactWork();

    wait(60_000);
    act(() => {
      setVisibilityState("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await flushReactWork();

    expect(mockedUpdateSession).toHaveBeenLastCalledWith(
      expect.objectContaining({ endedAt: null, activeMs: 60_000 }),
    );

    unmount();
    await flushReactWork();

    expect(mockedUpdateSession).toHaveBeenLastCalledWith(
      expect.objectContaining({ endedAt: Date.now(), activeMs: 60_000 }),
    );
  });

  it("keeps each mounted reader's rows apart", async () => {
    const spread = makeSpread({ intent: { kind: "restore" } });
    renderHook(() => useReaderReadingSession({ bookId: "book-1", spread }));
    renderHook(() => useReaderReadingSession({ bookId: "book-1", spread }));
    await flushReactWork();

    const rows = mockedUpdateSession.mock.calls.map(([row]) => row);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.id)).size).toBe(2);
    expect(new Set(rows.map((row) => row.readerInstanceId)).size).toBe(2);
  });
});
