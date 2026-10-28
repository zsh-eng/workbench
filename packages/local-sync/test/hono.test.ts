import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import {
  createSyncHonoRoutes,
  SYNC_D1_SCHEMA_SQL,
} from "@zsh-eng/local-sync/hono";
import { sqliteD1 } from "./sqlite-d1";
import {
  syncTablePrefix,
  type SyncPushChange,
  type SyncPushResponse,
  type SyncPullResponse,
} from "@zsh-eng/local-sync";

const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
type AppEnv = { Variables: { account: string; device: string | undefined } };

function app() {
  const sqlite = new DatabaseSync(":memory:");
  databases.push(sqlite);
  sqlite.exec(SYNC_D1_SCHEMA_SQL);
  const { database, statements } = sqliteD1(sqlite);
  const routes = new Hono<AppEnv>().route(
    "/bridge",
    createSyncHonoRoutes<AppEnv>({
      requireAuth: async (c, next) => {
        // Authentication fixture: production hosts supply their own session middleware.
        const account = c.req.header("Test-Account");
        if (!account) return c.json({ error: "Unauthorized" }, 401);
        c.set("account", account);
        c.set("device", c.req.header("Test-Device"));
        await next();
      },
      getIdentity: (c) => ({
        userId: c.get("account"),
        deviceId: c.get("device"),
      }),
      getDatabase: () => database,
      now: () => 1_000,
    }),
  );
  return Object.assign(routes, { sqlite, statements });
}
function change(
  key: string,
  counter: number,
  isDeleted = false,
): SyncPushChange {
  return {
    key,
    value: `opaque value ${counter}`,
    hlc: { wallTimeMs: 1_000, counter },
    schemaVersion: 7,
    isDeleted,
  };
}
function headers(account = "a", device = "one") {
  return {
    "Content-Type": "application/json",
    "Test-Account": account,
    "Test-Device": device,
  };
}

describe("standalone Hono/D1 adapter", () => {
  it("keeps opaque winners, handles retries, and isolates authenticated accounts", async () => {
    const api = app();
    const push = async (changes: SyncPushChange[], account = "a") => {
      const response = await api.request("/bridge/push", {
        method: "POST",
        headers: headers(account),
        body: JSON.stringify({ changes }),
      });
      expect(response.status).toBe(200);
      return response.json() as Promise<SyncPushResponse>;
    };
    const initial = await push([change("key", 2)]);
    const duplicate = await push([change("key", 2)]);
    expect(duplicate.results[0]).toEqual({
      accepted: false,
      winner: initial.results[0]!.winner,
    });
    expect((await push([change("key", 1)])).results[0]?.winner.value).toBe(
      "opaque value 2",
    );
    expect(
      (await push([change("key", 3, true)])).results[0]?.winner.isDeleted,
    ).toBe(true);
    expect((await push([change("key", 0)], "b")).results[0]?.winner.value).toBe(
      "opaque value 0",
    );
  });

  it("paginates a fixed head and advances across omitted own-device records", async () => {
    const api = app();
    await api.request("/bridge/push", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        changes: [change("first", 1), change("second", 2)],
      }),
    });
    const firstResponse = await api.request(
      "/bridge/pull?cursor=0&limit=1&excludeOwnDevice=false",
      { headers: headers("a", "two") },
    );
    expect(firstResponse.headers.get("Cache-Control")).toBe("no-store");
    const first = (await firstResponse.json()) as SyncPullResponse;
    expect(first.hasMore).toBe(true);
    await api.request("/bridge/push", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ changes: [change("third", 3)] }),
    });
    const second = (await (
      await api.request(
        `/bridge/pull?cursor=${first.cursor}&head=${first.head}&limit=1&excludeOwnDevice=false`,
        { headers: headers("a", "two") },
      )
    ).json()) as SyncPullResponse;
    expect(second.records.map((row) => row.key)).toEqual(["second"]);
    expect(second).toMatchObject({
      cursor: first.head,
      head: first.head,
      hasMore: false,
    });
    const own = (await (
      await api.request("/bridge/pull?cursor=0&excludeOwnDevice=true", {
        headers: headers(),
      })
    ).json()) as SyncPullResponse;
    expect(own.records).toEqual([]);
    expect(own.cursor).toBeGreaterThan(first.head);
  });

  it("rejects unauthenticated, invalid-device and future-clock writes", async () => {
    const api = app();
    const send = (
      requestHeaders: Record<string, string>,
      changes: SyncPushChange[],
    ) =>
      api.request("/bridge/push", {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify({ changes }),
      });
    expect(
      (await send({ "Content-Type": "application/json" }, [])).status,
    ).toBe(401);
    expect((await send(headers("a", "bad device"), [])).status).toBe(400);
    expect(
      (
        await send(headers(), [
          { ...change("future", 0), hlc: { wallTimeMs: 400_000, counter: 0 } },
        ])
      ).status,
    ).toBe(400);
    const empty = (await (
      await api.request("/bridge/pull?cursor=0&excludeOwnDevice=false", {
        headers: headers(),
      })
    ).json()) as SyncPullResponse;
    expect(empty).toMatchObject({ records: [], cursor: 0 });
  });
});

