import { useReaderJumpHistory } from "@/features/reader/hooks/use-reader-jump-history";
import { READER_HISTORY_STORAGE_KEY } from "@/features/reader/data/jump-history-storage";
import { useReaderPaginationFeed } from "@/features/reader/hooks/use-reader-pagination-feed";
import type { ReaderChapterArtifactSubscriber } from "@/features/reader/data/reader-cache/hooks";
import { PaginationEngine } from "@/lib/pagination-v2/engine";
import { usePagination } from "@/lib/pagination-v2/use-pagination";
import type { Block, PaginationConfig } from "@/lib/pagination-v2/types";
import type {
  PaginationWorkerMessage,
  PaginationWorkerEventMessage,
} from "@/lib/pagination-v2/protocol";
import {
  acquirePaginationWorkerSession,
  PaginationWorkerService,
  type PaginationWorkerTransport,
} from "@/lib/pagination-v2/worker/pagination-worker-service";
import { act, cleanup, renderHook } from "@testing-library/react";
import { createElement, StrictMode, type ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock(
  "@/lib/pagination-v2/worker/pagination-worker-service",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/lib/pagination-v2/worker/pagination-worker-service")
    >()),
    acquirePaginationWorkerSession: vi.fn(),
  }),
);

// Exercise hook lifecycle and the real engine together; only worker transport
// is synchronous here. Browser coverage exercises the actual async worker.
class EngineWorker implements PaginationWorkerTransport {
  onmessage: PaginationWorkerTransport["onmessage"] = null;
  onerror: PaginationWorkerTransport["onerror"] = null;
  messages: PaginationWorkerMessage[] = [];
  generation = 0;
  engine = this.createEngine();
  terminate = vi.fn();
  createEngine() {
    return new PaginationEngine((event) => {
      this.onmessage?.({
        data: {
          sessionGeneration: this.generation,
          event: { ...event, epoch: 1 },
        },
      } as MessageEvent<PaginationWorkerEventMessage>);
    });
  }
  postMessage(message: PaginationWorkerMessage) {
    this.messages.push(message);
    if (message.type === "cancel") {
      this.engine = this.createEngine();
      return;
    }
    this.generation = message.sessionGeneration;
    for (const _step of this.engine.createWork(message.command)) {
      /* Drain layout work. */
    }
  }
}

const config: PaginationConfig = {
  fontConfig: {
    bodyFamily: "serif",
    headingFamily: "serif",
    codeFamily: "monospace",
    baseSizePx: 16,
  },
  layoutTheme: {
    baseFontSizePx: 16,
    lineHeightFactor: 1.5,
    paragraphSpacingFactor: 1,
    textAlign: "left",
  },
  viewport: { width: 680, height: 780 },
};
const entries = [
  { index: 0, spineItemId: "chapter", href: "chapter.xhtml", title: "Chapter" },
];
const blocks: Block[] = Array.from({ length: 5 }, (_, i): Block[] => [
  { type: "spacer", kind: "rule", id: `page-${i}` },
  { type: "page-break", id: `break-${i}` },
]).flat();
const initialLocation = {
  chapterIndex: 0,
  chapterProgress: 0,
  isRestore: true,
};
let worker: EngineWorker;
let listeners: Set<ReaderChapterArtifactSubscriber>;
let loaded: boolean;
const getChapterBlocks = () => (loaded ? blocks : null);
const subscribe = (listener: ReaderChapterArtifactSubscriber) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

function useReader({
  enabled = true,
  bookId = "book-a",
  paginationConfig = config,
} = {}) {
  const pagination = usePagination({ paginationConfig });
  useReaderPaginationFeed({
    pagination,
    enabled,
    bookId,
    chapterEntries: entries,
    initialLocation,
    getChapterBlocks,
    subscribe,
  });
  return pagination;
}
function initMessages() {
  return worker.messages.filter(
    (m) => m.type === "command" && m.command.type === "init",
  );
}

beforeEach(() => {
  worker = new EngineWorker();
  const service = new PaginationWorkerService(() => worker);
  vi.mocked(acquirePaginationWorkerSession).mockImplementation((handlers) =>
    service.acquireSession(handlers),
  );
  listeners = new Set();
  loaded = true;
});
afterEach(cleanup);

