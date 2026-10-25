import { z } from "zod";
import {
  EMPTY_READER_HISTORY,
  READER_HISTORY_LIMIT,
  type ReaderJumpHistory,
} from "../jump-history";

export const READER_HISTORY_STORAGE_KEY = "reader-jump-history-v1";
const MAX_BOOK_HISTORIES = 50;
const index = z.number().int().nonnegative();
const anchorBase = { chapterIndex: index, blockId: z.string().min(1) };
const anchor = z.discriminatedUnion("type", [
  z.object({ ...anchorBase, type: z.literal("block") }),
  z.object({
    ...anchorBase,
    type: z.literal("text"),
    offset: z.object({
      itemIndex: index,
      segmentIndex: index,
      graphemeIndex: index,
    }),
  }),
]);
const historySchema = z
  .object({
    entries: z
      .array(
        z.object({
          kind: z.enum([
            "normal",
            "chapter",
            "toc",
            "search",
            "highlight",
            "note",
            "handoff",
            "internal-link",
            "scrubber",
          ]),
          anchor,
          exact: z.literal(true).optional(),
        }),
      )
      .max(READER_HISTORY_LIMIT),
    cursor: z.number().int(),
  })
  .refine(({ entries, cursor }) =>
    entries.length === 0
      ? cursor === -1
      : cursor >= 0 && cursor < entries.length,
  );
const recordsSchema = z
  .array(
    z.object({
      bookId: z.string(),
      sourceFileId: z.string(),
      history: historySchema,
    }),
  )
  .max(MAX_BOOK_HISTORIES);
type HistoryStorage = Pick<Storage, "getItem" | "setItem">;

function readRecords(storage: HistoryStorage) {
  const raw = storage.getItem(READER_HISTORY_STORAGE_KEY);
  if (!raw) return [];
  try {
    return recordsSchema.parse(JSON.parse(raw));
  } catch {
    // History is disposable local state. Malformed values must not block reading.
    return [];
  }
}

export function loadReaderJumpHistory(
  storage: HistoryStorage,
  bookId: string,
  sourceFileId: string,
): ReaderJumpHistory {
  return (
    readRecords(storage).find(
      (record) =>
        record.bookId === bookId && record.sourceFileId === sourceFileId,
    )?.history ?? EMPTY_READER_HISTORY
  );
}

/** One localStorage value, with bounded per-book trails. Re-read before writing
 * so one open book does not overwrite another book's saved trail.
 */
export function saveReaderJumpHistory(
  storage: HistoryStorage,
  bookId: string,
  sourceFileId: string,
  history: ReaderJumpHistory,
): void {
  const records = readRecords(storage).filter(
    (record) => record.bookId !== bookId,
  );
  records.push({ bookId, sourceFileId, history });
  storage.setItem(
    READER_HISTORY_STORAGE_KEY,
    JSON.stringify(records.slice(-MAX_BOOK_HISTORIES)),
  );
}
