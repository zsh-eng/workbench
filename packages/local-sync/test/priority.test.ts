import "fake-indexeddb/auto";
import Dexie, { type Table } from "dexie";
import { Hono } from "hono";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SyncClient,
  SyncHttpError,
  createNamespacedHttpClient,
  createSyncClientState,
  encodeSyncKey,
  syncTablePrefix,
  type SyncClientState,
  type SyncPullResponse,
  type SyncPushChange,
  type SyncRecord,
  type SyncStorage,
} from "@zsh-eng/local-sync";
import {
  createSyncHonoRoutes,
  NAMESPACED_SYNC_D1_SCHEMA_SQL,
} from "@zsh-eng/local-sync/hono";
import {
  DexieSyncStorage,
  type PreparedRemoteRecord,
  type SyncTableMap,
} from "@zsh-eng/local-sync/dexie";
import { sqliteD1 } from "./sqlite-d1";

const ORIGIN = "https://sync.test";
const BASE = `${ORIGIN}/api/apps/library`;
type Row = { id: string; title: string; isDeleted: boolean };
class LibraryDatabase extends Dexie {
  books!: Table<Row, string>;
  notes!: Table<Row, string>;
  _sync_outbox!: Table<SyncPushChange, string>;
  constructor(name: string) {
    super(name);
    this.version(1).stores({ books: "id", notes: "id", _sync_outbox: "key" });
  }
}
const tables: SyncTableMap = {
  books: { schemaVersion: 1 },
  notes: { schemaVersion: 1 },
};
const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0)) await step();
});

/**
 * A namespaced host like apps/sync-server: the scope on every response, a
 * changed scope refused with 409 before the sync routes, and the package's
 * routes and SQL on SQLite. `held` delays the full pull's request (a pull
 * stream without `prefix`) until `release`.
 */
function host() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(NAMESPACED_SYNC_D1_SCHEMA_SQL);
  cleanup.push(() => sqlite.close());
  const { database } = sqliteD1(sqlite);
  let epoch = "one";
  const scope = () =>
    JSON.stringify({
      origin: ORIGIN,
      userId: "user",
      namespace: "library",
      epoch,
    });
  const requests: string[] = [];
  const app = new Hono()
    .use("/api/apps/library/*", async (c, next) => {
      const url = new URL(c.req.url);
      requests.push(
        url.pathname.slice(BASE.length - ORIGIN.length) +
          (url.searchParams.has("prefix") ? "?prefix" : ""),
      );
      const current = scope();
      const sent = c.req.header("X-Sync-Scope");
      if (
        /\/sync\/v3\/(push|pull|pull-stream)$/.test(c.req.path) &&
        sent !== current
      )
        return c.json({ error: "SYNC_SCOPE_CHANGED" }, 409, {
          "X-Sync-Scope": current,
        });
      await next();
      // After the route: a streamed Response does not carry earlier headers.
      c.res.headers.set("X-Sync-Scope", current);
    })
    .get("/api/apps/library/sync/v3/state", (c) =>
      c.body(scope(), 200, { "Content-Type": "application/json" }),
    )
    .route(
      "/api/apps/library/sync/v3",
      createSyncHonoRoutes({
        requireAuth: (_, next) => next(),
        getIdentity: (c) => ({
          userId: "user",
          namespace: "library",
          deviceId: c.req.header("X-Device-ID"),
        }),
        getDatabase: () => database,
      }),
    );
  let release = () => {};
  let held: Promise<void> | undefined;
  return {
    requests,
    hold() {
      held = new Promise((resolve) => (release = resolve));
    },
    release: () => release(),
    resetEpoch() {
      epoch = "two";
    },
    async fetch(input: RequestInfo | URL, init?: RequestInit) {
      const url = String(input instanceof Request ? input.url : input);
      if (held && url.includes("/pull-stream?") && !url.includes("prefix="))
        await held;
      return app.request(url, init);
    },
    /** Another device's writes, straight to the server. */
    async push(changes: SyncPushChange[]) {
      const response = await app.request(`${BASE}/sync/v3/push`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Device-ID": "phone",
          "X-Sync-Scope": scope(),
        },
        body: JSON.stringify({ changes }),
      });
      expect(response.status).toBe(200);
    },
  };
}

