import {
  getOrCreateSyncClientState,
  readSyncClientState,
} from "@/lib/sync-v2/client-state";
import {
  createSyncV2ApplicationDb,
  EPUBReaderSyncV2DB,
  type SyncV2ReadingState,
} from "@/lib/sync-v2/db";
import { SyncV2Client, type SyncV2Remote } from "@/lib/sync-v2/sync";
import {
  encodeSyncKey,
  encodeSyncValue,
  MAX_SYNC_VALUE_BYTES,
  MAX_SYNC_PUSH_BODY_BYTES,
  syncPushBodySchema,
  type SyncPullBody,
  type SyncPullResponse,
  type SyncPushChange,
  type SyncPushResponse,
  type SyncRecord,
} from "@zsh-eng/local-sync";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetIndexedDB } from "../setup/indexeddb";

const DATABASE_NAME = "sync-v2-client-test";

describe("sync v2 client", () => {
  let db: EPUBReaderSyncV2DB;
  let syncDb: EPUBReaderSyncV2DB;
  let remote: ScriptedRemote;
  let client: SyncV2Client;

  beforeEach(async () => {
    resetIndexedDB();
    localStorage.clear();
    getOrCreateSyncClientState("device-a");
    db = createSyncV2ApplicationDb(DATABASE_NAME);
    syncDb = new EPUBReaderSyncV2DB(DATABASE_NAME);
    await Promise.all([db.open(), syncDb.open()]);
    remote = new ScriptedRemote();
    client = new SyncV2Client({ syncDb, remote });
  });

  afterEach(async () => {
    syncDb.close();
    await db.delete();
    db.close();
    localStorage.clear();
  });

  it("splits valid large escaped UTF-8 notes by encoded body bytes and reconciles every row", async () => {
    const rows = Array.from({ length: 40 }, (_, index) => ({
      id: `large-note-${index}`,
      bookId: "book-a",
      kind: "note" as const,
      content: '"\\漢'.repeat(8500),
      anchor: {
        spineItemId: "chapter",
        startOffset: 0,
        endOffset: 0,
        textBefore: "",
        textAfter: "",
      },
      createdAt: 1000,
      updatedAt: 1000,
      isDeleted: false,
    }));
    await db.notes.bulkAdd(rows);
    const pending = await db._sync_outbox.toArray();
    expect(
      new TextEncoder().encode(JSON.stringify({ changes: pending })).byteLength,
    ).toBeGreaterThan(MAX_SYNC_PUSH_BODY_BYTES);
    remote.pushImplementation = async (changes) => {
      syncPushBodySchema.parse({ changes });
      return {
        results: changes.map((change, index) => ({
          accepted: true,
          winner: winnerFromChange(change, "device-a", index + 1),
        })),
      };
    };
    expect(await client.push()).toBe(rows.length);
    expect(remote.pushRequests.length).toBeGreaterThan(1);
    expect(remote.pushRequests.flat()).toHaveLength(rows.length);
    expect(await db._sync_outbox.count()).toBe(0);
    expect(await db.notes.toArray()).toEqual(
      rows.sort((a, b) => a.id.localeCompare(b.id)),
    );
  });

  it("keeps an oversized restored mutation in the outbox with a record-specific error", async () => {
    const key = encodeSyncKey("notes", "oversized");
    await syncDb._sync_outbox.put({
      key,
      value: "x".repeat(MAX_SYNC_VALUE_BYTES + 1),
      isDeleted: false,
      schemaVersion: 1,
      hlc: { wallTimeMs: 1000, counter: 0 },
    });
    await expect(client.push()).rejects.toThrow(
      `Cannot synchronize record ${key}`,
    );
    expect(remote.pushRequests).toHaveLength(0);
    expect(await db._sync_outbox.get(key)).toBeDefined();
  });

  it("syncs notebook entries, resolves remote edits, and reconciles deletions without syncing drafts", async () => {
    const row = {
      id: "note-a",
      bookId: "book-a",
      kind: "note" as const,
      content: "Local",
      anchor: {
        spineItemId: "chapter",
        startOffset: 0,
        endOffset: 0,
        textBefore: "",
        textAfter: "",
      },
      createdAt: 1000,
      updatedAt: 1000,
      isDeleted: false,
    };
    await db.notes.add(row);
    await db.noteDrafts.add({
      id: "create:book-a",
      bookId: "book-a",
      purpose: "create",
      content: "Unsent",
      target: { kind: "page", anchor: row.anchor },
      updatedAt: 1000,
    });
    await client.push();
    expect(remote.pushRequests[0]).toHaveLength(1);
    expect(remote.pushRequests[0][0].key).toBe(encodeSyncKey("notes", row.id));
    expect(await db._sync_outbox.count()).toBe(0);

    await db.notes.put({ ...row, content: "Pending local edit" });
    const pending = (await db._sync_outbox.toArray())[0];
    remote.pullResponses.push({
      records: [
        serverRecord(
          { ...row, content: "Remote edit" },
          2,
          pending.hlc.wallTimeMs + 1,
          "notes",
        ),
      ],
      cursor: 2,
      head: 2,
      hasMore: false,
    });
    await client.pull();
    expect(await db.notes.get(row.id)).toMatchObject({
      content: "Remote edit",
    });
    // Pull applies the remote winner; push later reconciles pending outbox work.
    expect(await db._sync_outbox.count()).toBe(1);
    expect((await db.noteDrafts.get("create:book-a"))?.content).toBe("Unsent");
    await db.notes.delete(row.id);
    await client.push();
    expect(remote.pushRequests.at(-1)?.[0].isDeleted).toBe(true);
    expect(await db._sync_outbox.count()).toBe(0);
    expect((await db.notes.get(row.id))?.isDeleted).toBe(true);
  });

  it("decodes fixed-head bootstrap pages and then excludes its device", async () => {
    remote.pullResponses.push(
      {
        records: [serverRecord(readingState("page-a"), 1, 100)],
        cursor: 1,
        head: 2,
        hasMore: true,
      },
      {
        records: [
          serverRecord({ ...readingState("page-b"), isDeleted: true }, 2, 101),
        ],
        cursor: 2,
        head: 2,
        hasMore: false,
      },
    );

    await expect(client.pull()).resolves.toEqual({ pulled: 2, skipped: 0 });

    expect(remote.pullRequests).toEqual([
      {
        cursor: 0,
        limit: 500,
        excludeOwnDevice: false,
      },
      {
        cursor: 1,
        head: 2,
        limit: 500,
        excludeOwnDevice: false,
      },
    ]);
    expect(await db.readingState.get("page-a")).toEqual(readingState("page-a"));
    expect((await db.readingState.get("page-b"))?.isDeleted).toBe(true);
    expect(await db._sync_outbox.count()).toBe(0);
    expect(readSyncClientState()).toMatchObject({
      pullCursor: 2,
      bootstrapped: true,
      hlc: { wallTimeMs: 101, counter: 0 },
    });

    await client.pull();
    expect(remote.pullRequests.at(-1)).toMatchObject({
      cursor: 2,
      excludeOwnDevice: true,
    });
  });

  it("normalizes an older synchronized Book value during pull", async () => {
    remote.pullResponses.push({
      records: [
        serverRecord(
          {
            id: "legacy-book",
            fileHash: "1111111111111111",
            title: "Legacy Book",
            author: "Author",
            fileSize: 10,
            dateAdded: 1,
            metadata: {},
            manifest: [],
            spine: [],
            toc: [],
            isDownloaded: 0,
            coverContentHash: "2222222222222222",
            isDeleted: false,
          },
          1,
          100,
          "books",
        ),
      ],
      cursor: 1,
      head: 1,
      hasMore: false,
    });

    await client.pull();

    expect(await db.books.get("legacy-book")).toMatchObject({
      sourceFileId: "xxh64:1111111111111111",
      cover: {
        fileId: "xxh64:2222222222222222",
        blurHash: null,
      },
    });
    expect(await db._sync_outbox.count()).toBe(0);
  });

  it("pulls reading sessions whole, with a gap from a newer Reader and without one from an older", async () => {
    const older = {
      id: "session-older",
      bookId: "book-a",
      deviceId: "device-b",
      readerInstanceId: "reader-b",
      startedAt: 1_000,
      endedAt: 61_000,
      lastActiveAt: 61_000,
      activeMs: 60_000,
      startSpineIndex: 1,
      startScrollProgress: 0,
      endSpineIndex: 1,
      endScrollProgress: 40,
      isDeleted: false,
    };
    const newer = { ...older, id: "session-newer", gapMs: 180_000 };
    remote.pullResponses.push({
      records: [
        serverRecord(older, 1, 100, "readingSessions"),
        serverRecord(newer, 2, 101, "readingSessions"),
      ],
      cursor: 2,
      head: 2,
      hasMore: false,
    });

    await client.pull();

    // The store keeps each value as sent, so a row keeps a field that this
    // version does not know, and an older version keeps `gapMs` the same way.
    expect(await db.readingSessions.get("session-older")).toEqual(older);
    expect(await db.readingSessions.get("session-newer")).toEqual(newer);
    expect(await db._sync_outbox.count()).toBe(0);
  });

  it("keeps a local row when its outbox HLC is newer", async () => {
    await db.readingState.add(readingState("local-wins"));
    const localChange = await db._sync_outbox.get(
      encodeSyncKey("readingState", "local-wins"),
    );
    remote.pullResponses.push({
      records: [
        serverRecord(
          { ...readingState("local-wins"), status: "finished" },
          1,
          localChange!.hlc.wallTimeMs - 1,
        ),
      ],
      cursor: 1,
      head: 1,
      hasMore: false,
    });

    await expect(client.pull()).resolves.toEqual({ pulled: 0, skipped: 1 });

    expect((await db.readingState.get("local-wins"))?.status).toBe("reading");
    expect(await db._sync_outbox.get(localChange!.key)).toEqual(localChange);
  });

  it("applies a newer remote row but leaves its stale outbox for push", async () => {
    await db.readingState.add(readingState("remote-wins"));
    const localChange = await db._sync_outbox.get(
      encodeSyncKey("readingState", "remote-wins"),
    );
    const winner = serverRecord(
      { ...readingState("remote-wins"), status: "finished" },
      1,
      localChange!.hlc.wallTimeMs + 1,
    );
    remote.pullResponses.push({
      records: [winner],
      cursor: 1,
      head: 1,
      hasMore: false,
    });

    await client.pull();

    expect((await db.readingState.get("remote-wins"))?.status).toBe("finished");
    expect(await db._sync_outbox.get(localChange!.key)).toEqual(localChange);

    remote.pushImplementation = async () => ({
      results: [{ accepted: false, winner }],
    });
    await expect(client.push()).resolves.toBe(1);
    expect(await db._sync_outbox.count()).toBe(0);
    expect((await db.readingState.get("remote-wins"))?.status).toBe("finished");
  });

  it("does not reconcile over an outbox entry replaced during push", async () => {
    await db.readingState.add(readingState("concurrent"));
    const requestStarted = deferred<void>();
    const releaseResponse = deferred<SyncPushResponse>();
    remote.pushImplementation = async () => {
      requestStarted.resolve();
      return releaseResponse.promise;
    };

    const pushPromise = client.push();
    await requestStarted.promise;
    await db.readingState.update("concurrent", { status: "finished" });
    const replacement = await db._sync_outbox.get(
      encodeSyncKey("readingState", "concurrent"),
    );
    const sent = remote.pushRequests[0]![0]!;
    releaseResponse.resolve({
      results: [
        {
          accepted: true,
          winner: winnerFromChange(sent, "device-a", 1),
        },
      ],
    });

    await expect(pushPromise).resolves.toBe(0);
    expect(await db._sync_outbox.get(replacement!.key)).toEqual(replacement);
    expect((await db.readingState.get("concurrent"))?.status).toBe("finished");
  });

  it("pushes a large outbox in protocol-sized batches", async () => {
    await db.readingState.bulkPut(
      Array.from({ length: 501 }, (_, index) =>
        readingState(`batched-${index}`),
      ),
    );

    await expect(client.push()).resolves.toBe(501);

    expect(remote.pushRequests.map((changes) => changes.length)).toEqual([
      500, 1,
    ]);
    expect(await db._sync_outbox.count()).toBe(0);
  });

  it("rejects malformed values without advancing the pull cursor", async () => {
    const malformed = serverRecord(readingState("wrong-id"), 1, 100);
    malformed.value = encodeSyncValue({
      ...readingState("wrong-id"),
      id: "different-id",
    });
    remote.pullResponses.push({
      records: [malformed],
      cursor: 1,
      head: 1,
      hasMore: false,
    });

    await expect(client.pull()).rejects.toThrow(
      "Sync value ID does not match key",
    );
    expect(await db.readingState.count()).toBe(0);
    expect(readSyncClientState()).toMatchObject({
      pullCursor: 0,
      hlc: { wallTimeMs: 0, counter: 0 },
    });
  });

  it("coalesces concurrent full sync calls", async () => {
    const pullStarted = deferred<void>();
    const releasePull = deferred<SyncPullResponse>();
    remote.pullImplementation = async () => {
      pullStarted.resolve();
      return releasePull.promise;
    };

    const first = client.sync();
    const second = client.sync();
    expect(second).toBe(first);
    await pullStarted.promise;
    releasePull.resolve({ records: [], cursor: 0, head: 0, hasMore: false });

    await expect(first).resolves.toEqual({
      pulled: 0,
      skipped: 0,
      pushed: 0,
    });
    expect(remote.pullRequests).toHaveLength(1);
  });
});

