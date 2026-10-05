import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store";
import { pull, syncFiles, readFetch } from "../src/sync";
import { snapshot, verifySnapshot } from "../src/snapshot";
import { createSyncPullStream, type SyncRecord } from "@zsh-eng/local-sync";
const record = (seq: number, table = "books", deleted = false): SyncRecord => ({
  key: JSON.stringify([table, String(seq)]),
  value: JSON.stringify({ title: "fixture" }),
  schemaVersion: 1,
  hlc: { wallTimeMs: seq, counter: 0 },
  deviceId: "other",
  serverSeq: seq,
  isDeleted: deleted,
});

test("HTTP streaming to SQLite: independent selections, rollback/resume, epochs, files and snapshots", async () => {
  const directory = mkdtempSync(join(tmpdir(), "wb-integration-"));
  let epoch = "one",
    userId = "user",
    truncate = false;
  const records = [record(1), record(2, "notes"), record(3, "books", true)];
  const bytes = new TextEncoder().encode("EPUB fixture");
  const fileId = `xxh64:${Bun.hash.xxHash64(bytes).toString(16).padStart(16, "0")}`;
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      const u = new URL(req.url),
        scope = {
          origin: u.origin,
          userId,
          namespace: u.pathname.includes("/spaced/") ? "spaced" : "reader",
          epoch,
        };
      const headers = { "X-Sync-Scope": JSON.stringify(scope) };
      if (req.headers.get("Authorization") !== "Bearer fixture")
        return new Response("", { status: 401 });
      if (req.method !== "GET") throw Error("Outbound write");
      if (u.pathname.endsWith("/state")) return Response.json(scope);
      if (req.headers.get("X-Sync-Scope") !== JSON.stringify(scope))
        return new Response("", { status: 409 });
      if (u.pathname.endsWith("/pull-stream")) {
        const cursor = Number(u.searchParams.get("cursor")),
          head = Number(
            u.searchParams.get("head") ?? records.at(-1)!.serverSeq,
          );
        const rows = records.filter(
          (r) => r.serverSeq > cursor && r.serverSeq <= head,
        );
        async function* pages() {
          for (let i = 0; i < rows.length; i++)
            yield {
              records: [rows[i]],
              cursor: i === rows.length - 1 ? head : rows[i].serverSeq,
              head,
              hasMore: i < rows.length - 1,
            };
          if (!rows.length)
            yield { records: [], cursor: head, head, hasMore: false };
        }
        if (truncate)
          return new Response(
            JSON.stringify({
              records: rows.slice(0, 1),
              cursor: rows[0].serverSeq,
              head,
              hasMore: true,
            }) + "\n",
            { headers: { ...headers, "Content-Type": "application/x-ndjson" } },
          );
        return new Response(createSyncPullStream(pages()), {
          headers: { ...headers, "Content-Type": "application/x-ndjson" },
        });
      }
      if (u.pathname.endsWith("/files"))
        return Response.json(
          {
            files: [
              {
                id: fileId,
                fileSize: bytes.length,
                mediaType: "application/epub+zip",
                createdAt: 1,
              },
            ],
          },
          { headers },
        );
      if (decodeURIComponent(u.pathname).endsWith(fileId))
        return new Response(bytes, { headers });
      return new Response("", { status: 404 });
    },
  });
  const origin = server.url.origin;
  let store = new Store(directory);
  try {
    await pull(store, origin, "fixture", "reader", ["books"]);
    expect(store.db.query("SELECT * FROM records").all()).toHaveLength(2);
    await pull(store, origin, "fixture", "reader");
    expect(store.db.query("SELECT * FROM records").all()).toHaveLength(3);
    expect((await pull(store, origin, "fixture", "reader")).scanned).toBe(0);
    records.push(record(4));
    truncate = true;
    await expect(pull(store, origin, "fixture", "reader")).rejects.toThrow(
      "Truncated",
    );
    expect(store.state("reader", "*").read()!.pullCursor).toBe(3);
    store.close();
    store = new Store(directory);
    truncate = false;
    expect((await pull(store, origin, "fixture", "reader")).saved).toBe(1);
    expect(
      (await syncFiles(store, origin, "fixture", "reader")).downloaded,
    ).toBe(1);
    expect(
      (await syncFiles(store, origin, "fixture", "reader")).downloaded,
    ).toBe(0);
    const snap = snapshot(store);
    expect(verifySnapshot(snap.path).ok).toBe(true);
    const path = join(snap.path, "records.sqlite");
    writeFileSync(path, new Uint8Array([0]));
    expect(() => verifySnapshot(snap.path)).toThrow("checksum");
    epoch = "two";
    await expect(pull(store, origin, "fixture", "reader")).rejects.toThrow();
    epoch = "one";
    userId = "stranger";
    await expect(pull(store, origin, "fixture", "reader")).rejects.toThrow();
    await expect(
      readFetch(origin, "fixture")(origin + "/api/apps/reader/sync/v3/push", {
        method: "POST",
      }),
    ).rejects.toThrow("Read-only");
    expect(store.db.query("SELECT * FROM records").all()).toHaveLength(4);
  } finally {
    store.close();
    server.stop(true);
    rmSync(directory, { recursive: true, force: true });
  }
});

test("records and cursor commit atomically on database failure", () => {
  const dir = mkdtempSync(join(tmpdir(), "wb-atomic-")),
    s = new Store(dir);
  try {
    const state = s.state("reader", "*");
    s.db.exec(
      "CREATE TRIGGER reject_record BEFORE INSERT ON records WHEN NEW.record_id='2' BEGIN SELECT RAISE(ABORT,'fixture failure'); END",
    );
    expect(() => s.apply("reader", [record(1), record(2)], state, 2)).toThrow();
    expect(s.db.query("SELECT * FROM records").all()).toHaveLength(0);
    expect(state.read()!.pullCursor).toBe(0);
  } finally {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("writer lease excludes another process and recovers after termination", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wb-lock-"));
  const lockModule = join(import.meta.dirname, "../src/lock.ts");
  const child = Bun.spawn(
    [
      "bun",
      "-e",
      `import {writerLock} from ${JSON.stringify(lockModule)};writerLock(${JSON.stringify(dir)});console.log('locked');await Bun.sleep(60000);`,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const reader = child.stdout.getReader();
  await reader.read();
  reader.releaseLock();
  const { writerLock } = await import("../src/lock");
  try {
    expect(() => writerLock(dir)).toThrow("Another");
    child.kill();
    await child.exited;
    const release = writerLock(dir);
    release();
  } finally {
    child.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});
