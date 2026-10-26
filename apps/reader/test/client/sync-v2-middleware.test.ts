import { getOrCreateSyncClientState } from "@/lib/sync-v2/client-state";
import {
  createSyncV2ApplicationDb,
  EPUBReaderSyncV2DB,
  type SyncV2Book,
  type SyncV2ReadingSettings,
  type SyncV2ReadingState,
} from "@/lib/sync-v2/db";
import {
  decodeSyncValue,
  encodeSyncKey,
  MAX_SYNC_VALUE_BYTES,
  type SyncPushChange,
  SyncValueTooLargeError,
} from "@zsh-eng/local-sync";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetIndexedDB } from "../setup/indexeddb";

const DATABASE_NAME = "sync-v2-middleware-test";
describe("sync v2 mutation middleware", () => {
  let db: EPUBReaderSyncV2DB;

  beforeEach(async () => {
    resetIndexedDB();
    localStorage.clear();
    getOrCreateSyncClientState("device-a");

    db = createSyncV2ApplicationDb(DATABASE_NAME);
    await db.open();
  });

  afterEach(async () => {
    await db.delete();
    db.close();
    localStorage.clear();
  });

  it("compacts add and update mutations into one outbox winner", async () => {
    await db.readingState.add(readingState("state-a"));

    const initialRow = await db.readingState.get("state-a");
    const initialChange = await db._sync_outbox.get(
      encodeSyncKey("readingState", "state-a"),
    );
    expect(initialRow?.isDeleted).toBe(false);
    expect(initialChange).toMatchObject({
      schemaVersion: 1,
      isDeleted: false,
    });
    expect(decodeSyncValue(initialChange!.value)).toEqual(initialRow);

    await db.readingState.update("state-a", { status: "finished" });

    const updatedRow = await db.readingState.get("state-a");
    const updatedChange = await db._sync_outbox.get(initialChange!.key);
    expect(await db._sync_outbox.count()).toBe(1);
    expect(updatedRow?.status).toBe("finished");
    expect(decodeSyncValue(updatedChange!.value)).toEqual(updatedRow);
    expect(compareHlc(updatedChange!.hlc, initialChange!.hlc)).toBeGreaterThan(
      0,
    );
  });

  it("captures bulk and existing multi-table transaction writes", async () => {
    await db.readingState.bulkPut([
      readingState("bulk-a"),
      readingState("bulk-b"),
    ]);

    await db.transaction(
      "rw",
      [db.readingState, db.readingSettings],
      async () => {
        await db.readingState.put(readingState("transaction-state"));
        await db.readingSettings.put(readingSettings("settings-a"));
      },
    );

    const keys = (await db._sync_outbox.toArray()).map((change) => change.key);
    expect(new Set(keys)).toEqual(
      new Set([
        encodeSyncKey("readingState", "bulk-a"),
        encodeSyncKey("readingState", "bulk-b"),
        encodeSyncKey("readingState", "transaction-state"),
        encodeSyncKey("readingSettings", "settings-a"),
      ]),
    );
  });

  it("keeps local caches out of the v2 outbox", async () => {
    const cache = {
      bookId: "book-a",
      chapters: [],
      totalCharacters: 0,
      extractedAt: 1_000,
    };

    await db.bookTextCache.add(cache);

    expect(await db.bookTextCache.get(cache.bookId)).toEqual(cache);
    expect(await db._sync_outbox.count()).toBe(0);
  });

  it("serializes compact Book references and rejects inline file data", async () => {
    const validBook = book("book-files", "1111111111111111");
    await db.books.add(validBook);

    const change = await db._sync_outbox.get(
      encodeSyncKey("books", validBook.id),
    );
    expect(decodeSyncValue(change!.value)).toEqual(validBook);
    expect(new TextEncoder().encode(change!.value).byteLength).toBeLessThan(
      MAX_SYNC_VALUE_BYTES / 8,
    );
    expect(change!.value).not.toContain("data:");

    await expect(
      db.books.add({
        ...book("book-data-url", "2222222222222222"),
        metadata: { coverDataUrl: "data:image/webp;base64,AAAA" },
      }),
    ).rejects.toThrow("contains inline file data");
    await expect(
      db.books.add({
        ...book("book-base64", "3333333333333333"),
        metadata: { payload: "A".repeat(128) },
      }),
    ).rejects.toThrow("contains inline file data");

    expect(await db.books.count()).toBe(1);
    expect(await db._sync_outbox.count()).toBe(1);
  });

  it("converts bulk deletes into retained soft-deleted rows", async () => {
    await db.readingState.bulkPut([
      readingState("delete-a"),
      readingState("delete-b"),
    ]);
    await db._sync_outbox.clear();

    await db.readingState.bulkDelete(["delete-a", "delete-b", "missing"]);

    const rows = await db.readingState.orderBy("id").toArray();
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.isDeleted)).toBe(true);

    const changes = await db._sync_outbox.toArray();
    expect(changes).toHaveLength(2);
    expect(changes.every((change) => change.isDeleted)).toBe(true);
    expect(
      changes.map((change) =>
        decodeSyncValue<SyncV2ReadingState>(change.value),
      ),
    ).toEqual(rows);
  });

  it("converts clear into soft deletes", async () => {
    await db.readingState.bulkPut([
      readingState("clear-a"),
      readingState("clear-b"),
    ]);
    await db._sync_outbox.clear();

    await db.readingState.clear();

    expect(
      (await db.readingState.toArray()).every((row) => row.isDeleted),
    ).toBe(true);
    expect(await db._sync_outbox.count()).toBe(2);
  });

  it("keeps cascading multi-table deletes in one transaction", async () => {
    await db.readingState.bulkPut([
      readingState("cascade-a"),
      readingState("cascade-b"),
    ]);
    await db.readingSettings.put(readingSettings("cascade-settings"));
    await db._sync_outbox.clear();

    await db.transaction(
      "rw",
      [db.readingState, db.readingSettings],
      async () => {
        await db.readingState.where("bookId").equals("book-a").delete();
        await db.readingSettings.delete("cascade-settings");
      },
    );

    expect(
      (await db.readingState.toArray()).every((row) => row.isDeleted),
    ).toBe(true);
    expect(
      (await db.readingSettings.toArray()).every((row) => row.isDeleted),
    ).toBe(true);
    expect(await db._sync_outbox.count()).toBe(3);
  });

  it("rolls back domain and outbox writes together", async () => {
    await expect(
      db.transaction("rw", db.readingState, async () => {
        await db.readingState.add(readingState("rolled-back"));
        throw new Error("abort transaction");
      }),
    ).rejects.toThrow("abort transaction");

    expect(await db.readingState.count()).toBe(0);
    expect(await db._sync_outbox.count()).toBe(0);
  });

  it("rejects an oversized value before writing either table", async () => {
    const oversized = {
      ...readingState("oversized"),
      status: "x".repeat(64 * 1_024 + 1),
    } as unknown as SyncV2ReadingState;

    await expect(db.readingState.add(oversized)).rejects.toThrow(
      SyncValueTooLargeError,
    );
    expect(await db.readingState.count()).toBe(0);
    expect(await db._sync_outbox.count()).toBe(0);
  });

  it("lets a raw connection write without touching the outbox or HLC", async () => {
    const before = localStorage.getItem("epub-reader-sync-v2-state");
    const syncDb = new EPUBReaderSyncV2DB(DATABASE_NAME);
    await syncDb.open();

    try {
      await syncDb.readingState.put({
        ...readingState("remote-row"),
        status: "finished",
      });
    } finally {
      syncDb.close();
    }

    expect(await db.readingState.get("remote-row")).toEqual({
      ...readingState("remote-row"),
      status: "finished",
    });
    expect(await db._sync_outbox.count()).toBe(0);
    expect(localStorage.getItem("epub-reader-sync-v2-state")).toBe(before);
  });
});

