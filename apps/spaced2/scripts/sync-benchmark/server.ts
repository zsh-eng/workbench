/** Local-only, read-only snapshot benchmark. Never connects to production. */
import { Database, type SQLQueryBindings } from "bun:sqlite";
import {
  createSyncHonoRoutes,
  type SyncD1Database,
} from "@zsh-eng/local-sync/hono";
import { gzipSync } from "node:zlib";
const snapshot = process.argv[2];
if (!snapshot)
  throw new Error(
    "Usage: bun scripts/sync-benchmark/server.ts <snapshot.sqlite>",
  );
const cleanupOnly = snapshot === "--cleanup-only";
interface SnapshotRow {
  user_id: string;
  key: string;
  value: string;
  is_deleted: number;
  schema_version: number;
  hlc_wall_time_ms: number;
  hlc_counter: number;
  device_id: string;
  server_seq: number;
}
const rows: SnapshotRow[] = cleanupOnly
  ? []
  : (() => {
      const db = new Database(snapshot, { readonly: true });
      const owner = db
        .query<{ user_id: string; n: number }, []>(
          "SELECT user_id, COUNT(*) n FROM sync_records GROUP BY user_id ORDER BY n DESC LIMIT 1",
        )
        .get()!;
      const snapshotRows = db
        .query<SnapshotRow, [string]>(
          "SELECT * FROM sync_records WHERE user_id=? ORDER BY server_seq",
        )
        .all(owner.user_id);
      db.close();
      return snapshotRows;
    })();
// Integration check: use the installed library's real SQL and streaming response,
// with a read-only snapshot and a loopback-only authentication fixture.
const actualDb = cleanupOnly
  ? null
  : new Database(snapshot, { readonly: true });
const adapter: SyncD1Database = {
  prepare(sql) {
    let values: SQLQueryBindings[] = [];
    return {
      bind(...bound: unknown[]) {
        values = bound as SQLQueryBindings[];
        return this;
      },
      async first<T>() {
        return actualDb!.query(sql).get(...values) as T | null;
      },
      async all<T>() {
        return { results: actualDb!.query(sql).all(...values) as T[] };
      },
    };
  },
  async batch() {
    throw new Error("Snapshot is read-only");
  },
};
const actualRoutes = createSyncHonoRoutes({
  requireAuth: async (_c, next) => next(),
  getIdentity: (c) => ({
    userId: rows[0]?.user_id,
    deviceId: c.req.header("X-Device-ID"),
  }),
  getDatabase: () => adapter,
});
const records = rows.map((r) => ({
  key: r.key,
  value: r.value,
  isDeleted: !!r.is_deleted,
  schemaVersion: r.schema_version,
  hlc: { wallTimeMs: r.hlc_wall_time_ms, counter: r.hlc_counter },
  deviceId: r.device_id,
  serverSeq: r.server_seq,
}));
const pages: string[] = [];
const cursors = new Map<number, number>();
for (let i = 0; i < records.length; i += 500) {
  cursors.set(i === 0 ? 0 : records[i - 1].serverSeq, pages.length);
  const batch = records.slice(i, i + 500);
  pages.push(
    JSON.stringify({
      records: batch,
      cursor: batch.at(-1)!.serverSeq,
      head: records.at(-1)!.serverSeq,
      hasMore: i + 500 < records.length,
    }),
  );
}
const zippedPages = pages.map((p) => gzipSync(p));
const groups = new Map<
  number,
  { zipped: Buffer[]; cursors: Map<number, number> }
