import Dexie from "dexie";
import type { StoredOperation } from "../../src/lib/sync/records";
import type { SavedRecord, SqlDatabase, SqlPool, SqlValue, Fixture } from "./types";
import { syncTables } from "../../src/lib/sync/records";
const tables = ["operations", "reviewLogOperations"];
function request<T>(req: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function complete(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? Error("Aborted"));
  });
}
async function openIdb(name: string) {
  const r = indexedDB.open(name, 1);
  r.onupgradeneeded = () => {
    for (const t of tables) {
      const s = r.result.createObjectStore(t, { keyPath: "id" });
      s.createIndex("type", "type");
      s.createIndex("timestamp", "timestamp");
    }
  };
  return request(r);
}
async function fingerprint(rows: SavedRecord[]) {
  rows.sort((a, b) => {
    const x = a.table + "\0" + a.row.id,
      y = b.table + "\0" + b.row.id;
    return x < y ? -1 : x > y ? 1 : 0;
  });
  const text = rows
    .map((r) => r.table + "\t" + JSON.stringify(r.row) + "\n")
    .join("");
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
    (x) => x.toString(16).padStart(2, "0"),
  ).join("");
}
self.onmessage = async ({ data: c }) => {
  if (c.mode === "cleanup") {
    for (const entry of await indexedDB.databases()) {
      if (entry.name?.startsWith("SpacedOPFSBench-"))
        await request(indexedDB.deleteDatabase(entry.name));
    }
    postMessage({ ok: true });
    return;
  }
  let db: SqlDatabase | Dexie | IDBDatabase | undefined, pool: SqlPool | undefined;
  try {
    const fixture = await (await fetch("/fixture")).json() as Fixture;
    const startPrepare = performance.now();
    const rows = fixture.records
      .filter(
        (r) => c.scope === "all" || JSON.parse(r.key)[0] === "operations",
      )
      .map((r) => {
        const [table] = JSON.parse(r.key);
        const row = syncTables[table].decode!(r.value) as StoredOperation;
        return { table, row, json: JSON.stringify(row) };
      });
    const prepareMs = performance.now() - startPrepare;
    const setupStart = performance.now();
    let sqliteVersion: string | undefined, journalMode: SqlValue | undefined, synchronous: SqlValue | undefined;
    if (c.engine === "opfs") {
      // Served from the pinned official package; only this path needs WASM.
      const { default: init } = await import(
        /* @vite-ignore */ "/sqlite/index.mjs"
      );
      const sqlite = await init({
        locateFile: (path: string) => "/sqlite/" + path,
        print: () => {},
        printErr: () => {},
      });
      sqliteVersion = sqlite.version.libVersion;
      pool = await sqlite.installOpfsSAHPoolVfs({
        name: c.name,
        directory: "/" + c.name,
        initialCapacity: 6,
      });
      db = new pool!.OpfsSAHPoolDb("/data.sqlite");
      (db as SqlDatabase).exec("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;");
      journalMode = (db as SqlDatabase).selectValue("PRAGMA journal_mode");
      synchronous = (db as SqlDatabase).selectValue("PRAGMA synchronous");
      if (c.mode === "write")
        for (const t of tables)
          (db as SqlDatabase).exec(
            `CREATE TABLE ${t}(id TEXT PRIMARY KEY NOT NULL,type TEXT NOT NULL,timestamp REAL NOT NULL,value TEXT NOT NULL);CREATE INDEX ${t}_type ON ${t}(type);CREATE INDEX ${t}_timestamp ON ${t}(timestamp);`,
          );
    } else if (c.engine === "dexie") {
      db = new Dexie(c.name);
      db.version(1).stores({
        operations: "id,type,timestamp",
        reviewLogOperations: "id,type,timestamp",
      });
      await db.open();
    } else db = await openIdb(c.name);
    const setupMs = performance.now() - setupStart;
    if (c.mode === "write") {
      const statements =
        c.engine === "opfs"
          ? Object.fromEntries(
              tables.map((t) => [
                t,
                (db as SqlDatabase).prepare(
                  `INSERT INTO ${t}(id,type,timestamp,value) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET type=excluded.type,timestamp=excluded.timestamp,value=excluded.value`,
                ),
              ]),
            )
          : null;
      // Prepare identical batch groups outside the write timing for both IDB paths.
      const batches = [];
      for (let i = 0; i < rows.length; i += c.batch) {
        const chunk = rows.slice(i, i + c.batch);
        batches.push(
          tables
            .map((table) => ({
              table,
              rows: chunk.filter((r) => r.table === table),
            }))
            .filter((x) => x.rows.length),
        );
      }
      const start = performance.now();
      try {
        for (const groups of batches) {
          if (c.engine === "opfs") {
            (db as SqlDatabase).exec("BEGIN");
            try {
              for (const g of groups)
                for (const r of g.rows) {
                  const s = statements![g.table];
                  s.bind([r.row.id, r.row.type, r.row.timestamp, r.json]);
                  s.step();
                  s.reset();
                }
              (db as SqlDatabase).exec("COMMIT");
            } catch (e) {
              (db as SqlDatabase).exec("ROLLBACK");
              throw e;
            }
          } else if (c.engine === "dexie")
            await (db as Dexie).transaction("rw", (db as Dexie).tables, async () => {
              for (const g of groups)
                await (db as Dexie).table<StoredOperation>(g.table).bulkPut(g.rows.map((r) => r.row));
            });
          else {
            const tx = (db as IDBDatabase).transaction(tables, "readwrite"),
              done = complete(tx);
            for (const g of groups)
              for (const r of g.rows) tx.objectStore(g.table).put(r.row);
            await done;
          }
        }
      } finally {
        if (statements)
          for (const s of Object.values(statements) ) s.finalize();
      }
      const writeMs = performance.now() - start;
      const closeStart = performance.now();
      db.close();
      db = undefined;
      postMessage({
        ok: true,
        engine: c.engine,
        scope: c.scope,
        batch: c.batch,
        name: c.name,
        records: rows.length,
        transactions: batches.length,
        writeMs,
        closeMs: performance.now() - closeStart,
        prepareMs,
        setupMs,
        sqliteVersion,
        journalMode,
        synchronous,
        durability:
          c.engine === "opfs" ? "FULL / DELETE journal" : "browser default",
        userAgent: navigator.userAgent,
      });
    } else {
      const start = performance.now();
      let saved: SavedRecord[] = [];
      if (c.engine === "opfs")
        for (const table of tables) {
          const list = (db as SqlDatabase).exec(`SELECT id,type,timestamp,value FROM ${table}`, {
            rowMode: "object",
            returnValue: "resultRows",
          });
          for (const r of list) {
            const row = JSON.parse(r.value);
            if (
              row.id !== r.id ||
              row.type !== r.type ||
              row.timestamp !== r.timestamp
            )
              throw Error("Indexed columns mismatch");
            saved.push({ table, row });
          }
        }
      else if (c.engine === "dexie")
        for (const table of tables)
          saved = saved.concat(
            (await (db as Dexie).table<StoredOperation>(table).toArray()).map((row: StoredOperation) => ({
              table,
              row,
            })),
          );
      else {
        const tx = (db as IDBDatabase).transaction(tables, "readonly"),
          done = complete(tx);
        const lists = await Promise.all(
          tables.map(async (table) =>
            (await request(tx.objectStore(table).getAll())).map((row: StoredOperation) => ({
              table,
              row,
            })),
          ),
        );
        await done;
        saved = lists.flat();
      }
      const readMs = performance.now() - start;
      if (
        saved.length !== fixture.expected[c.scope].count ||
        (await fingerprint(saved)) !== fixture.expected[c.scope].hash
      )
        throw Error("Persistence content mismatch");
      if (c.engine === "opfs" && (db as SqlDatabase).selectValue("PRAGMA quick_check") !== "ok")
        throw Error("SQLite integrity failure");
      if (c.engine !== "opfs")
        for (const r of saved)
          if (r.row.type === "card" && !(r.row.payload.due instanceof Date))
            throw Error("Lost date type");
      db.close();
      db = undefined;
      if (c.engine === "opfs") {
        if (!(await pool!.removeVfs())) throw Error("OPFS cleanup failed");
        pool = undefined;
      } else await request(indexedDB.deleteDatabase(c.name));
      postMessage({ ok: true, verified: true, readMs, cleaned: true });
    }
  } catch (e) {
    try {
      db?.close();
    } catch {
      // Keep the original failure if closing the failed database also fails.
    }
    postMessage({ ok: false, error: String(e), stack: (e as Error).stack });
  }
};