let clock = 1_000;
function change(
  table: string,
  id: string,
  title: string,
  isDeleted = false,
): SyncPushChange {
  clock += 1;
  return {
    key: encodeSyncKey(table, id),
    value: JSON.stringify({ id, title, isDeleted }),
    isDeleted,
    schemaVersion: 1,
    hlc: { wallTimeMs: clock, counter: 0 },
  };
}

/** An account moved from elsewhere: 600 notes, then three books (pages of 500). */
async function seed(server: ReturnType<typeof host>) {
  const notes = Array.from({ length: 600 }, (_, n) =>
    change("notes", `n${n}`, `Note ${n}`),
  );
  await server.push(notes.slice(0, 500));
  await server.push(notes.slice(500));
  await server.push(
    ["a", "b", "c"].map((id) => change("books", id, `Book ${id}`)),
  );
}

/**
 * A new device: its database, sync state and client. `commits` lists what
 * each committed batch held, with the cursor saved when it committed.
 */
function device(
  server: ReturnType<typeof host>,
  options: {
    fetch?: typeof fetch;
    signal?: AbortSignal;
    onCommit?: (tables: string[]) => void | Promise<void>;
    /** A storage that cannot name the keys a pending edit kept. */
    unnamedKeptLocal?: boolean;
  } = {},
) {
  let state: SyncClientState = createSyncClientState("tablet");
  const stateStore = {
    read: () => state,
    write: (next: SyncClientState) => {
      state = next;
    },
  };
  const db = new LibraryDatabase(`priority-${crypto.randomUUID()}`);
  cleanup.push(async () => {
    db.close();
    await Dexie.delete(db.name);
  });
  const dexie = new DexieSyncStorage({ db, tables });
  const commits: {
    tables: string[];
    keys: string[];
    cursor: number;
    bootstrapped: boolean;
  }[] = [];
  const storage: SyncStorage<readonly PreparedRemoteRecord[]> = {
    getPendingChanges: () => dexie.getPendingChanges(),
    prepareRemoteRecords: (records) => dexie.prepareRemoteRecords(records),
    reconcilePushResults: (sent, prepared) =>
      dexie.reconcilePushResults(sent, prepared),
    async applyRemoteRecords(prepared, deviceId) {
      const result = await dexie.applyRemoteRecords(prepared, deviceId);
      const names = [...new Set(prepared.map((record) => record.tableName))];
      commits.push({
        tables: names,
        keys: prepared.map((record) => record.source.key),
        cursor: state.pullCursor,
        bootstrapped: state.bootstrapped,
      });
      await options.onCommit?.(names);
      return options.unnamedKeptLocal
        ? { applied: result.applied, skipped: result.skipped }
        : result;
    },
  };
  /** A new client on this device's state and database, as each sync attempt makes. */
  const connect = () =>
    new SyncClient({
      storage,
      remote: createNamespacedHttpClient({
        origin: ORIGIN,
        namespace: "library",
        stateStore,
        fetch: options.fetch ?? ((input, init) => server.fetch(input, init)),
        signal: options.signal,
      }).remote,
      stateStore,
      signal: options.signal,
      priority: [syncTablePrefix("books")],
    });
  return { client: connect(), connect, db, commits, state: () => state };
}

