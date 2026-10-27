import "fake-indexeddb/auto";
import Dexie, { type Table } from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import {
  SyncClient,
  SyncNetworkError,
  compareSyncVersions,
  createMemorySyncJournalStore,
  createSyncClientStateStore,
  createSyncController,
  createSyncJournal,
  decodeSyncKey,
  encodeSyncKey,
  encodeSyncValue,
  getOrCreateSyncClientState,
  nextSyncHlcBatch,
  phraseSyncItem,
  summarizeSyncHistory,
  type SyncItemRef,
  type SyncJournal,
  type SyncJournalEntry,
  type SyncJournalPass,
  type SyncPushChange,
  type SyncRecord,
  type SyncRemote,
} from "@zsh-eng/local-sync";
import {
  DexieSyncJournalStore,
  DexieSyncStorage,
  SYNC_JOURNAL_SCHEMA,
  installSync,
  type SyncTableMap,
} from "@zsh-eng/local-sync/dexie";

type Task = { id: string; title: string; isDeleted?: boolean };
class TaskDatabase extends Dexie {
  tasks!: Table<Task, string>;
  _sync_outbox!: Table<SyncPushChange, string>;
  constructor(name: string) {
    super(name);
    this.version(1).stores({
      tasks: "id",
      _sync_outbox: "key",
      _sync_journal: SYNC_JOURNAL_SCHEMA,
    });
  }
}
const tables: SyncTableMap = { tasks: { schemaVersion: 1 } };
const databases: TaskDatabase[] = [];
const controllers: { dispose(): void }[] = [];
afterEach(async () => {
  for (const controller of controllers.splice(0)) controller.dispose();
  const names = [...new Set(databases.map((db) => db.name))];
  for (const db of databases.splice(0)) db.close();
  for (const name of names) await Dexie.delete(name);
});

const key = (id: string) => encodeSyncKey("tasks", id);

/** The production server's rules in memory: one compacted row per key, last write wins. */
function server() {
  const rows = new Map<string, SyncRecord>();
  let seq = 0;
  let dropNextAnswer = false;
  const store = (change: SyncPushChange, deviceId: string) => {
    const current = rows.get(change.key);
    const incoming = { ...change, deviceId, serverSeq: 0 };
    if (current && compareSyncVersions(current, incoming) >= 0)
      return { accepted: false, winner: current };
    const winner = { ...incoming, serverSeq: ++seq };
    rows.set(change.key, winner);
    return { accepted: true, winner };
  };
  const remote: SyncRemote = {
    async pull(deviceId, request) {
      const records = [...rows.values()]
        .filter(
          (record) =>
            record.serverSeq > request.cursor &&
            !(request.excludeOwnDevice && record.deviceId === deviceId),
        )
        .sort((a, b) => a.serverSeq - b.serverSeq);
      return { records, cursor: seq, head: seq, hasMore: false };
    },
    async push(deviceId, changes) {
      const results = changes.map((change) => store(change, deviceId));
      if (dropNextAnswer) {
        dropNextAnswer = false;
        throw new SyncNetworkError("The answer was lost");
      }
      return { results };
    },
  };
  return {
    remote,
    /** Another device's edit, already on the server. */
    write(
      deviceId: string,
      id: string,
      title: string,
      at: number,
      isDeleted = false,
    ) {
      store(
        {
          key: key(id),
          value: encodeSyncValue({ id, title, isDeleted }),
          isDeleted,
          schemaVersion: 1,
          hlc: { wallTimeMs: at, counter: 0 },
        },
        deviceId,
      );
    },
    /** The next push commits, and its answer never arrives. */
    dropNextAnswer() {
      dropNextAnswer = true;
    },
  };
}

/** One device: its database, sync client, controller and journal. */
function device(deviceId: string, remote: SyncRemote) {
  const values = new Map<string, string>();
  const state = createSyncClientStateStore(
    {
      getItem: (name) => values.get(name) ?? null,
      setItem: (name, value) => void values.set(name, value),
    },
    deviceId,
  );
  getOrCreateSyncClientState(deviceId, state);
  const clock = { now: 1_000 };
  const db = new TaskDatabase(`journal-${crypto.randomUUID()}`);
  const raw = new TaskDatabase(db.name);
  databases.push(db, raw);
  installSync(db, tables, (count) => nextSyncHlcBatch(count, state, clock.now));
  const journal = createSyncJournal({
    store: new DexieSyncJournalStore(raw),
    now: () => clock.now,
  });
  const controller = createSyncController({
    run: ({ signal, pass }) =>
      new SyncClient({
        storage: new DexieSyncStorage({ db: raw, tables }),
        stateStore: state,
        remote,
        signal,
      })
        .sync({ observer: pass })
        .then(() => undefined),
    network: { isOnline: () => true, subscribe: () => () => {} },
    intervalMs: 0,
    retry: { initialMs: 60_000 },
    journal,
  });
  controllers.push(controller);
  return { db, raw, state, clock, journal, controller };
}