it.each([false, true])(
  "initializes a warm chapter only after acquiring its worker session (StrictMode: %s)",
  (strict) => {
    const reader = renderHook(() => useReader(), {
      wrapper: ({ children }: { children: ReactNode }) =>
        strict ? createElement(StrictMode, null, children) : children,
    });
    expect(reader.result.current.spread?.currentPage).toBe(1);
    expect(initMessages()).toHaveLength(1);
    expect(initMessages()[0]?.sessionGeneration).toBe(
      reader.result.current.sessionGeneration,
    );
    reader.unmount();
    expect(listeners.size).toBe(0);
    const reopened = renderHook(() => useReader());
    expect(initMessages()).toHaveLength(2);
    expect(reopened.result.current.spread?.currentPage).toBe(1);
  },
);

it("keeps the navigated anchor when measurement disables and reconnects the feed", () => {
  const reader = renderHook(useReader, {
    initialProps: { enabled: true, paginationConfig: config },
  });
  act(() => {
    reader.result.current.nextSpread();
    reader.result.current.nextSpread();
  });
  expect(reader.result.current.spread?.currentPage).toBe(3);
  const resized = { ...config, viewport: { width: 650, height: 680 } };
  reader.rerender({ enabled: false, paginationConfig: resized });
  expect(listeners.size).toBe(0);
  reader.rerender({ enabled: true, paginationConfig: resized });
  expect(listeners.size).toBe(1);
  expect(initMessages()).toHaveLength(1);
  expect(reader.result.current.spread?.currentPage).toBe(3);
  act(() => reader.result.current.nextSpread());
  expect(reader.result.current.spread?.currentPage).toBe(4);
});

it("initializes a different book within the same Reader instance", () => {
  const reader = renderHook(useReader, { initialProps: { bookId: "book-a" } });
  act(() => reader.result.current.nextSpread());
  reader.rerender({ bookId: "book-b" });
  expect(initMessages()).toHaveLength(2);
  expect(reader.result.current.spread?.currentPage).toBe(1);
});

it("waits for chapter artifacts and still accepts updates after reconnecting", () => {
  loaded = false;
  const reader = renderHook(useReader, { initialProps: { enabled: true } });
  expect(initMessages()).toHaveLength(0);
  const artifact = {
    chapterIndex: 0,
    entry: entries[0]!,
    blocks,
    source: { html: "", highlightedHtml: "" },
    highlightSignature: "",
  };
  act(() => {
    loaded = true;
    for (const listener of listeners)
      listener({ kind: "loaded", chapterIndex: 0, artifact });
  });
  expect(initMessages()).toHaveLength(1);
  act(() => reader.result.current.nextSpread());
  reader.rerender({ enabled: false });
  reader.rerender({ enabled: true });
  act(() => {
    for (const listener of listeners)
      listener({ kind: "updated", chapterIndex: 0, artifact });
  });
  expect(
    worker.messages.some(
      (m) => m.type === "command" && m.command.type === "updateChapter",
    ),
  ).toBe(true);
  expect(reader.result.current.spread?.currentPage).toBe(2);
  expect(initMessages()).toHaveLength(1);
});

