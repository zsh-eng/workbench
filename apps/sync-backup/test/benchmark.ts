/** Native SQLite write-only benchmark. Source is an already-pulled mirror, opened read-only. */
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir, loadavg } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store";
import type { SyncRecord } from "@zsh-eng/local-sync";
const source = Bun.argv[2];
if (!source)
  throw Error("Usage: bun test/benchmark.ts /private/path/mirror.sqlite");
const db = new Database(source, { readonly: true });
const rows = db
  .query<any, []>("SELECT * FROM records ORDER BY namespace,key")
  .all();
db.close();
const datasets = new Map<string, SyncRecord[]>();
for (const r of rows) {
  const records = datasets.get(r.namespace) ?? [];
  records.push({
    key: r.key,
    value: r.value,
    schemaVersion: r.schema_version,
    hlc: { wallTimeMs: r.wall_time, counter: r.counter },
    deviceId: r.device_id,
    serverSeq: r.server_seq,
    isDeleted: !!r.is_deleted,
  });
  datasets.set(r.namespace, records);
}
const fingerprint = (rows: any[]) =>
  new Bun.CryptoHasher("sha256").update(JSON.stringify(rows)).digest("hex");
const expected = fingerprint(rows),
  samples = [];
for (let round = 0; round < 3; round++)
  for (const size of [500, 5000, 20000]
    .slice(round)
    .concat([500, 5000, 20000].slice(0, round))) {
    const dir = mkdtempSync(join(tmpdir(), "wb-bench-")),
      store = new Store(dir),
      load = loadavg();
    const start = performance.now();
    for (const [namespace, records] of datasets) {
      const state = store.state(namespace, "*");
      for (let i = 0; i < records.length; i += size) {
        const batch = records.slice(i, i + size);
        store.apply(
          namespace,
          batch,
          state,
          Math.max(...batch.map((r) => r.serverSeq)),
        );
      }
    }
    const writeMs = performance.now() - start,
      checkpointStart = performance.now();
    store.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    const checkpointMs = performance.now() - checkpointStart;
    const actual = store.db
      .query("SELECT * FROM records ORDER BY namespace,key")
      .all();
    if (fingerprint(actual) !== expected)
      throw Error("Content differs after benchmark");
    if (
      (store.db.query("PRAGMA integrity_check").get() as any)
        .integrity_check !== "ok"
    )
      throw Error("Integrity failed");
    samples.push({
      round,
      batchSize: size,
      records: rows.length,
      writeMs,
      checkpointMs,
      load,
      verified: true,
    });
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
console.log(
  JSON.stringify(
    {
      bun: Bun.version,
      scope:
        "SQLite only: prepared UPSERT, FULL durability, indexes, transaction cursor updates; source decode and network excluded",
      samples,
    },
    null,
    2,
  ),
);