describe("streaming Hono/D1 pull", () => {
  it("enforces auth and bounded windows, retaining the head across requests", async () => {
    const api = app();
    expect(
      (await api.request("/bridge/pull-stream?cursor=0&excludeOwnDevice=false"))
        .status,
    ).toBe(401);
    const headers = {
      "Test-Account": "owner",
      "Test-Device": "writer",
      "Content-Type": "application/json",
    };
    const changes = Array.from({ length: 40 }, (_, n) => change(`key-${n}`, n));
    expect(
      (
        await api.request("/bridge/push", {
          method: "POST",
          headers,
          body: JSON.stringify({ changes }),
        })
      ).status,
    ).toBe(200);
    const read = async (cursor: number, head?: number) => {
      const result = await api.request(
        `/bridge/pull-stream?cursor=${cursor}&limit=1&excludeOwnDevice=false${head === undefined ? "" : `&head=${head}`}`,
        { headers },
      );
      expect(result.status).toBe(200);
      return (await result.text())
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
    };
    const first = await read(0);
    expect(first).toHaveLength(33);
    expect(first.at(-1)).toEqual({ type: "end" });
    expect(first[31].hasMore).toBe(true);
    const second = await read(first[31].cursor, first[0].head);
    expect(second).toHaveLength(9);
    expect(second[7].hasMore).toBe(false);
    const other = await api.request(
      "/bridge/pull-stream?cursor=0&excludeOwnDevice=false",
      { headers: { ...headers, "Test-Account": "other" } },
    );
    expect(
      (await other.text()).split("\n").map((s) => s && JSON.parse(s))[0]
        .records,
    ).toEqual([]);
  });
  it("bounds page bytes in SQL and serves negotiated gzip without losing records", async () => {
    const api = app();
    const headers = {
      "Test-Account": "owner",
      "Test-Device": "writer",
      "Content-Type": "application/json",
    };
    for (let batch = 0; batch < 3; batch++) {
      const changes = Array.from({ length: 8 }, (_, n) => ({
        ...change(`large-${batch}-${n}`, batch * 8 + n),
        value: "x".repeat(60_000),
      }));
      expect(
        (
          await api.request("/bridge/push", {
            method: "POST",
            headers,
            body: JSON.stringify({ changes }),
          })
        ).status,
      ).toBe(200);
    }
    const result = await api.request(
      "/bridge/pull-stream?cursor=0&excludeOwnDevice=false",
      { headers: { ...headers, "Accept-Encoding": "gzip" } },
    );
    expect(result.headers.get("Content-Encoding")).toBe("gzip");
    const text = await new Response(
      result.body!.pipeThrough(new DecompressionStream("gzip")),
    ).text();
    const frames = text
      .trim()
      .split("\n")
      .map((s) => JSON.parse(s));
    expect(frames.at(-1)).toEqual({ type: "end" });
    const pages = frames.slice(0, -1);
    expect(pages).toHaveLength(3);
    expect(pages.flatMap((p) => p.records)).toHaveLength(24);
    expect(pages.every((p) => p.records.length <= 8)).toBe(true);
    const raw = await api.request(
      "/bridge/pull-stream?cursor=0&excludeOwnDevice=false",
      { headers: { ...headers, "Accept-Encoding": "gzip;q=0" } },
    );
    expect(raw.headers.get("Content-Encoding")).toBeNull();
    await raw.body?.cancel();
  });
});

