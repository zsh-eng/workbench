import "fake-indexeddb/auto";
import { test, expect } from "bun:test";
import Dexie, { type Table } from "dexie";
import {
  DexieSyncStorage,
  type SyncDexieDatabase,
} from "@zsh-eng/local-sync/dexie";
import { encodeSyncKey } from "@zsh-eng/local-sync";
import { createTrace } from "./trace";
import { instrumentOutbox } from "./outbox";
function fixture() {
  const db = new Dexie(crypto.randomUUID()) as SyncDexieDatabase & {
    items: Table<{ id: string; isDeleted: boolean; title: string }, string>;
  };
  db.version(1).stores({ items: "id", _sync_outbox: "key" });
  const metrics = { outboxChecks: 0, outboxGets: 0 };
  instrumentOutbox(db, true, metrics);
  return {
    db,
    metrics,
    storage: new DexieSyncStorage({
      db,
      tables: { items: { schemaVersion: 1 } },
    }),
  };
}
function record(id = "a", wall = 10) {
  return {
    key: encodeSyncKey("items", id),
    value: JSON.stringify({ id, isDeleted: false, title: "remote" }),
    isDeleted: false,
    schemaVersion: 1,
    hlc: { wallTimeMs: wall, counter: 0 },
    deviceId: "remote",
    serverSeq: 1,
  };
}
test("empty outbox skips per-key reads in the library apply transaction", async () => {
  const f = fixture();
  try {
    await f.storage.applyRemoteRecords(
      f.storage.prepareRemoteRecords([record()]),
      "local",
    );
    expect(f.metrics).toEqual({ outboxChecks: 1, outboxGets: 0 });
    expect((await f.db.items.get("a"))!.title).toBe("remote");
  } finally {
    await f.db.delete();
  }
});
test("pending newer local edit is preserved through the fallback", async () => {
  const f = fixture();
  try {
    const r = record();
    const local = { id: "a", isDeleted: false, title: "local" };
    await f.db.items.put(local);
    await f.db._sync_outbox.put({
      ...r,
      value: JSON.stringify(local),
      hlc: { wallTimeMs: 20, counter: 0 },
    });
    const result = await f.storage.applyRemoteRecords(
      f.storage.prepareRemoteRecords([r]),
      "local",
    );
    expect(result.skipped).toBe(1);
    expect((await f.db.items.get("a"))!.title).toBe("local");
    expect(await f.db._sync_outbox.count()).toBe(1);
    expect(f.metrics.outboxGets).toBe(1);
  } finally {
    await f.db.delete();
  }
});
test("outbox is checked again for each transaction, not cached as empty", async () => {
  const f = fixture();
  try {
    const r = record();
    await f.storage.applyRemoteRecords(
      f.storage.prepareRemoteRecords([r]),
      "local",
    );
    const local = { id: "a", isDeleted: false, title: "later-local" };
    await f.db.items.put(local);
    await f.db._sync_outbox.put({
      ...r,
      value: JSON.stringify(local),
      hlc: { wallTimeMs: 30, counter: 0 },
    });
    await f.storage.applyRemoteRecords(
      f.storage.prepareRemoteRecords([record("a", 20)]),
      "local",
    );
    expect((await f.db.items.get("a"))!.title).toBe("later-local");
    expect(f.metrics).toEqual({ outboxChecks: 2, outboxGets: 1 });
  } finally {
    await f.db.delete();
  }
});
test("failed multi-row write rolls back the apply transaction", async () => {
  const f = fixture();
  try {
    const prepared = f.storage.prepareRemoteRecords([record("a"), record("b")]);
    delete prepared[1].row.id;
    await expect(
      f.storage.applyRemoteRecords(prepared, "local"),
    ).rejects.toBeDefined();
    expect(await f.db.items.count()).toBe(0);
    expect(await f.db._sync_outbox.count()).toBe(0);
  } finally {
    await f.db.delete();
  }
});

test("trace preserves apply transaction and records write phases", async () => {
  const f = fixture();
  const trace = createTrace(true, true);
  trace.instrument(f.db);
  try {
    await f.storage.applyRemoteRecords(
      f.storage.prepareRemoteRecords([record()]),
      "local",
    );
    expect((await f.db.items.get("a"))!.title).toBe("remote");
    expect(trace.native.putCalls).toBe(1);
    for (const name of [
      "transaction-start",
      "outbox-count",
      "bulk-put",
      "transaction-commit",
    ])
      expect(
        trace.spans.some(
          (span) => span.name === name && span.end >= span.start,
        ),
      ).toBe(true);
  } finally {
    trace.dispose();
    await f.db.delete();
  }
});