async function entriesOf(journal: SyncJournal): Promise<SyncJournalEntry[]> {
  await journal.flush();
  await journal.refresh();
  return [...journal.getSnapshot().entries];
}

const passes = (entries: readonly SyncJournalEntry[]) =>
  entries.filter((entry): entry is SyncJournalPass => entry.type === "pass");

describe("sync journal", () => {
  it("records what each pass moved: keys, origin devices, change times and deletions, never values", async () => {
    const cloud = server();
    const laptop = device("laptop", cloud.remote);
    // The first pass restores an empty account and moves nothing.
    await laptop.controller.syncNow();
    cloud.write("phone", "read", "From the phone", 5_000);
    cloud.write("phone", "gone", "Removed on the phone", 6_000, true);
    laptop.clock.now = 7_000;
    await laptop.db.tasks.put({ id: "mine", title: "secret title" });

    expect(await laptop.controller.syncNow()).toEqual({ outcome: "synced" });

    const entries = await entriesOf(laptop.journal);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      type: "pass",
      trigger: "manual",
      outcome: "synced",
      received: [
        { key: key("read"), deviceId: "phone", at: 5_000, deleted: false },
        { key: key("gone"), deviceId: "phone", at: 6_000, deleted: true },
      ],
      sent: [{ key: key("mine"), at: 7_000, deleted: false }],
    });
    expect((entries[0] as SyncJournalPass).sent[0]!.lost).toBeUndefined();
    const stored = JSON.stringify(
      await laptop.raw.table("_sync_journal").toArray(),
    );
    expect(stored).not.toContain("secret title");
    expect(stored).not.toContain("From the phone");
  });

  it("reports an edit lost to a newer one, a pulled change that a newer edit here kept out, and a repeated push as kept", async () => {
    const cloud = server();
    const laptop = device("laptop", cloud.remote);
    await laptop.controller.syncNow();

    // Offline on both: the phone's edit to "shared" is newer, the laptop's
    // edit to "draft" is newer.
    laptop.clock.now = 10_000;
    await laptop.db.tasks.put({ id: "shared", title: "laptop" });
    await laptop.db.tasks.put({ id: "draft", title: "laptop" });
    cloud.write("phone", "shared", "phone", 20_000);
    cloud.write("phone", "draft", "phone", 5_000);
    await laptop.controller.syncNow();

    const [entry] = passes(await entriesOf(laptop.journal));
    expect(entry!.sent).toEqual(
      expect.arrayContaining([
        {
          key: key("shared"),
          at: 10_000,
          deleted: false,
          lost: { deviceId: "phone", at: 20_000, deleted: false },
        },
        { key: key("draft"), at: 10_000, deleted: false },
      ]),
    );
    expect(entry!.received).toContainEqual({
      key: key("draft"),
      deviceId: "phone",
      at: 5_000,
      deleted: false,
      keptLocal: true,
    });
    const history = summarizeSyncHistory(
      passes(await entriesOf(laptop.journal)),
      {
        now: 30_000,
        dayOf: () => 0,
      },
    );
    expect(history.lost).toEqual([
      expect.objectContaining({
        key: key("shared"),
        winner: { deviceId: "phone", at: 20_000, deleted: false },
      }),
    ]);
    expect(
      history.groups.find((group) => group.direction === "received")?.keptLocal,
    ).toBe(1);

    // The server takes the next edit, but its answer is lost. The retry
    // sends the same version again; that is kept, not lost.
    laptop.clock.now = 40_000;
    await laptop.db.tasks.put({ id: "late", title: "laptop" });
    cloud.dropNextAnswer();
    expect((await laptop.controller.syncNow()).outcome).toBe("failed");
    await laptop.controller.syncNow();
    const last = passes(await entriesOf(laptop.journal)).at(-1)!;
    expect(last.sent).toEqual([
      { key: key("late"), at: 40_000, deleted: false },
    ]);
  });

  it("keeps a restore as counts per table and device, not keys", async () => {
    const cloud = server();
    for (let index = 0; index < 30; index += 1)
      cloud.write(
        index % 3 ? "phone" : "tablet",
        `task-${index}`,
        "x",
        1_000 + index,
      );
    const laptop = device("laptop", cloud.remote);
    await laptop.controller.syncNow();
    const [entry] = passes(await entriesOf(laptop.journal));
    expect(entry).toMatchObject({
      restore: true,
      received: [],
      trigger: "manual",
    });
    expect(entry!.counts).toEqual(
      expect.arrayContaining([
        {
          direction: "received",
          deviceId: "phone",
          table: "tasks",
          changes: 20,
          deleted: 0,
          restore: true,
        },
        {
          direction: "received",
          deviceId: "tablet",
          table: "tasks",
          changes: 10,
          deleted: 0,
          restore: true,
        },
      ]),
    );
  });

  it("stores nothing for a quiet pass, folds repeated failures into one entry and marks when sync recovered", async () => {
    let failing = true;
    let clock = 0;
    const store = createMemorySyncJournalStore();
    const journal = createSyncJournal({ store, now: () => clock });
    const controller = createSyncController({
      run: async () => {
        if (failing) throw new SyncNetworkError("No answer");
      },
      network: { isOnline: () => true, subscribe: () => () => {} },
      intervalMs: 0,
      retry: { initialMs: 60_000 },
      journal,
    });
    controllers.push(controller);
    for (clock = 1_000; clock <= 4_000; clock += 1_000)
      await controller.syncNow();
    failing = false;
    clock = 9_000;
    await controller.syncNow();
    clock = 10_000;
    await controller.syncNow();
    await journal.flush();
    expect(store.entries()).toEqual([
      expect.objectContaining({
        outcome: "failed",
        failure: { kind: "network" },
        startedAt: 1_000,
        endedAt: 4_000,
        repeats: 4,
        recoveredAt: 9_000,
      }),
    ]);
  });

  it("keeps its bounds and closes a failure streak across reloads, with no view open", async () => {
    const day = 24 * 60 * 60_000;
    let clock = 0;
    const old: SyncJournalPass = {
      type: "pass",
      id: "old",
      startedAt: 0,
      endedAt: 0,
      trigger: "interval",
      outcome: "synced",
      received: [],
      sent: [{ key: key("old"), at: 0, deleted: false }],
      counts: [],
    };
    const store = createMemorySyncJournalStore([old]);
    // Each page lifetime has its own journal over the same store, and
    // nothing subscribes or refreshes.
    const page = () => createSyncJournal({ store, now: () => clock });
    const end = async (
      journal: SyncJournal,
      result: Parameters<ReturnType<SyncJournal["begin"]>["end"]>[0],
    ) => {
      journal.begin("start").end(result);
      await journal.flush();
    };
    const offline = {
      outcome: "failed",
      failure: new SyncNetworkError("No answer"),
    } as const;

    clock = 40 * day;
    await end(page(), offline);
    clock = 40 * day + 60_000;
    await end(page(), offline);
    clock = 40 * day + 120_000;
    await end(page(), { outcome: "synced" });

    // The 40-day-old pass went with the first page's first pass, and the
    // streak folded across a reload and was closed by the next page.
    expect(store.entries()).toEqual([
      expect.objectContaining({
        outcome: "failed",
        startedAt: 40 * day,
        endedAt: 40 * day + 60_000,
        repeats: 2,
        recoveredAt: 40 * day + 120_000,
      }),
    ]);
  });

  it("never throws into a sync: a journal error goes to onError", async () => {
    const errors: unknown[] = [];
    const journal = createSyncJournal({
      store: createMemorySyncJournalStore(),
      kindOf: () => {
        throw new Error("No kind");
      },
      onError: (error) => errors.push(error),
    });
    const pass = journal.begin("start");
    expect(() =>
      pass.pulled({
        records: [
          {
            key: key("one"),
            value: "{}",
            isDeleted: false,
            schemaVersion: 1,
            hlc: { wallTimeMs: 1, counter: 0 },
            deviceId: "laptop",
            serverSeq: 1,
          },
        ],
        restoring: true,
      }),
    ).not.toThrow();
    pass.end({ outcome: "synced" });
    await journal.flush();
    expect(errors).toEqual([new Error("No kind")]);
  });

  it("keeps a restore whole when older passes roll up", async () => {
    let clock = 1_000;
    const store = createMemorySyncJournalStore();
    const journal = createSyncJournal({
      store,
      now: () => clock,
      limits: { maxEntries: 2, compactEvery: 100 },
    });
    const restore = journal.begin("sign-in");
    restore.pulled({
      records: [
        {
          key: key("restored"),
          value: "{}",
          isDeleted: false,
          schemaVersion: 1,
          hlc: { wallTimeMs: 500, counter: 0 },
          deviceId: "laptop",
          serverSeq: 1,
        },
      ],
      restoring: true,
    });
    restore.end({ outcome: "synced" });
    for (const id of ["one", "two", "three"]) {
      clock += 60_000;
      const pass = journal.begin("change");
      const change: SyncPushChange = {
        key: key(id),
        value: "{}",
        isDeleted: false,
        schemaVersion: 1,
        hlc: { wallTimeMs: clock, counter: 0 },
      };
      pass.pushed({
        sent: [change],
        results: [
          {
            accepted: true,
            winner: { ...change, deviceId: "here", serverSeq: 2 },
          },
        ],
      });
      pass.end({ outcome: "synced" });
    }
    await journal.refresh();

    const entries = store.entries();
    expect(entries.filter((entry) => entry.type === "day")).toHaveLength(1);
    const history = summarizeSyncHistory(entries, { now: clock });
    expect(history.groups.map((group) => group.direction)).toContain(
      "restored",
    );
  });

  it("drops entries after 30 days and rolls the oldest passes into day counts beyond the caps, keeping lost edits", async () => {
    const day = 24 * 60 * 60_000;
    let clock = 0;
    const store = createMemorySyncJournalStore();
    const journal = createSyncJournal({
      store,
      now: () => clock,
      dayOf: (time) => Math.floor(time / day) * day,
      limits: { maxEntries: 3, compactEvery: 100 },
    });
    const pass = (at: number, id: string, lostTo?: string) => {
      clock = at;
      const recorder = journal.begin("interval");
      const change: SyncPushChange = {
        key: key(id),
        value: "{}",
        isDeleted: false,
        schemaVersion: 1,
        hlc: { wallTimeMs: at, counter: 0 },
      };
      recorder.pushed({
        sent: [change],
        results: [
          {
            accepted: !lostTo,
            winner: lostTo
              ? {
                  ...change,
                  value: '{"newer":true}',
                  hlc: { wallTimeMs: at + 1, counter: 0 },
                  deviceId: lostTo,
                  serverSeq: 1,
                }
              : { ...change, deviceId: "laptop", serverSeq: 1 },
          },
        ],
      });
      recorder.end({ outcome: "synced" });
    };
    pass(1 * day, "ancient");
    pass(40 * day, "old-1", "phone");
    pass(40 * day + 60_000, "old-2");
    pass(41 * day, "recent-1");
    pass(42 * day, "recent-2");
    pass(42 * day + 60_000, "recent-3");
    clock = 42 * day + 120_000;
    await journal.refresh();

    const entries = store.entries();
    expect(
      entries.map((entry) => entry.type === "pass" && entry.sent[0]!.key),
    ).not.toContain(key("ancient"));
    expect(passes(entries).map((entry) => entry.sent[0]!.key)).toEqual([
      key("recent-1"),
      key("recent-2"),
      key("recent-3"),
    ]);
    const rolled = entries.find((entry) => entry.type === "day");
    expect(rolled).toMatchObject({
      type: "day",
      day: 40 * day,
      passes: 2,
      counts: [{ direction: "sent", table: "tasks", changes: 1, deleted: 0 }],
      lost: [
        expect.objectContaining({
          key: key("old-1"),
          lost: expect.objectContaining({ deviceId: "phone" }),
        }),
      ],
    });
    expect(
      summarizeSyncHistory(entries, {
        now: clock,
        dayOf: (time) => Math.floor(time / day) * day,
      }).lost.map((edit) => edit.key),
    ).toEqual([key("old-1")]);
  });
});

