/** Local-only storage benchmark. Never opens production or writes its source. */
import { Database } from "bun:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { loadavg, cpus } from "node:os";
import { mkdir, rm, stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { StoredOperation } from "../../src/lib/sync/records";
import type { SqlRow } from "./types";
import { syncTables } from "../../src/lib/sync/records";

const dir = resolve("cutover.local/storage-benchmark");
await mkdir(dir, { recursive: true });
const source = new Database("cutover.local/converted/backend.sqlite", {
  readonly: true,
});
const owner = (
  source
    .query(
      "SELECT user_id, count(*) n FROM sync_records GROUP BY user_id ORDER BY n DESC LIMIT 1",
    )
    .get() as { user_id: string }
).user_id;
const raw = source
  .query(
    "SELECT key,value FROM sync_records WHERE user_id=? ORDER BY server_seq",
  )
  .all(owner) as { key: string; value: string }[];
source.close();
const prepStart = performance.now();
const records = raw.map((r) => {
  const [table] = JSON.parse(r.key);
  if (!["operations", "reviewLogOperations"].includes(table))
    throw Error("Unexpected table");
  const row = syncTables[table].decode!(r.value) as StoredOperation;
  return { table, row, json: JSON.stringify(row) };
});
const prepareMs = performance.now() - prepStart;
function selected(scope: string) {
  return scope === "main"
    ? records.filter((r) => r.table === "operations")
    : records;
}
// Compare every field in a stable order; no row content is written to the results.
function fingerprint(
  rows: { table: string; json: string; row: { id: string } }[],
) {
  const ordered = [...rows].sort((a, b) => {
    const x = a.table + "\0" + a.row.id,
      y = b.table + "\0" + b.row.id;
    return x < y ? -1 : x > y ? 1 : 0;
  });
  return createHash("sha256")
    .update(ordered.map((r) => r.table + "\t" + r.json + "\n").join(""))
    .digest("hex");
}
const expected = Object.fromEntries(
  ["all", "main"].map((scope) => [
    scope,
    { count: selected(scope).length, hash: fingerprint(selected(scope)) },
  ]),
);
const samples: (Awaited<ReturnType<typeof sqlite>> & { round: number })[] = [];
const resultPath = resolve(
  dir,
  `results-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
);
const cases = [
  { scope: "all", batch: 500 },
  { scope: "all", batch: 5000 },
  { scope: "all", batch: 20000 },
  { scope: "all", batch: records.length },
  { scope: "main", batch: 5000 },
];
const metadata = {
  createdAt: new Date().toISOString(),
  source: "2026-09-19 converted snapshot, largest account",
  prepareMs,
  records: records.length,
  mainRecords: selected("main").length,
  jsonBytes: records.reduce((n, r) => n + Buffer.byteLength(r.json), 0),
  mainJsonBytes: selected("main").reduce(
    (n, r) => n + Buffer.byteLength(r.json),
    0,
  ),
  bun: Bun.version,
  sqliteVersion: (() => {
    const db = new Database(":memory:");
    try {
      return (db.query("select sqlite_version() v").get() as { v: string }).v;
    } finally {
      db.close();
    }
  })(),
  cpus: cpus().length,
  durability: "SQLite WAL + synchronous FULL, default wal_autocheckpoint",
  indexes: ["primary id", "type", "timestamp"],
  cases,
};
let running = false;
async function sqlite(scope: string, batch: number) {
  if (running) throw Error("Another SQLite run is active");
  running = true;
  const rows = selected(scope),
    path = resolve(dir, `run-${randomUUID()}.sqlite`);
  const db = new Database(path);
  try {
    db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
    for (const table of ["operations", "reviewLogOperations"])
      db.exec(
        `CREATE TABLE ${table}(id TEXT PRIMARY KEY NOT NULL,type TEXT NOT NULL,timestamp REAL NOT NULL,value TEXT NOT NULL); CREATE INDEX ${table}_type ON ${table}(type); CREATE INDEX ${table}_timestamp ON ${table}(timestamp);`,
      );
    const statements = Object.fromEntries(
      ["operations", "reviewLogOperations"].map((t) => [
        t,
        db.prepare(
          `INSERT INTO ${t}(id,type,timestamp,value) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET type=excluded.type,timestamp=excluded.timestamp,value=excluded.value`,
        ),
      ]),
    );
    const write = db.transaction((chunk: typeof rows) => {
      for (const r of chunk)
        statements[r.table].run(r.row.id, r.row.type, r.row.timestamp, r.json);
    });
    const loadStart = loadavg();
    const start = performance.now();
    let transactions = 0;
    for (let i = 0; i < rows.length; i += batch) {
      write(rows.slice(i, i + batch));
      transactions++;
    }
    const writeMs = performance.now() - start;
    const checkpointStart = performance.now();
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    const checkpointMs = performance.now() - checkpointStart;
    const readStart = performance.now();
    const saved = ["operations", "reviewLogOperations"].flatMap((table) =>
      (
        db.query(`SELECT id,type,timestamp,value FROM ${table}`).all() as SqlRow[]
      ).map((r) => {
        const row = JSON.parse(r.value);
        if (
          row.id !== r.id ||
          row.type !== r.type ||
          row.timestamp !== r.timestamp
        )
          throw Error("Indexed columns mismatch");
        return { table, row, json: r.value };
      }),
    );
    const readParseMs = performance.now() - readStart;
    if (
      saved.length !== expected[scope].count ||
      fingerprint(saved) !== expected[scope].hash
    )
      throw Error("SQLite content mismatch");
    if ((db.query("PRAGMA quick_check").get() as { quick_check: string }).quick_check !== "ok")
      throw Error("SQLite integrity failed");
    return {
      engine: "sqlite",
      scope,
      batch,
      writeMs,
      checkpointMs,
      readParseMs,
      transactions,
      records: rows.length,
      bytes: (await stat(path)).size,
      verified: true,
      loadStart,
      loadEnd: loadavg(),
    };
  } finally {
    db.close();
    for (const suffix of ["", "-wal", "-shm"])
      await rm(path + suffix, { force: true });
    running = false;
  }
}
// Native SQLite only. Rotate case order to reduce systematic ordering effects.
for (let round = 0; round < 3; round++) {
  const order = [...cases.slice(round), ...cases.slice(0, round)];
  for (const c of order) {
    if (loadavg()[0] > 20)
      throw Error("Host load too high; completed results retained");
    const sample = { ...(await sqlite(c.scope, c.batch)), round: round + 1 };
    samples.push(sample);
    await Bun.write(resultPath, JSON.stringify({ metadata, samples }, null, 2));
    console.log(
      `${samples.length}/15 ${sample.scope} batch=${sample.batch}: ${(sample.writeMs / 1000).toFixed(3)}s writes, ${(sample.checkpointMs / 1000).toFixed(3)}s checkpoint; verified`,
    );
  }
}
console.log(`Results saved to ${resultPath}`);
