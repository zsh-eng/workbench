import "fake-indexeddb/auto";
import Dexie, { type Table } from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import {
  SyncClient,
  createSyncClientStateStore,
  getOrCreateSyncClientState,
  nextSyncHlcBatch,
  encodeSyncKey,
  encodeSyncValue,
  MAX_SYNC_VALUE_BYTES,
  SyncValueTooLargeError,
  type SyncRecord,
  type SyncRemote,
  type SyncPushChange,
} from "@zsh-eng/local-sync";
import {
  DexieSyncStorage,
  installSync,
  type SyncTableMap,
} from "@zsh-eng/local-sync/dexie";

type Task = { id: string; title: string; isDeleted?: boolean };
class TaskDatabase extends Dexie {
  tasks!: Table<Task, string>;
  drafts!: Table<Task, string>;
  _sync_outbox!: Table<SyncPushChange, string>;
  constructor(name: string) {
    super(name);
    this.version(1).stores({ tasks: "id", drafts: "id", _sync_outbox: "key" });
  }
}
const tables: SyncTableMap = { tasks: { schemaVersion: 3 } };
const databases: TaskDatabase[] = [];
afterEach(async () => {
  const names = [...new Set(databases.map((db) => db.name))];
  for (const db of databases.splice(0)) db.close();
  for (const name of names) await Dexie.delete(name);
});

function setup(deviceId: string) {
  const values = new Map<string, string>();
  const state = createSyncClientStateStore(
    {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value);
      },
    },
    deviceId,
  );
  getOrCreateSyncClientState(deviceId, state);
  const db = new TaskDatabase(`package-${crypto.randomUUID()}`);
  const raw = new TaskDatabase(db.name);
  databases.push(db, raw);
  installSync(db, tables, (count) => nextSyncHlcBatch(count, state, 1_000));
  const storage = new DexieSyncStorage({ db: raw, tables });
  return { db, raw, state, storage };
}
function record(title: string, counter: number, isDeleted = false): SyncRecord {
  return {
    key: encodeSyncKey("tasks", "one"),
    value: encodeSyncValue({ id: "one", title, isDeleted }),
    hlc: { wallTimeMs: 1_000, counter },
    schemaVersion: 3,
    isDeleted,
    deviceId: "remote",
    serverSeq: counter + 1,
  };
}