describe("key-prefix pull", () => {
  it("returns only keys with a prefix, in sequence order, through the key index", async () => {
    const api = app();
    const keys = [
      ["notes", "1"],
      ["books", "b"],
      ["booksArchive", "x"],
      ["readingState", "s"],
      ["notes", "2"],
      ["books", "a"],
    ].map(([table, id]) => JSON.stringify([table, id]));
    await api.request("/bridge/push", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ changes: keys.map((key, n) => change(key, n)) }),
    });
    await api.request("/bridge/push", {
      method: "POST",
      headers: headers("b"),
      body: JSON.stringify({ changes: [change(keys[1]!, 9)] }),
    });
    const prefixes = ["books", "readingState"].map(syncTablePrefix);
    // A prefix inside another is read once.
    const query = [...prefixes, prefixes[0]!.slice(0, -1)]
      .map((prefix) => `prefix=${encodeURIComponent(prefix)}`)
      .join("&");
    const read = async (path: string, account = "a") => {
      const response = await api.request(
        `/bridge/${path}?cursor=0&excludeOwnDevice=false&limit=2&${query}`,
        { headers: headers(account, "new") },
      );
      expect(response.status).toBe(200);
      return path === "pull"
        ? [(await response.json()) as SyncPullResponse]
        : ((await response.text())
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line))
            .slice(0, -1) as SyncPullResponse[]);
    };
    const pages = await read("pull-stream");
    // Not `["booksArchive",…]`: a prefix ends at its comma.
    expect(pages.flatMap((page) => page.records.map((r) => r.key))).toEqual([
      keys[1],
      keys[3],
      keys[5],
    ]);
    expect(pages.at(-1)).toMatchObject({ cursor: 6, head: 6, hasMore: false });
    const [first] = await read("pull");
    expect(first!.records.map((r) => r.key)).toEqual([keys[1], keys[3]]);
    expect(first).toMatchObject({ cursor: 4, hasMore: true });
    expect(
      (await read("pull-stream", "b")).flatMap((page) => page.records),
    ).toHaveLength(1);

    const page = api.statements.findLast(({ sql }) =>
      sql.includes("json_each(?) AS range"),
    )!;
    const plan = api.sqlite
      .prepare(`EXPLAIN QUERY PLAN ${page.sql}`)
      .all(...page.values)
      .map((row) => (row as { detail: string }).detail);
    // The key index chooses the page; its rows are then read by sequence.
    expect(plan).toContainEqual(
      expect.stringMatching(
        /^SEARCH candidate USING INDEX sync_records_user_key_unique \(user_id=\? AND key>\? AND key<\?\)$/,
      ),
    );
    expect(plan).toContainEqual(
      "SEARCH sync_records USING INTEGER PRIMARY KEY (rowid=?)",
    );
    expect(
      plan.some((step) => /^SCAN (candidate|sync_records)( |$)/.test(step)),
    ).toBe(false);
  });

  it("refuses prefixes it cannot read as key ranges", async () => {
    const api = app();
    const status = async (query: string) =>
      (
        await api.request(
          `/bridge/pull-stream?cursor=0&excludeOwnDevice=false&${query}`,
          { headers: headers() },
        )
      ).status;
    expect(await status("prefix=")).toBe(400);
    expect(await status(`prefix=${encodeURIComponent("bücher/")}`)).toBe(400);
    expect(await status(`prefix=${"a".repeat(257)}`)).toBe(400);
    expect(
      await status(
        Array.from({ length: 9 }, (_, n) => `prefix=t${n}`).join("&"),
      ),
    ).toBe(400);
    expect(await status("prefix=t1&prefix=t2")).toBe(200);
  });
});