describe("priority restore", () => {
  it("commits the priority prefixes first, without moving the cursor, then everything once", async () => {
    const server = host();
    await seed(server);
    const tablet = device(server);
    const result = await tablet.client.sync();

    expect(tablet.commits[0]).toEqual({
      tables: ["books"],
      keys: ["a", "b", "c"].map((id) => encodeSyncKey("books", id)),
      cursor: 0,
      bootstrapped: false,
    });
    // The full pull applies the notes; the books it sends again are skipped.
    expect(tablet.commits.slice(1).flatMap((commit) => commit.tables)).toEqual([
      "notes",
      "notes",
    ]);
    expect(result).toEqual({ pulled: 603, skipped: 0, pushed: 0 });
    expect(tablet.state()).toMatchObject({
      pullCursor: 603,
      bootstrapped: true,
    });
    expect(await tablet.db.books.count()).toBe(3);
    expect(await tablet.db.notes.count()).toBe(600);
    expect(server.requests.filter((path) => path.includes("pull"))).toEqual([
      "/sync/v3/pull-stream?prefix",
      "/sync/v3/pull-stream",
    ]);

    // A device that has restored pulls only what changed, without a priority pull.
    await server.push([change("notes", "n0", "Edited")]);
    await tablet.client.sync();
    expect(server.requests.filter((path) => path.includes("pull")).at(-1)).toBe(
      "/sync/v3/pull-stream",
    );
    expect((await tablet.db.notes.get("n0"))?.title).toBe("Edited");
  });

  it("keeps a newer version or a tombstone that the full pull brings", async () => {
    const server = host();
    await seed(server);
    server.hold();
    const tablet = device(server, {
      async onCommit(names) {
        if (!names.includes("books")) return;
        // Another device edits and deletes after the priority pull read them.
        await server.push([
          change("books", "a", "Book a, edited"),
          change("books", "b", "Book b", true),
        ]);
        server.release();
      },
    });
    await tablet.client.sync();
    expect(await tablet.db.books.toArray()).toEqual([
      { id: "a", title: "Book a, edited", isDeleted: false },
      { id: "b", title: "Book b", isDeleted: true },
      { id: "c", title: "Book c", isDeleted: false },
    ]);
    expect(tablet.state()).toMatchObject({
      pullCursor: 605,
      bootstrapped: true,
    });
  });

  it("does not replace a priority record with an older version of it", async () => {
    // Whatever order the server reads in, an older copy of a record the
    // priority pull applied never replaces it.
    const record = (title: string, serverSeq: number): SyncRecord => ({
      key: encodeSyncKey("books", "a"),
      value: JSON.stringify({ id: "a", title, isDeleted: false }),
      isDeleted: false,
      schemaVersion: 1,
      hlc: { wallTimeMs: 1_000 + serverSeq, counter: 0 },
      deviceId: "phone",
      serverSeq,
    });
    const page = (records: SyncRecord[], head: number): SyncPullResponse => ({
      records,
      cursor: head,
      head,
      hasMore: false,
    });
    let state = createSyncClientState("tablet");
    const db = new LibraryDatabase(`priority-${crypto.randomUUID()}`);
    cleanup.push(async () => {
      db.close();
      await Dexie.delete(db.name);
    });
    const client = new SyncClient({
      storage: new DexieSyncStorage({ db, tables }),
      stateStore: { read: () => state, write: (next) => void (state = next) },
      priority: [syncTablePrefix("books")],
      remote: {
        async *pullPrefixed() {
          yield page([record("New", 9)], 9);
        },
        async *pullStream() {
          yield page([record("Old", 3)], 8);
        },
        pull: () => Promise.reject(new Error("Unexpected page pull")),
        push: () => Promise.reject(new Error("Unexpected push")),
      },
    });
    await client.pull();
    expect((await db.books.get("a"))?.title).toBe("New");
    expect(state).toMatchObject({ pullCursor: 8, bootstrapped: true });
  });

  it("pulls page by page without a priority pull from a remote without a stream", async () => {
    let state = createSyncClientState("tablet");
    const db = new LibraryDatabase(`priority-${crypto.randomUUID()}`);
    cleanup.push(async () => {
      db.close();
      await Dexie.delete(db.name);
    });
    const client = new SyncClient({
      storage: new DexieSyncStorage({ db, tables }),
      stateStore: { read: () => state, write: (next) => void (state = next) },
      priority: [syncTablePrefix("books")],
      remote: {
        async *pullPrefixed() {
          throw new Error("Unexpected priority pull");
        },
        pull: async () => ({
          records: [
            {
              key: encodeSyncKey("books", "a"),
              value: JSON.stringify({ id: "a", title: "A", isDeleted: false }),
              isDeleted: false,
              schemaVersion: 1,
              hlc: { wallTimeMs: 1_000, counter: 0 },
              deviceId: "phone",
              serverSeq: 1,
            },
          ],
          cursor: 1,
          head: 1,
          hasMore: false,
        }),
        push: () => Promise.reject(new Error("Unexpected push")),
      },
    });
    expect(await client.pull()).toEqual({ pulled: 1, skipped: 0 });
    expect(state).toMatchObject({ pullCursor: 1, bootstrapped: true });
  });

  it("does a plain full pull when the server refuses the prefix filter", async () => {
    const server = host();
    await seed(server);
    const refused: string[] = [];
    // A server older than the filter: its strict query schema answers 400.
    const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("prefix=")) {
        refused.push(url);
        return new Response('{"success":false}', { status: 400 });
      }
      return server.fetch(input, init);
    };
    const tablet = device(server, { fetch });
    expect(await tablet.client.sync()).toEqual({
      pulled: 603,
      skipped: 0,
      pushed: 0,
    });
    expect(refused).toHaveLength(1);
    expect(tablet.commits.map((commit) => commit.tables)).toEqual([
      ["notes"],
      ["notes", "books"],
    ]);
    expect(tablet.state()).toMatchObject({
      pullCursor: 603,
      bootstrapped: true,
    });
  });

  it("stops both pulls on sign-out during the priority pull and keeps the cursor", async () => {
    const server = host();
    await seed(server);
    const signOut = new AbortController();
    const tablet = device(server, {
      signal: signOut.signal,
      onCommit: () =>
        signOut.abort(new DOMException("Signed out", "AbortError")),
    });
    await expect(tablet.client.sync()).rejects.toThrow("Signed out");
    expect(tablet.commits.map((commit) => commit.tables)).toEqual([["books"]]);
    expect(tablet.state()).toMatchObject({
      pullCursor: 0,
      bootstrapped: false,
    });
    expect(await tablet.db.notes.count()).toBe(0);
  });

  it("fails the full pull's scope check after an epoch reset during the priority pull", async () => {
    const server = host();
    await seed(server);
    server.hold();
    const tablet = device(server, {
      onCommit(names) {
        if (!names.includes("books")) return;
        server.resetEpoch();
        server.release();
      },
    });
    const failure = await tablet.client.sync().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(SyncHttpError);
    expect((failure as SyncHttpError).status).toBe(409);
    expect(tablet.state()).toMatchObject({
      pullCursor: 0,
      bootstrapped: false,
    });
    expect(await tablet.db.notes.count()).toBe(0);
  });

  it("keeps a pending local edit in both pulls and pushes it", async () => {
    for (const unnamedKeptLocal of [false, true]) {
      const server = host();
      await seed(server);
      const tablet = device(server, { unnamedKeptLocal });
      // An edit made on this device before its restore reached the book.
      const edit = {
        ...change("books", "a", "Book a, edited here"),
        hlc: { wallTimeMs: Date.now(), counter: 0 },
      };
      await tablet.db.books.put({
        id: "a",
        title: "Book a, edited here",
        isDeleted: false,
      });
      await tablet.db._sync_outbox.put(edit);
      const result = await tablet.client.sync();
      expect((await tablet.db.books.get("a"))?.title).toBe(
        "Book a, edited here",
      );
      // Not knowing which book was kept, the full pull applies b and c again.
      expect(result).toEqual({
        pulled: unnamedKeptLocal ? 604 : 602,
        skipped: 2,
        pushed: 1,
      });
      // The full pull sees the kept book again; the others only when the
      // storage could not say which book it kept.
      const fullBooks = tablet.commits
        .slice(1)
        .flatMap((commit) => commit.keys)
        .filter((key) => key.startsWith(syncTablePrefix("books")));
      expect(fullBooks).toEqual(
        (unnamedKeptLocal ? ["a", "b", "c"] : ["a"]).map((id) =>
          encodeSyncKey("books", id),
        ),
      );
    }
  });

  it("leaves everything to the full pull when the server ignores the filter", async () => {
    const server = host();
    await seed(server);
    // A lenient server: it drops the parameter and answers a plain pull.
    const fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      url.searchParams.delete("prefix");
      return server.fetch(url, init);
    };
    const tablet = device(server, { fetch });
    expect(await tablet.client.sync()).toEqual({
      pulled: 603,
      skipped: 0,
      pushed: 0,
    });
    expect(tablet.commits.map((commit) => commit.tables)).toEqual([
      ["notes"],
      ["notes", "books"],
    ]);
    expect(tablet.state()).toMatchObject({
      pullCursor: 603,
      bootstrapped: true,
    });
  });

  it("does not pull the priority prefixes again once the full pull has committed", async () => {
    const server = host();
    await seed(server);
    let fail = true;
    const tablet = device(server, {
      onCommit(names) {
        if (fail && names.includes("notes") && tablet.commits.length === 3) {
          fail = false;
          throw new Error("Connection lost");
        }
      },
    });
    await expect(tablet.client.sync()).rejects.toThrow("Connection lost");
    expect(tablet.state()).toMatchObject({
      pullCursor: 500,
      bootstrapped: false,
    });
    await tablet.connect().sync();
    expect(server.requests.filter((path) => path.includes("pull"))).toEqual([
      "/sync/v3/pull-stream?prefix",
      "/sync/v3/pull-stream",
      "/sync/v3/pull-stream",
    ]);
    expect(tablet.state()).toMatchObject({
      pullCursor: 603,
      bootstrapped: true,
    });
    expect(await tablet.db.notes.count()).toBe(600);
  });

  it("sends the full pull again when it has waited too long for the priority pull", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    cleanup.push(() => vi.useRealTimers());
    const record = (key: string, serverSeq: number): SyncRecord => ({
      key,
      value: "v",
      isDeleted: false,
      schemaVersion: 1,
      hlc: { wallTimeMs: 1_000, counter: serverSeq },
      deviceId: "phone",
      serverSeq,
    });
    const book = record(encodeSyncKey("books", "a"), 2);
    const note = record(encodeSyncKey("notes", "n"), 1);
    let release = () => {};
    const slowCommit = new Promise<void>((resolve) => (release = resolve));
    const opened: string[] = [];
    const stored = new Map<string, number>();
    let state = createSyncClientState("tablet");
    const client = new SyncClient<readonly SyncRecord[]>({
      stateStore: { read: () => state, write: (next) => void (state = next) },
      priority: [syncTablePrefix("books")],
      storage: {
        getPendingChanges: async () => [],
        prepareRemoteRecords: (records) => records,
        reconcilePushResults: async () => 0,
        async applyRemoteRecords(records) {
          if (records.some((r) => r.key === book.key)) await slowCommit;
          for (const r of records)
            stored.set(r.key, (stored.get(r.key) ?? 0) + 1);
          return { applied: records.length, skipped: 0, keptLocal: [] };
        },
      },
      remote: {
        async *pullPrefixed() {
          opened.push("priority");
          yield { records: [book], cursor: 2, head: 2, hasMore: false };
        },
        async *pullStream(_device, _request, signal) {
          opened.push("full");
          await Promise.resolve();
          signal.throwIfAborted();
          yield { records: [note, book], cursor: 2, head: 2, hasMore: false };
        },
        pull: () => Promise.reject(new Error("Unexpected page pull")),
        push: () => Promise.reject(new Error("Unexpected push")),
      },
    });
    const pulling = client.pull();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(opened).toEqual(["priority", "full"]);
    release();
    expect(await pulling).toEqual({ pulled: 2, skipped: 0 });
    expect(opened).toEqual(["priority", "full", "full"]);
    expect(Object.fromEntries(stored)).toEqual({
      [book.key]: 1,
      [note.key]: 1,
    });
    expect(state).toMatchObject({ pullCursor: 2, bootstrapped: true });
  });
});