describe("independent Dexie consumer", () => {
  it("captures custom tables, compacts changes, and retains deletions atomically", async () => {
    const { db, raw } = setup("a");
    await db.tasks.put({ id: "one", title: "first" });
    await db.tasks.update("one", { title: "second" });
    await db.drafts.put({ id: "draft", title: "local" });
    expect(await raw._sync_outbox.count()).toBe(1);
    expect((await raw._sync_outbox.toArray())[0]).toMatchObject({
      schemaVersion: 3,
    });
    await expect(
      db.transaction("rw", db.tasks, async () => {
        await db.tasks.put({ id: "two", title: "aborted" });
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");
    expect(await db.tasks.get("two")).toBeUndefined();
    expect(await raw._sync_outbox.count()).toBe(1);
    await db.tasks.delete("one");
    expect(await raw.tasks.get("one")).toMatchObject({
      title: "second",
      isDeleted: true,
    });
    expect((await raw._sync_outbox.toArray())[0]?.isDeleted).toBe(true);
  });

  it("fails a write that one record cannot hold with a typed error, storing nothing", async () => {
    const { db, raw } = setup("a");
    const write = db.tasks.put({
      id: "one",
      title: "x".repeat(MAX_SYNC_VALUE_BYTES),
    });
    await expect(write).rejects.toBeInstanceOf(SyncValueTooLargeError);
    await expect(write).rejects.toMatchObject({
      key: encodeSyncKey("tasks", "one"),
      limit: MAX_SYNC_VALUE_BYTES,
    });
    expect(await raw.tasks.count()).toBe(0);
    expect(await raw._sync_outbox.count()).toBe(0);
  });

  it("applies a newer remote deletion and preserves a newer local edit", async () => {
    const { db, raw, storage } = setup("a");
    await db.tasks.put({ id: "one", title: "first" });
    await db.tasks.update("one", { title: "local" });
    expect(
      await storage.applyRemoteRecords(
        storage.prepareRemoteRecords([record("old", 0)]),
        "a",
      ),
    ).toEqual({
      applied: 0,
      skipped: 1,
      keptLocal: [encodeSyncKey("tasks", "one")],
    });
    await storage.applyRemoteRecords(
      storage.prepareRemoteRecords([record("removed", 10, true)]),
      "a",
    );
    expect(await raw.tasks.get("one")).toMatchObject({
      title: "removed",
      isDeleted: true,
    });
    // Remote application did not create a new local mutation.
    expect((await raw._sync_outbox.toArray())[0]?.hlc.counter).toBe(1);
  });

  it("keeps an edit made while push is in flight and acknowledges only the sent version", async () => {
    const { db, raw, storage, state } = setup("a");
    await db.tasks.put({ id: "one", title: "sent" });
    let editDuringPush = true;
    const remote: SyncRemote = {
      pull: async () => ({ records: [], cursor: 0, head: 0, hasMore: false }),
      push: async (deviceId, changes) => {
        if (editDuringPush) {
          editDuringPush = false;
          await db.tasks.update("one", { title: "edited in flight" });
        }
        return {
          results: changes.map((change) => ({
            accepted: true,
            winner: { ...change, deviceId, serverSeq: 1 },
          })),
        };
      },
    };
    const client = new SyncClient({ storage, stateStore: state, remote });
    await client.sync();
    expect(await raw.tasks.get("one")).toMatchObject({
      title: "edited in flight",
    });
    expect(await raw._sync_outbox.count()).toBe(1);
    await client.push();
    expect(await raw._sync_outbox.count()).toBe(0);
  });

  it("rejects an unknown schema before advancing the cursor or applying rows", async () => {
    const { raw, storage, state } = setup("a");
    const remote: SyncRemote = {
      pull: async () => ({
        records: [{ ...record("unknown", 2), schemaVersion: 4 }],
        cursor: 3,
        head: 3,
        hasMore: false,
      }),
      push: async () => {
        throw new Error("must not push");
      },
    };
    await expect(
      new SyncClient({ storage, stateStore: state, remote }).sync(),
    ).rejects.toThrow("Unsupported schema");
    expect(state.read()?.pullCursor).toBe(0);
    expect(await raw.tasks.count()).toBe(0);
  });

  it("keeps two client databases and their pending changes separate", async () => {
    const a = setup("a");
    const b = setup("b");
    await a.db.tasks.put({ id: "one", title: "a only" });
    expect(await b.raw.tasks.count()).toBe(0);
    expect(await b.raw._sync_outbox.count()).toBe(0);
    expect(b.state.read()?.hlc.wallTimeMs).toBe(0);
  });
});

it("keeps an edit made while a streaming record waits to apply", async () => {
  const { db, raw, state, storage } = setup("stream-local");
  const remoteRecord = record("remote", 1);
  const client = new SyncClient({
    stateStore: state,
    remote: {
      pull: async () => {
        throw new Error("Unexpected fallback");
      },
      push: async () => ({ results: [] }),
      async *pullStream() {
        yield { records: [remoteRecord], cursor: 2, head: 2, hasMore: false };
      },
    },
    storage: {
      prepareRemoteRecords: (rows) => storage.prepareRemoteRecords(rows),
      async applyRemoteRecords(prepared, deviceId) {
        await db.tasks.put({ id: "one", title: "edited while downloading" });
        return storage.applyRemoteRecords(prepared, deviceId);
      },
      getPendingChanges: () => storage.getPendingChanges(),
      reconcilePushResults: (sent, prepared) =>
        storage.reconcilePushResults(sent, prepared),
    },
  });
  expect(await client.pull()).toEqual({ pulled: 0, skipped: 1 });
  expect((await raw.tasks.get("one"))!.title).toBe("edited while downloading");
  expect(await raw._sync_outbox.count()).toBe(1);
});