it("connects confirmed worker navigation to a persisted trail and anchor returns", () => {
  localStorage.removeItem(READER_HISTORY_STORAGE_KEY);
  function useHistoryReader() {
    const history = useReaderJumpHistory("history-book", "source");
    const pagination = usePagination({
      paginationConfig: config,
      onLocationResolved: history.record,
    });
    useReaderPaginationFeed({
      pagination,
      bookId: "history-book",
      chapterEntries: entries,
      initialLocation: { ...initialLocation, anchor: history.initialAnchor },
      getChapterBlocks,
      subscribe,
    });
    return { pagination, history };
  }
  const reader = renderHook(useHistoryReader);
  const trail = () =>
    reader.result.current.history.state.entries.map(
      (entry) => entry.anchor.blockId,
    );
  const go = (
    page: number,
    source: "highlight" | "scrubber" | "internal-link",
  ) =>
    act(() =>
      reader.result.current.pagination.goToPage(page, {
        intent: { kind: "jump", source },
      }),
    );
  go(2, "highlight");
  go(3, "highlight");
  act(() => reader.result.current.pagination.nextSpread());
  act(() => reader.result.current.pagination.nextSpread());
  expect(trail()).toEqual(["page-0", "page-2", "page-4"]);
  act(() =>
    reader.result.current.history.go(
      "back",
      reader.result.current.pagination.goToAnchor,
    ),
  );
  expect(reader.result.current.pagination.spread?.currentPage).toBe(3);
  expect(reader.result.current.history.state.cursor).toBe(1);
  act(() =>
    reader.result.current.history.go(
      "forward",
      reader.result.current.pagination.goToAnchor,
    ),
  );
  expect(reader.result.current.pagination.spread?.currentPage).toBe(5);
  act(() =>
    reader.result.current.history.go(
      "back",
      reader.result.current.pagination.goToAnchor,
    ),
  );
  go(4, "scrubber");
  expect(trail()).toEqual(["page-0", "page-2", "page-3"]);
  const persisted = JSON.parse(
    localStorage.getItem(READER_HISTORY_STORAGE_KEY)!,
  )[0].history;
  expect(persisted).toEqual(reader.result.current.history.state);
  act(() =>
    reader.result.current.history.go(
      "back",
      reader.result.current.pagination.goToAnchor,
    ),
  );
  reader.unmount();
  const reopened = renderHook(useHistoryReader);
  expect(reopened.result.current.pagination.spread?.currentPage).toBe(3);
  expect(reopened.result.current.history.state.cursor).toBe(1);
  act(() =>
    reopened.result.current.history.go(
      "forward",
      reopened.result.current.pagination.goToAnchor,
    ),
  );
  expect(reopened.result.current.pagination.spread?.currentPage).toBe(4);
  const beforeFailure = reopened.result.current.history.state;
  act(() =>
    reopened.result.current.pagination.goToPage(10000, {
      intent: { kind: "jump", source: "highlight" },
    }),
  );
  expect(reopened.result.current.history.state).toBe(beforeFailure);
});

it("keeps histories isolated when the mounted Reader changes books", () => {
  localStorage.removeItem(READER_HISTORY_STORAGE_KEY);
  function useBookHistory({ bookId }: { bookId: string }) {
    const history = useReaderJumpHistory(bookId, "source");
    const pagination = usePagination({
      paginationConfig: config,
      sessionKey: bookId,
      onLocationResolved: history.record,
    });
    useReaderPaginationFeed({
      pagination,
      bookId,
      chapterEntries: entries,
      initialLocation: { ...initialLocation, anchor: history.initialAnchor },
      getChapterBlocks,
      subscribe,
    });
    return { history, pagination };
  }
  const reader = renderHook(useBookHistory, { initialProps: { bookId: "a" } });
  act(() =>
    reader.result.current.pagination.goToPage(3, {
      intent: { kind: "jump", source: "highlight" },
    }),
  );
  const savedA = reader.result.current.history.state;
  reader.rerender({ bookId: "b" });
  expect(reader.result.current.history.state.entries).toHaveLength(1);
  expect(reader.result.current.pagination.spread?.currentPage).toBe(1);
  act(() => reader.result.current.pagination.nextSpread());
  reader.rerender({ bookId: "a" });
  expect(reader.result.current.history.state).toEqual(savedA);
  expect(reader.result.current.pagination.spread?.currentPage).toBe(3);
  expect(initMessages()).toHaveLength(3);
});

it("keeps notebook and history page lookups independent", () => {
  const reader = renderHook(() => useReader());
  act(() => {
    reader.result.current.locateAnchors([
      {
        id: "note",
        anchor: { type: "block", chapterIndex: 0, blockId: "page-1" },
      },
    ]);
    reader.result.current.locateAnchors(
      [
        {
          id: "visit",
          anchor: { type: "block", chapterIndex: 0, blockId: "page-3" },
        },
      ],
      "history",
    );
  });
  expect(reader.result.current.anchorPages).toEqual({ note: 2 });
  expect(reader.result.current.anchorPagesByScope.history).toEqual({
    visit: 4,
  });
  act(() =>
    reader.result.current.locateAnchors([
      {
        id: "note",
        anchor: { type: "block", chapterIndex: 0, blockId: "page-2" },
      },
    ]),
  );
  expect(reader.result.current.anchorPages).toEqual({ note: 3 });
  expect(reader.result.current.anchorPagesByScope.history).toEqual({
    visit: 4,
  });
});
