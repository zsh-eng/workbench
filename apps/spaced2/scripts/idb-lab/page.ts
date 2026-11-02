/**
 * The page side of the IndexedDB lab (run.ts): writes synthetic Spaced rows
 * the way local-sync's Dexie storage does, with one thing changed at a time.
 * It runs in the page, or in a worker with `where: "worker"`.
 */
import Dexie from "dexie";

export interface Row {
  table: "operations" | "reviewLogOperations";
  row: { id: string; type: string; timestamp: number } & Record<
    string,
    unknown
  >;
}

export interface BenchConfig {
  /** Dexie as local-sync calls it, or plain IndexedDB requests. */
  api: "dexie" | "raw";
  /** Secondary indexes on both record stores: `type` and `timestamp`. */
  indexes: 0 | 1 | 2;
  /** Records per transaction (500 is a sync page). */
  batch: number;
  /** Rows per `bulkPut` call in a transaction; all of them by default. */
  chunk?: number;
  durability: "default" | "relaxed" | "strict";
  /** The outbox lookup of each page. */
  outbox: boolean;
  /** Only the first `limit` rows, repeated with new ids to reach it if larger. */
  limit?: number;
  /** Characters added to each row, on top of its real fields. */
  pad?: number;
  /** ms between transactions, for the network and the decoder. */
  pacing?: number;
  /** After this many rows: a small write to one store, or only a wait. */
  gapAt?: number;
  gap?: "put" | "wait" | "wait+put" | "none";
  gapWait?: number;
  /** `metadataKv` sorts above the record stores, `aLow` below them. */
  gapStore?: "metadataKv" | "aLow";
  /** Again after each `gapEvery` rows. */
  gapEvery?: number;
  /** A priority restore's order: `operations`, then the review history. */
  priorityOrder?: boolean;
  /** Delete the store first; for a browser whose profile stays. */
  reset?: boolean;
  /** The three `metadataKv` rows the app writes before its first pull. */
  appMetadata?: boolean;
  /** Rows as they are, one JSON string per row, or one value per page. */
  form?: "object" | "json" | "page";
  /** Run the secondary-index creation only after every row is stored. */
  lateIndexes?: boolean;
  /** After the run, time the schema upgrade that removes the indexes. */
  dropIndexes?: boolean;
  where?: "page" | "worker";
  /** `raw` runs: time each put by its success event, by the row's JSON size. */
  perPut?: boolean;
}

export interface Tx {
  /** Start, after the lookup, after the puts, committed: ms from the run's start. */
  t: [number, number, number, number];
  n: number;
}

export interface BenchResult {
  ms: number;
  txs: Tx[];
  puts: number;
  gapMs?: number;
  indexMs?: number;
  /** Synchronous time spent on calls into put, in `raw` runs. */
  putCallMs?: number;
  /** Gaps between put successes over 1 ms, in `raw` runs. */
  slowPutGaps?: number;
  /** JSON size bucket (50 B): rows, slow rows, ms in slow rows. */
  bySize?: Record<string, [number, number, number]>;
  /** Index of each slow row, from `perPut`, with its gap in ms. */
  slowRows?: [number, number][];
  storeCounts: Record<string, number>;
  estimate?: StorageEstimate;
}

const DB = "IdbLab";

function schema(indexes: number, lowStore = false) {
  const keys = ["id", "type", "timestamp"].slice(0, indexes + 1).join(", ");
  return {
    ...(lowStore ? { aLow: "key" } : {}),
    operations: keys,
    reviewLogOperations: keys,
    _sync_outbox: "key",
    metadataKv: "key",
  };
}

/** The rows of the run, each page holding the row kinds it holds in a pull. */
function shape(rows: Row[], config: BenchConfig): Row[] {
  const limit = config.limit ?? rows.length;
  const pad = config.pad ? "x".repeat(config.pad) : undefined;
  if (config.priorityOrder)
    rows = [
      ...rows.filter((entry) => entry.table === "operations"),
      ...rows.filter((entry) => entry.table !== "operations"),
    ];
  const out: Row[] = [];
  for (let i = 0; i < limit; i++) {
    const source = rows[i % rows.length]!;
    const copy = Math.floor(i / rows.length);
    const row = { ...source.row };
    if (copy > 0) row.id = `${copy}:${row.id}`;
    if (pad) row.pad = pad;
    if (config.form === "json")
      out.push({
        table: source.table,
        row: {
          id: row.id,
          type: row.type,
          timestamp: row.timestamp,
          json: JSON.stringify(row),
        },
      });
    else out.push({ table: source.table, row });
  }
  return out;
}

