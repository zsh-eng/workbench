import { db } from "@/data/database";
import {
  decodeSyncKey,
  type SyncItemDescription,
  type SyncItemRef,
  type SyncJournalEntry,
  type SyncPendingChange,
} from "@zsh-eng/local-sync";

/** What a key's row says about it: its book, and when it was made. */
interface RecordFacts {
  bookId?: string;
  createdAt?: number;
  bookmark?: boolean;
}

/** Facts for the keys that history names, read from this device's rows. */
export interface ReaderLookup {
  records: ReadonlyMap<string, RecordFacts>;
  titles: ReadonlyMap<string, string>;
}

const BOOK_NOUN = { one: "book", other: "books" };
/** A record made this close before the change it arrived with was added then. */
const ADDED_WINDOW_MS = 10 * 60_000;

function decode(key: string): readonly [string, string] | null {
  try {
    return decodeSyncKey(key);
  } catch {
    return null;
  }
}

/** Every key the history may name: journal detail, lost edits and the outbox. */
export function keysIn(
  entries: readonly SyncJournalEntry[],
  pending: readonly SyncPendingChange[],
): string[] {
  const keys = new Set<string>();
  for (const entry of entries) {
    if (entry.type === "day") {
      for (const item of entry.lost) keys.add(item.key);
      continue;
    }
    for (const item of entry.received) keys.add(item.key);
    for (const item of entry.sent) keys.add(item.key);
  }
  for (const change of pending) keys.add(change.key);
  return [...keys].sort();
}

/**
 * Reads the rows behind `keys` (deleted rows stay as tombstones, so a
 * removed highlight still has its book) and the titles of their books.
 */
export async function lookUpRecords(
  keys: readonly string[],
): Promise<ReaderLookup> {
  const ids = new Map<string, string[]>();
  for (const key of keys) {
    const decoded = decode(key);
    if (!decoded) continue;
    const [table, id] = decoded;
    ids.set(table, [...(ids.get(table) ?? []), id]);
  }
  const records = new Map<string, RecordFacts>();
  const read = async (
    table:
      | "books"
      | "highlights"
      | "notes"
      | "readingSessions"
      | "readingState"
      | "readingCheckpoints",
    facts: (row: Record<string, unknown>) => RecordFacts,
  ) => {
    const wanted = ids.get(table) ?? [];
    if (wanted.length === 0) return;
    const rows = await db.table(table).bulkGet(wanted);
    rows.forEach((row: Record<string, unknown> | undefined, index) => {
      const id = wanted[index]!;
      // A checkpoint's id names its book: `resume:<device>:<book>`.
      const fallback =
        table === "readingCheckpoints"
          ? { bookId: id.split(":").at(-1) }
          : undefined;
      const known = row ? facts(row) : fallback;
      if (known) records.set(JSON.stringify([table, id]), known);
    });
  };
  const number = (value: unknown) =>
    typeof value === "number" ? value : undefined;
  const text = (value: unknown) =>
    typeof value === "string" ? value : undefined;
  await Promise.all([
    read("books", (row) => ({
      bookId: text(row.id),
      createdAt: number(row.dateAdded),
    })),
    read("highlights", (row) => ({
      bookId: text(row.bookId),
      createdAt: number(row.createdAt),
    })),
    read("notes", (row) => ({
      bookId: text(row.bookId),
      createdAt: number(row.createdAt),
      bookmark: row.kind === "bookmark",
    })),
    read("readingSessions", (row) => ({ bookId: text(row.bookId) })),
    read("readingState", (row) => ({ bookId: text(row.bookId) })),
    read("readingCheckpoints", (row) => ({ bookId: text(row.bookId) })),
  ]);
  const bookIds = [
    ...new Set(
      [...records.values()].flatMap((facts) =>
        facts.bookId ? [facts.bookId] : [],
      ),
    ),
  ];
  const books = await db.books.bulkGet(bookIds);
  const titles = new Map<string, string>();
  books.forEach((book, index) => {
    if (book?.title) titles.set(bookIds[index]!, book.title);
  });
  return { records, titles };
}

/**
 * Reader's nouns for a change: books, highlights, notes and bookmarks in
 * their books, reading progress (position, time and status together) and
 * reading settings.
 */
export function describeReaderRecord(
  lookup: ReaderLookup | undefined,
): (ref: SyncItemRef) => SyncItemDescription {
  return (ref) => {
    const facts = ref.key ? lookup?.records.get(ref.key) : undefined;
    const book = facts?.bookId
      ? {
          id: facts.bookId,
          label: lookup?.titles.get(facts.bookId) ?? "a book",
          ...BOOK_NOUN,
        }
      : undefined;
    const container = book ? { container: book } : {};
    const verb: SyncItemDescription["verb"] = ref.deleted
      ? "removed"
      : facts?.createdAt !== undefined &&
          ref.at !== undefined &&
          facts.createdAt >= ref.at - ADDED_WINDOW_MS
        ? "added"
        : "changed";
    switch (ref.table) {
      case "books":
        return { kind: "book", ...BOOK_NOUN, verb, ...container };
      case "highlights":
        return {
          kind: "highlight",
          one: "highlight",
          other: "highlights",
          verb,
          ...container,
        };
      case "notes":
        return facts?.bookmark
          ? {
              kind: "bookmark",
              one: "bookmark",
              other: "bookmarks",
              verb,
              ...container,
            }
          : { kind: "note", one: "note", other: "notes", verb, ...container };
      case "readingCheckpoints":
      case "readingSessions":
      case "readingState":
        return {
          kind: "progress",
          one: "reading progress",
          other: "reading progress",
          mass: true,
          verb: ref.deleted ? "removed" : "changed",
          ...container,
        };
      case "readingSettings":
        return {
          kind: "settings",
          one: "reading settings",
          other: "reading settings",
          mass: true,
          verb: "changed",
        };
      default:
        return { kind: ref.table, one: "item", other: "items", verb };
    }
  };
}