>();
for (const size of [500, 5000, 20000]) {
  const zipped: Buffer[] = [],
    starts = new Map<number, number>();
  for (let i = 0; i < pages.length; i += size / 500) {
    starts.set(i === 0 ? 0 : JSON.parse(pages[i - 1]).cursor, zipped.length);
    zipped.push(gzipSync("[" + pages.slice(i, i + size / 500).join(",") + "]"));
  }
  groups.set(size, { zipped, cursors: starts });
}
const zippedStream = gzipSync(pages.join("\n") + "\n");
const build = await Bun.build({
  entrypoints: ["scripts/sync-benchmark/browser.ts"],
  target: "browser",
});
if (!build.success) throw new Error(build.logs.join("\n"));
const bundle = await build.outputs[0].text();
const html = `<!doctype html>${cleanupOnly ? "<style>#run,#smoke,#batches,#package{display:none}</style>" : ""}<meta charset="utf-8"><title>Sync restore benchmark</title><h1>Sync restore benchmark</h1><p>Private snapshot, loopback only, disposable IndexedDB. No production writes.</p><button id="run">Run comparison</button><button id="batches">Run batch-size comparison</button><button id="smoke">Run streaming smoke check</button><button id="package">Check installed package</button><button id="cleanup">Clean interrupted benchmark databases</button><pre id="status">Ready</pre><pre id="results"></pre><script type="module" src="/bundle.js"></script>`;
Bun.serve({
  hostname: "127.0.0.1",
  port: 5277,
  idleTimeout: 120,
  async fetch(req) {
    const url = new URL(req.url);
    if (req.headers.get("host") !== "127.0.0.1:5277")
      return new Response("Invalid host", { status: 403 });
    const origin = req.headers.get("origin");
    if (origin && origin !== url.origin)
      return new Response("Invalid origin", { status: 403 });
    if (url.pathname === "/")
      return new Response(html, { headers: { "content-type": "text/html" } });
    if (url.pathname === "/bundle.js")
      return new Response(bundle, {
        headers: { "content-type": "text/javascript" },
      });
    if (
      ["/result", "/smoke-result", "/batch-result", "/package-result"].includes(
        url.pathname,
      ) &&
      req.method === "POST"
    ) {
      const value = await req.json();
      await Bun.write(
        url.pathname === "/result"
          ? "cutover.local/sync-benchmark-results.json"
          : url.pathname === "/batch-result"
            ? "cutover.local/sync-benchmark-batches.json"
            : url.pathname === "/package-result"
              ? "cutover.local/sync-package-check.json"
              : "cutover.local/sync-benchmark-smoke.json",
        JSON.stringify(value, null, 2),
      );
      console.log(JSON.stringify(value));
      return new Response("saved");
    }
    if (cleanupOnly)
      return new Response("Cleanup-only server", { status: 409 });
    if (
      req.method === "GET" &&
      ["/api/sync/v2/pull", "/api/sync/v2/pull-stream"].includes(url.pathname)
    ) {
      const target = new URL(req.url);
      target.pathname = target.pathname.replace("/api/sync/v2", "");
      return actualRoutes.fetch(new Request(target, req));
    }
    if (url.pathname === "/meta")
      return Response.json({
        records: records.length,
        head: records.at(-1)!.serverSeq,
        pages: pages.length,
        gzipPagesBytes: zippedPages.reduce((n, p) => n + p.length, 0),
        gzipStreamBytes: zippedStream.length,
      });
    if (!["/pull", "/stream", "/group"].includes(url.pathname))
      return new Response("Not found", { status: 404 });
    const delay = Number(url.searchParams.get("delay") || 0);
    if (![0, 100].includes(delay))
      return new Response("Invalid delay", { status: 400 });
    if (delay) await Bun.sleep(delay);
    const headers = {
      "content-type":
        url.pathname === "/pull" ? "application/json" : "application/x-ndjson",
      "content-encoding": "gzip",
      "cache-control": "no-store",
    };
    if (url.pathname === "/group") {
      const group = groups.get(Number(url.searchParams.get("size")));
      const index = group?.cursors.get(Number(url.searchParams.get("cursor")));
      if (!group || index === undefined)
        return new Response("Invalid group", { status: 400 });
      return new Response(group.zipped[index], {
        headers: { ...headers, "content-type": "application/json" },
      });
    }
    if (url.pathname === "/pull") {
      const index = cursors.get(Number(url.searchParams.get("cursor")));
      if (index === undefined)
        return new Response("Invalid cursor", { status: 400 });
      return new Response(zippedPages[index], { headers });
    }
    let offset = 0;
    return new Response(
      new ReadableStream({
        pull(controller) {
          if (offset === zippedStream.length) {
            controller.close();
            return;
          }
          const end = Math.min(offset + 16384, zippedStream.length);
          controller.enqueue(zippedStream.subarray(offset, end));
          offset = end;
        },
      }),
      { headers },
    );
  },
});
console.log(`Ready at http://127.0.0.1:5277 (${records.length} records)`);