describe("sync history", () => {
  const minute = 60_000;
  const day = 24 * 60 * minute;
  const today = 100 * day;
  const at = (hours: number, minutes = 0) =>
    today + hours * 60 * minute + minutes * minute;
  const books: Record<string, string> = {
    a: "Systems Performance",
    b: "Middlemarch",
  };
  /** Reader-like nouns: an id such as "a:1" is item 1 in book a. */
  const describe = (ref: SyncItemRef) => {
    if (ref.table === "progress")
      return {
        kind: "progress",
        one: "reading progress",
        other: "reading progress",
        mass: true,
        container: ref.key
          ? {
              id: decodeSyncKey(ref.key)[1].split(":")[0]!,
              label: books[decodeSyncKey(ref.key)[1].split(":")[0]!]!,
              one: "book",
              other: "books",
            }
          : undefined,
      };
    const book = ref.key ? decodeSyncKey(ref.key)[1].split(":")[0]! : undefined;
    return {
      kind: ref.table,
      one: ref.table.slice(0, -1),
      other: ref.table,
      ...(book
        ? {
            container: {
              id: book,
              label: books[book]!,
              one: "book",
              other: "books",
            },
          }
        : {}),
    };
  };

  function journalAt() {
    let clock = 0;
    const store = createMemorySyncJournalStore();
    const journal = createSyncJournal({ store, now: () => clock });
    const receive = (
      when: number,
      records: [device: string, table: string, id: string, made: number][],
      restoring = false,
    ) => {
      clock = when;
      const pass = journal.begin("interval");
      pass.pulled({
        restoring,
        records: records.map(([deviceId, table, id, made], index) => ({
          key: encodeSyncKey(table, id),
          value: "{}",
          isDeleted: false,
          schemaVersion: 1,
          hlc: { wallTimeMs: made, counter: 0 },
          deviceId,
          serverSeq: index + 1,
        })),
      });
      pass.end({ outcome: "synced" });
    };
    return { store, journal, receive };
  }

  it("groups by origin device and direction, within 10 minutes by when changes were made, and by day once older", async () => {
    const { store, journal, receive } = journalAt();
    receive(at(-10), [
      ["phone", "highlights", "a:1", at(-14)],
      ["phone", "highlights", "a:2", at(-20)],
    ]);
    receive(at(9, 40), [
      ["phone", "highlights", "a:3", at(9)],
      ["phone", "highlights", "a:4", at(9, 5)],
      ["tablet", "highlights", "b:1", at(9, 2)],
      ["phone", "progress", "a:p", at(9, 6)],
      ["phone", "notes", "b:9", at(9, 30)],
    ]);
    // Arrives in a later pass, a minute after the 9:30 note: same group.
    receive(at(10), [["phone", "progress", "b:p", at(9, 31)]]);
    // Made yesterday, arrived today: yesterday's group, seen today.
    receive(at(10, 5), [["phone", "notes", "a:8", at(-5)]]);
    await journal.flush();

    const history = summarizeSyncHistory(store.entries(), {
      now: at(11),
      describe,
      dayOf: (time) => Math.floor(time / day) * day,
    });
    const words = history.groups.map((group) => [
      group.direction,
      group.deviceId,
      group.byDay,
      group.items.map(phraseSyncItem),
    ]);
    expect(words).toEqual([
      [
        "received",
        "phone",
        false,
        ["1 note in Middlemarch", "reading progress in Middlemarch"],
      ],
      [
        "received",
        "phone",
        false,
        [
          "2 highlights in Systems Performance",
          "reading progress in Systems Performance",
        ],
      ],
      ["received", "tablet", false, ["1 highlight in Middlemarch"]],
      [
        "received",
        "phone",
        true,
        [
          "2 highlights in Systems Performance",
          "1 note in Systems Performance",
        ],
      ],
    ]);
    const yesterday = history.groups.at(-1)!;
    expect(yesterday).toMatchObject({
      from: at(-20),
      to: at(-5),
      seenTo: at(10, 5),
    });
    expect(history.lastFrom.get("phone")).toBe(history.groups[0]);
  });

  it("makes one group of a restore, across the devices its records came from and a pass that failed between", async () => {
    const { store, journal, receive } = journalAt();
    receive(
      at(8),
      [
        ["phone", "highlights", "a:1", at(-30)],
        ["laptop", "notes", "b:1", at(-40)],
      ],
      true,
    );
    const failed = journal.begin("retry");
    failed.end({
      outcome: "failed",
      failure: { kind: "network", message: "No answer" },
    });
    receive(at(8, 3), [["phone", "highlights", "a:2", at(-30)]], true);
    receive(at(9), [["phone", "notes", "a:5", at(8, 59)]]);
    await journal.flush();

    const history = summarizeSyncHistory(store.entries(), {
      now: at(11),
      describe,
      dayOf: (time) => Math.floor(time / day) * day,
    });
    const restored = history.groups.filter(
      (group) => group.direction === "restored",
    );
    expect(restored).toHaveLength(1);
    expect(restored[0]).toMatchObject({
      changes: 3,
      devices: [
        { deviceId: "phone", changes: 2 },
        { deviceId: "laptop", changes: 1 },
      ],
    });
    expect(restored[0]!.items.map(phraseSyncItem)).toEqual([
      "2 highlights changed",
      "1 note changed",
    ]);
  });
});
