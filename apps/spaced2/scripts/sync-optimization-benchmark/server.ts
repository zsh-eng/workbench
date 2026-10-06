import { Database, type SQLQueryBindings } from "bun:sqlite";
import {
  createSyncHonoRoutes,
  type SyncD1Database,
} from "@zsh-eng/local-sync/hono";
import { gzipSync } from "node:zlib";
import { loadavg } from "node:os";
import { resolve } from "node:path";
const port = Number(process.env.SYNC_BENCH_PORT || 5291);
const cleanup = process.argv.includes("--cleanup-only");
const db = cleanup
  ? null
  : new Database("cutover.local/converted/backend.sqlite", { readonly: true });
interface SnapshotRow {
  key: string;
  value: string;
  is_deleted: number;
  schema_version: number;
  hlc_wall_time_ms: number;
  hlc_counter: number;
  device_id: string;
  server_seq: number;
}
const owner = cleanup
  ? null
  : (
      db!
        .query(
          "SELECT user_id,COUNT(*) n FROM sync_records GROUP BY user_id ORDER BY n DESC LIMIT 1",
        )
        .get() as { user_id: string }
    ).user_id;
const rows = cleanup
  ? []
  : (db!
      .query("SELECT * FROM sync_records WHERE user_id=? ORDER BY server_seq")
      .all(owner) as SnapshotRow[]);
const records = rows.map((r) => ({
  key: r.key,
  value: r.value,
  isDeleted: !!r.is_deleted,
  schemaVersion: r.schema_version,
  hlc: { wallTimeMs: r.hlc_wall_time_ms, counter: r.hlc_counter },
  deviceId: r.device_id,
  serverSeq: r.server_seq,
}));
const verify = gzipSync(JSON.stringify(records));
const adapter: SyncD1Database = {
  prepare(sql) {
    let values: SQLQueryBindings[] = [];
    return {
      bind(...v: unknown[]) {
        values = v as SQLQueryBindings[];
        return this;
      },
      async first<T>() {
        return db!.query(sql).get(...values) as T | null;
      },
      async all<T>() {
        return { results: db!.query(sql).all(...values) as T[] };
      },
    };
  },
  async batch() {
    throw Error("Read-only snapshot");
  },
};
const routes = createSyncHonoRoutes({
  requireAuth: async (_c, next) => next(),
  getIdentity: (c) => ({
    userId: owner!, // Cleanup-only requests return before reaching the routes.
    deviceId: c.req.header("X-Device-ID"),
  }),
  getDatabase: () => adapter,
});
const zodPath = resolve(
  "legacy-sync-benchmark.local/benchmark/zod/node_modules/zod/index.js",
);
const build = await Bun.build({
  entrypoints: ["scripts/sync-optimization-benchmark/browser.ts"],
  target: "browser",
  plugins: [
    {
      name: "compiled-zod4-domain-decoder",
      setup(b) {
        b.onLoad({ filter: /local-sync\/dist\/.*\.js$/ }, async ({ path }) => {
          let contents = await Bun.file(path).text();
          if (!contents.includes("yield syncPullResponseSchema.parse(value);"))
            return;
          if (!contents.includes("const value = JSON.parse(pending);"))
            throw Error("Stream parser changed");
          contents =
            `import { tagFrame } from ${JSON.stringify(resolve("scripts/sync-optimization-benchmark/candidates.ts"))};\n` +
            contents
              .replace(
                "const value = JSON.parse(pending);",
                "const frameBytes = bytes; const value = JSON.parse(pending);",
              )
              .replace(
                "yield syncPullResponseSchema.parse(value);",
                "yield tagFrame(syncPullResponseSchema.parse(value), frameBytes);",
              );
          return { contents, loader: "js" };
        });
        b.onLoad(
          { filter: /\/src\/lib\/sync\/(records|schema)\.ts$/ },
          async ({ path }) => {
            let contents = await Bun.file(path).text();
            if (path.endsWith("/records.ts")) {
              if (
                !contents.includes(
                  "toStoredOperation(operationSchema.parse(raw))",
                )
              )
                throw Error("Decoder changed");
              contents = contents.replace(
                "toStoredOperation(operationSchema.parse(raw))",
                "toStoredOperation(raw)",
              );
            } else {
              if (
                !contents.includes("export const operationSchema = z.union([")
              )
                throw Error("Schema changed");
              contents = contents
                .replace(
                  'import { z } from "zod";',
                  `import { z } from ${JSON.stringify(zodPath)};`,
                )
                .replace(
                  "export const operationSchema = z.union([",
                  'const baseOperationSchema = z.discriminatedUnion("type", [',
                );
              contents +=
                "\nexport const operationSchema=z.compile(baseOperationSchema,{strict:true});\n";
            }
            return { contents, loader: "ts" };
          },
        );
      },
    },
  ],
});
if (!build.success) throw Error(JSON.stringify(build.logs));
const bundle = await build.outputs[0].text();
Bun.serve({
  hostname: "127.0.0.1",
  port,
  idleTimeout: 120,
  async fetch(req) {
    const u = new URL(req.url);
    if (
      u.host !== `127.0.0.1:${port}` ||
      (req.headers.get("origin") && req.headers.get("origin") !== u.origin)
    )
      return new Response("Forbidden", { status: 403 });
    if (u.pathname === "/")
      return new Response(
        `${cleanup ? "<style>#run{display:none}</style>" : ""}<button id="run">Run optimization matrix</button><button id="stop">Stop after current run</button><button id="abort">Abort active run</button><button id="cleanup">Cleanup</button><pre id="status">Ready</pre><pre id="output"></pre><script type="module" src="/app.js"></script>`,
        { headers: { "content-type": "text/html" } },
      );
    if (u.pathname === "/app.js")
      return new Response(bundle, {
        headers: { "content-type": "text/javascript" },
      });
    if (u.pathname === "/host")
      return Response.json({ load: loadavg(), at: new Date().toISOString() });
    if (
      (u.pathname === "/results" ||
        u.pathname === "/trace-results" ||
        u.pathname === "/candidate-results" ||
        u.pathname === "/combination-results") &&
      req.method === "POST"
    ) {
      const value = await req.json();
      await Bun.write(
        u.pathname === "/combination-results"
          ? "cutover.local/optimizations/combination-results.json"
          : u.pathname === "/candidate-results"
            ? "cutover.local/optimizations/candidate-results.json"
            : u.pathname === "/trace-results"
              ? "cutover.local/optimizations/trace-results.json"
              : "cutover.local/optimizations/results.json",
        JSON.stringify(value, null, 2),
      );
      return new Response("saved");
    }
    if (cleanup) return new Response("Cleanup only", { status: 409 });
    if (u.pathname === "/meta")
      return Response.json({
        records: records.length,
        head: records.at(-1)!.serverSeq,
        zod: "4.6.5",
        decoder: "single discriminated compiled",
        loadStart: loadavg(),
      });
    if (u.pathname === "/verify")
      return new Response(verify, {
        headers: {
          "content-type": "application/json",
          "content-encoding": "gzip",
          "cache-control": "no-store",
        },
      });
    if (
      u.pathname === "/api/sync/v2/pull-stream" ||
      u.pathname === "/api/sync/v2/pull"
    ) {
      const target = new URL(req.url);
      target.pathname = target.pathname.replace("/api/sync/v2", "");
      return routes.fetch(new Request(target, req));
    }
    return new Response("Not found", { status: 404 });
  },
});
console.log(`http://127.0.0.1:${port}`);
