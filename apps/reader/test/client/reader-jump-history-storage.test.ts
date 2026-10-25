import { beforeEach, expect, it } from "vitest";
import {
  loadReaderJumpHistory,
  saveReaderJumpHistory,
  READER_HISTORY_STORAGE_KEY,
} from "@/features/reader/data/jump-history-storage";
import {
  EMPTY_READER_HISTORY,
  type ReaderJumpHistory,
} from "@/features/reader/jump-history";

const history: ReaderJumpHistory = {
  entries: [
    {
      kind: "normal",
      anchor: { type: "block", chapterIndex: 0, blockId: "A" },
      exact: true,
    },
    {
      kind: "highlight",
      anchor: {
        type: "text",
        chapterIndex: 1,
        blockId: "H",
        offset: { itemIndex: 0, segmentIndex: 2, graphemeIndex: 3 },
      },
    },
  ],
  cursor: 0,
};
beforeEach(() => localStorage.clear());

it("round trips anchors and the Forward cursor in one storage value", () => {
  saveReaderJumpHistory(localStorage, "book-a", "source-a", history);
  expect(loadReaderJumpHistory(localStorage, "book-a", "source-a")).toEqual(
    history,
  );
  expect(localStorage.length).toBe(1);
});

it("isolates books and rejects history for a replaced EPUB", () => {
  saveReaderJumpHistory(localStorage, "book-a", "source-a", history);
  saveReaderJumpHistory(localStorage, "book-b", "source-b", {
    ...history,
    cursor: 1,
  });
  expect(loadReaderJumpHistory(localStorage, "book-a", "source-a")).toEqual(
    history,
  );
  expect(loadReaderJumpHistory(localStorage, "book-b", "source-b").cursor).toBe(
    1,
  );
  expect(loadReaderJumpHistory(localStorage, "book-a", "replacement")).toEqual(
    EMPTY_READER_HISTORY,
  );
});

it.each([
  "broken-json",
  "null",
  "{}",
  '[{"bookId":"book-a","sourceFileId":"source-a","history":{"entries":[],"cursor":4}}]',
])("ignores malformed storage: %s", (raw) => {
  localStorage.setItem(READER_HISTORY_STORAGE_KEY, raw);
  expect(loadReaderJumpHistory(localStorage, "book-a", "source-a")).toEqual(
    EMPTY_READER_HISTORY,
  );
});

it("bounds the number of stored books in the same value", () => {
  for (let i = 0; i < 55; i++)
    saveReaderJumpHistory(localStorage, String(i), "source", history);
  const records = JSON.parse(localStorage.getItem(READER_HISTORY_STORAGE_KEY)!);
  expect(records).toHaveLength(50);
  expect(records[0].bookId).toBe("5");
});