function pages(rows: Row[], config: BenchConfig): Row[][] {
  const out: Row[][] = [];
  for (let i = 0; i < rows.length; i += config.batch) {
    const page = rows.slice(i, i + config.batch);
    if (config.form !== "page") {
      out.push(page);
      continue;
    }
    // One value per page: what a compact form could store.
    const byTable = new Map<string, Row["row"][]>();
    for (const { table, row } of page)
      byTable.set(table, [...(byTable.get(table) ?? []), row]);
    out.push(
      [...byTable].map(([table, tableRows]) => ({
        table: table as Row["table"],
        row: {
          id: `page:${i}`,
          type: "page",
          timestamp: 0,
          json: JSON.stringify(tableRows),
        },
      })),
    );
  }
  return out;
}

const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));

function open(config: BenchConfig) {
  const db = new Dexie(DB, {
    ...(config.durability === "default"
      ? {}
      : { chromeTransactionDurability: config.durability }),
  });
  db.version(1).stores(
    schema(config.lateIndexes ? 0 : config.indexes, config.gapStore === "aLow"),
  );
  return db;
}

async function dexieWrite(
  db: Dexie,
  page: Row[],
  config: BenchConfig,
  t0: number,
) {
  const started = performance.now() - t0;
  const tables = [...new Set(page.map((entry) => entry.table))];
  let looked = 0,
    put = 0;
  await db.transaction(
    "rw",
    [...(config.outbox ? ["_sync_outbox"] : []), ...tables],
    async () => {
      if (config.outbox)
        await db
          .table("_sync_outbox")
          .bulkGet(
            page.map(({ row }) => JSON.stringify([page[0]!.table, row.id])),
          );
      looked = performance.now() - t0;
      const rowsByTable = new Map<string, Row["row"][]>();
      for (const { table, row } of page)
        rowsByTable.set(table, [...(rowsByTable.get(table) ?? []), row]);
      for (const [table, rows] of rowsByTable)
        for (let i = 0; i < rows.length; i += config.chunk ?? rows.length)
          await db
            .table(table)
            .bulkPut(rows.slice(i, i + (config.chunk ?? rows.length)));
      put = performance.now() - t0;
    },
  );
  return {
    t: [started, looked, put, performance.now() - t0],
    n: page.length,
  } as Tx;
}

interface RawStats {
  putCallMs: number;
  slowPutGaps: number;
  gaps?: Float32Array;
  at: number;
}

async function rawWrite(
  idb: IDBDatabase,
  page: Row[],
  config: BenchConfig,
  t0: number,
  stats: RawStats,
) {
  const started = performance.now() - t0;
  const tables = [...new Set(page.map((entry) => entry.table))];
  const tx = idb.transaction(
    [...(config.outbox ? ["_sync_outbox"] : []), ...tables],
    "readwrite",
    config.durability === "default"
      ? undefined
      : { durability: config.durability },
  );
  let looked = started,
    put = started;
  const finished = new Promise<void>((done, fail) => {
    tx.oncomplete = () => done();
    tx.onerror = tx.onabort = () => fail(tx.error);
  });
  const first = stats.at;
  stats.at += page.length;
  const writeRows = () => {
    let last = performance.now();
    page.forEach(({ table, row }, index) => {
      const before = performance.now();
      const request = tx.objectStore(table).put(row);
      stats.putCallMs += performance.now() - before;
      request.onsuccess = () => {
        const now = performance.now();
        if (now - last > 1) stats.slowPutGaps++;
        if (stats.gaps) stats.gaps[first + index] = now - last;
        last = now;
        if (index === page.length - 1) put = now - t0;
      };
    });
  };
  if (config.outbox) {
    const outbox = tx.objectStore("_sync_outbox");
    page.forEach(({ row }, index) => {
      const request = outbox.get(JSON.stringify([page[0]!.table, row.id]));
      if (index === page.length - 1)
        request.onsuccess = () => {
          looked = performance.now() - t0;
          writeRows();
        };
    });
  } else writeRows();
  await finished;
  return {
    t: [started, looked, put, performance.now() - t0],
    n: page.length,
  } as Tx;
}