function readingState(id: string): SyncV2ReadingState {
  return {
    id,
    bookId: "book-a",
    status: "reading",
    timestamp: 1_000,
    createdAt: 1_000,
    isDeleted: false,
  };
}

function readingSettings(id: string): SyncV2ReadingSettings {
  return {
    id,
    fontSize: 18,
    lineHeight: 1.5,
    mode: "paginated",
    isDeleted: false,
  };
}

function book(id: string, digest: string): SyncV2Book {
  return {
    id,
    sourceFileId: `xxh64:${digest}` as SyncV2Book["sourceFileId"],
    title: "A representative book",
    author: "Author",
    fileSize: 1_024,
    dateAdded: 1_000,
    metadata: { language: "en" },
    manifest: [
      {
        id: "chapter-1",
        href: "Text/chapter-1.xhtml",
        mediaType: "application/xhtml+xml",
      },
    ],
    spine: [{ idref: "chapter-1" }],
    toc: [{ label: "Chapter 1", href: "Text/chapter-1.xhtml" }],
    cover: {
      fileId: "xxh64:2222222222222222" as SyncV2Book["sourceFileId"],
      blurHash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
    },
    isDeleted: false,
  };
}

function compareHlc(left: SyncPushChange["hlc"], right: SyncPushChange["hlc"]) {
  if (left.wallTimeMs !== right.wallTimeMs) {
    return left.wallTimeMs - right.wallTimeMs;
  }
  return left.counter - right.counter;
}
