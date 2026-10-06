/** Loopback-only benchmark, read-only source, aggregate results only. */
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { loadavg } from "node:os";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import type { StoredOperation } from "../../src/lib/sync/records";
import type { RawRecord, BrowserSample } from "./types";
import { syncTables } from "../../src/lib/sync/records";
const port = Number(process.env.OPFS_REPEAT_PORT ?? 5403),
  origin = `http://127.0.0.1:${port}`;
const source = new Database("cutover.local/converted/backend.sqlite", {
  readonly: true,
});
const owner = (
  source
    .query(
      "SELECT user_id,count(*) n FROM sync_records GROUP BY user_id ORDER BY n DESC LIMIT 1",
    )
    .get() as { user_id: string }
).user_id;
const records = source
  .query(
    "SELECT key,value FROM sync_records WHERE user_id=? ORDER BY server_seq",
  )
  .all(owner) as RawRecord[];
source.close();
const decoded = records.map((r) => {
  const [table] = JSON.parse(r.key);
  return { table, row: syncTables[table].decode!(r.value) as StoredOperation };
});
const expected = Object.fromEntries(
  ["all", "main"].map((scope) => {
    const rows = decoded
      .filter((r) => scope === "all" || r.table === "operations")
      .sort((a, b) => {
        const x = a.table + "\0" + a.row.id,
          y = b.table + "\0" + b.row.id;
        return x < y ? -1 : x > y ? 1 : 0;
      });
    return [
      scope,
      {
        count: rows.length,
        hash: createHash("sha256")
          .update(
            rows
              .map((r) => r.table + "\t" + JSON.stringify(r.row) + "\n")
              .join(""),
          )
          .digest("hex"),
      },
    ];
  }),
);
const build = await Bun.build({
  entrypoints: ["scripts/storage-benchmark/opfs-repeat-worker.ts"],
  target: "browser",
  external: ["/sqlite/index.mjs"],
});
if (!build.success) throw Error(String(build.logs));
const dir = resolve("cutover.local/storage-benchmark");
await mkdir(dir, { recursive: true });
const resultPath = resolve(
  dir,
  `opfs-repeat-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
);
const samples: BrowserSample[] = [];
let claimed = false;
const metadata = {
  createdAt: new Date().toISOString(),
  records: records.length,
  mainRecords: expected.main.count,
  sqlitePackage: "3.53.4-build1",
  batch: 5000,
  pointWrites:
    "100 each: insert, update, insert+outbox, update+outbox; loaded full database",
  rounds: Number(process.env.OPFS_REPEAT_ROUNDS ?? 5),
  series: process.env.OPFS_REPEAT_SERIES ?? "primary",
  fixture: "2026-09-19 converted snapshot, largest account",
  verification:
    "New worker after writer termination; all rows SHA-256; SQLite quick_check; temporary stores removed",
};
const page = `<!doctype html><title>Spaced repeat benchmark</title><h1>Spaced storage repeat</h1><p>Automated serial runner. See console for progress.</p>`;
Bun.serve({
  hostname: "127.0.0.1",
  port,
  idleTimeout: 255,
  async fetch(req) {
    const u = new URL(req.url);
    if (
      u.origin !== origin ||
      (req.headers.get("origin") && req.headers.get("origin") !== origin)
    )
      return new Response("Forbidden", { status: 403 });
    if (u.pathname === "/")
      return new Response(page, {
        headers: {
          "content-type": "text/html",
          "Cache-Control": "no-store",
          "Cross-Origin-Opener-Policy": "same-origin",
          "Cross-Origin-Embedder-Policy": "require-corp",
        },
      });
    if (u.pathname === "/worker.js")
      return new Response(build.outputs[0], {
        headers: {
          "content-type": "text/javascript",
          "Cross-Origin-Embedder-Policy": "require-corp",
        },
      });
    if (u.pathname.startsWith("/sqlite/")) {
      const name = u.pathname.slice(8);
      if (
        !["index.mjs", "sqlite3.wasm", "sqlite3-opfs-async-proxy.js"].includes(
          name,
        )
      )
        return new Response("Forbidden", { status: 403 });
      return new Response(
        Bun.file(resolve("node_modules/@sqlite.org/sqlite-wasm/dist", name)),
        {
          headers: {
            "content-type": name.endsWith(".wasm")
              ? "application/wasm"
              : "text/javascript",
          },
        },
      );
    }
    if (u.pathname === "/fixture") return Response.json({ records, expected });
    if (u.pathname === "/results") return Response.json({ metadata, samples });
    if (u.pathname === "/load") return Response.json({ load: loadavg() });
    if (u.pathname === "/claim" && req.method === "POST") {
      if (claimed) return new Response("Already running", { status: 409 });
      claimed = true;
      return new Response("OK");
    }
    if (u.pathname === "/sample" && req.method === "POST") {
      const sample = (await req.json()) as BrowserSample;
      if (!sample.verified || !sample.cleaned)
        return new Response("Not verified", { status: 400 });
      sample.hostLoad = loadavg();
      samples.push(sample);
      await Bun.write(
        resultPath,
        JSON.stringify({ metadata, samples }, null, 2),
      );
      console.log(
        samples.length +
          "/40 " +
          sample.engine +
          " " +
          sample.scope +
          " " +
          (sample.writeMs / 1000).toFixed(3) +
          "s persisted, verified, cleaned",
      );
      return new Response("OK");
    }
    if (u.pathname === "/progress" && req.method === "POST") {
      console.log("PROGRESS " + (await req.text()));
      return new Response("OK");
    }
    if (u.pathname === "/complete" && req.method === "POST") {
      console.log("COMPLETE " + resultPath);
      return new Response("OK");
    }
    if (u.pathname === "/error" && req.method === "POST") {
      console.error("BROWSER ERROR " + (await req.text()));
      return new Response("OK");
    }
    return new Response("Not found", { status: 404 });
  },
});
console.log("Ready " + origin + " PID " + process.pid);