export async function runBench(
  rows: Row[],
  config: BenchConfig,
): Promise<BenchResult> {
  if (config.reset) await Dexie.delete(DB);
  const db = open(config);
  await db.open();
  const idb = db.backendDB();
  if (config.appMetadata) {
    await db.table("metadataKv").put({ key: "syncState", value: 2 });
    await db.table("metadataKv").put({ key: "owner", value: "lab" });
    await db.table("metadataKv").put({ key: "clientId", value: "lab" });
  }
  const shaped = shape(rows, config);
  const prepared = pages(shaped, config);
  const stats: RawStats = {
    putCallMs: 0,
    slowPutGaps: 0,
    at: 0,
    gaps: config.perPut ? new Float32Array(shaped.length) : undefined,
  };
  const txs: Tx[] = [];
  let written = 0,
    gapMs: number | undefined,
    nextGap = config.gapAt ?? Infinity;
  const t0 = performance.now();
  for (const page of prepared) {
    if (written >= nextGap) {
      nextGap = config.gapEvery ? nextGap + config.gapEvery : Infinity;
      const before = performance.now();
      if (config.gap === "wait" || config.gap === "wait+put")
        await pause(config.gapWait ?? 5);
      if (config.gap === "put" || config.gap === "wait+put")
        await db
          .table(config.gapStore ?? "metadataKv")
          .put({ key: `cardsRestored${written}`, value: "x" });
      gapMs = performance.now() - before;
    }
    txs.push(
      config.api === "raw"
        ? await rawWrite(idb, page, config, t0, stats)
        : await dexieWrite(db, page, config, t0),
    );
    written += config.form === "page" ? config.batch : page.length;
    if (config.pacing) await pause(config.pacing);
  }
  const ms = performance.now() - t0;
  let indexMs: number | undefined;
  if (config.lateIndexes && config.indexes > 0) {
    const before = performance.now();
    db.close();
    const later = new Dexie(DB);
    later.version(1).stores(schema(0));
    later.version(2).stores(schema(config.indexes));
    await later.open();
    indexMs = performance.now() - before;
    later.close();
    await db.open();
  }
  if (config.dropIndexes) {
    const before = performance.now();
    db.close();
    const later = new Dexie(DB);
    later.version(1).stores(schema(config.indexes));
    later.version(2).stores(schema(0));
    await later.open();
    indexMs = performance.now() - before;
    later.close();
    await db.open();
  }
  let bySize: BenchResult["bySize"];
  let slowRows: BenchResult["slowRows"];
  if (stats.gaps) {
    bySize = {};
    slowRows = [];
    for (let i = 0; i < shaped.length; i++) {
      const gap = stats.gaps[i]!;
      const bucket = String(
        Math.floor(JSON.stringify(shaped[i]!.row).length / 50) * 50,
      );
      const entry = (bySize[bucket] ??= [0, 0, 0]);
      entry[0]++;
      if (gap > 1) {
        entry[1]++;
        entry[2] += gap;
        slowRows.push([i, Math.round(gap * 10) / 10]);
      }
    }
  }
  const storeCounts: Record<string, number> = {};
  for (const table of db.tables) storeCounts[table.name] = await table.count();
  db.close();
  return {
    ms,
    txs,
    puts: prepared.reduce((sum, page) => sum + page.length, 0),
    gapMs,
    indexMs,
    ...(config.api === "raw"
      ? { putCallMs: stats.putCallMs, slowPutGaps: stats.slowPutGaps }
      : {}),
    bySize,
    slowRows,
    storeCounts,
    estimate: await navigator.storage?.estimate?.().catch(() => undefined),
  };
}

async function fetchRows(size: string): Promise<Row[]> {
  return (await fetch(`/rows.json?size=${size}`)).json();
}

declare const WorkerGlobalScope: unknown;
if (typeof WorkerGlobalScope !== "undefined") {
  addEventListener("message", async (event: MessageEvent) => {
    const { config, size } = event.data as {
      config: BenchConfig;
      size: string;
    };
    const rows = await fetchRows(size);
    postMessage({ ready: true });
    await pause(300);
    postMessage({ result: await runBench(rows, config) });
  });
} else {
  const labRun = async (config: BenchConfig, size: string) => {
    if (config.where === "worker") {
      const worker = new Worker("/page.js");
      return new Promise<BenchResult>((done, fail) => {
        worker.onerror = (event) => fail(new Error(event.message));
        worker.onmessage = (event) => {
          if (event.data.result) {
            worker.terminate();
            done(event.data.result);
          }
        };
        worker.postMessage({ config, size });
      });
    }
    const rows = await fetchRows(size);
    await pause(300);
    return runBench(rows, config);
  };
  Object.assign(window, { labRun });
  // A browser the driver cannot script: the URL says what to run.
  const auto = new URLSearchParams(location.search).get("auto");
  if (auto) {
    const { config, size } = JSON.parse(auto) as {
      config: BenchConfig;
      size: string;
    };
    void labRun(config, size).then(
      (result) =>
        fetch("/result", { method: "POST", body: JSON.stringify(result) }),
      (error: unknown) =>
        fetch("/result", {
          method: "POST",
          body: JSON.stringify({ error: String(error) }),
        }),
    );
  }
}