class ScriptedRemote implements SyncV2Remote {
  pullRequests: SyncPullBody[] = [];
  pushRequests: SyncPushChange[][] = [];
  pullResponses: SyncPullResponse[] = [];
  pullImplementation?: (request: SyncPullBody) => Promise<SyncPullResponse>;
  pushImplementation?: (
    changes: readonly SyncPushChange[],
  ) => Promise<SyncPushResponse>;

  async pull(
    _deviceId: string,
    request: SyncPullBody,
  ): Promise<SyncPullResponse> {
    this.pullRequests.push(request);
    if (this.pullImplementation) {
      return this.pullImplementation(request);
    }
    return (
      this.pullResponses.shift() ?? {
        records: [],
        cursor: request.head ?? request.cursor,
        head: request.head ?? request.cursor,
        hasMore: false,
      }
    );
  }

  async push(
    deviceId: string,
    changes: readonly SyncPushChange[],
  ): Promise<SyncPushResponse> {
    this.pushRequests.push([...changes]);
    if (this.pushImplementation) {
      return this.pushImplementation(changes);
    }
    return {
      results: changes.map((change, index) => ({
        accepted: true,
        winner: winnerFromChange(change, deviceId, index + 1),
      })),
    };
  }
}

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

function serverRecord(
  row: { id: string; isDeleted: boolean },
  serverSeq: number,
  wallTimeMs: number,
  tableName = "readingState",
): SyncRecord {
  return {
    key: encodeSyncKey(tableName, row.id),
    value: encodeSyncValue(row),
    schemaVersion: 1,
    hlc: { wallTimeMs, counter: 0 },
    deviceId: "device-b",
    isDeleted: row.isDeleted,
    serverSeq,
  };
}

function winnerFromChange(
  change: SyncPushChange,
  deviceId: string,
  serverSeq: number,
): SyncRecord {
  return { ...change, deviceId, serverSeq };
}

function deferred<Value>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
