import Dexie from "dexie";
import {
  createSyncClientState,
  createSyncClientStateStore,
  observeSyncHlcBatch,
  syncPullResponseSchema,
  type SyncPullResponse,
  type SyncRecord,
} from "@zsh-eng/local-sync";
import {
  DexieSyncStorage,
  type SyncDexieDatabase,
} from "@zsh-eng/local-sync/dexie";
import { syncTables } from "../../src/lib/sync/records";
import { createRemote } from "../../src/lib/sync/server";
import { instrumentOutbox } from "./outbox";
import { createTrace } from "./trace";
import {
  candidates,
  combinations,
  type Candidate,
  installPackedRows,
  frameSize,
} from "./candidates";
const combined = new URLSearchParams(location.search).has("combined");
const activeCandidates = combined ? combinations : candidates;
const experiments =
  combined || new URLSearchParams(location.search).has("candidates");
const resultsPath = combined
  ? "/combination-results"
  : experiments
    ? "/candidate-results"
    : new URLSearchParams(location.search).has("trace")
      ? "/trace-results"
      : "/results";
const plannedRuns = experiments
  ? activeCandidates.length * 3
  : new URLSearchParams(location.search).has("trace")
    ? 3
    : 18;
const tracing = new URLSearchParams(location.search).has("trace");
const status = document.querySelector("#status")!;
const output = document.querySelector("#output")!;
const encoder = new TextEncoder();
const configurations = [
  { name: "fixed-500", size: 500, fast: false },
  { name: "fixed-5000", size: 5000, fast: false },
  { name: "fixed-20000", size: 20000, fast: false },
  { name: "adaptive", size: 0, fast: false },
  { name: "fixed-500-fast", size: 500, fast: true },
  { name: "adaptive-fast", size: 0, fast: true },
];
let stop = false;
let active: AbortController | undefined;
const results: (Awaited<ReturnType<typeof run>> & {
  host: { load: number[]; at: string };
})[] = [];
const now = () => performance.now();
async function run(
  config: Candidate,
  repeat: number,
  meta: { records: number; head: number },
) {
  const name = "SpacedOptimizationBenchmark-" + crypto.randomUUID();
  const db = new Dexie(name) as SyncDexieDatabase;
  db.version(1).stores({
    operations: config.noIndexes ? "id" : "id,type,timestamp",
    reviewLogOperations: config.noIndexes ? "id" : "id,type,timestamp",
    _sync_outbox: "key",
  });
  if (config.packed) installPackedRows(db);
  await db.open();
  const stateStore = createSyncClientStateStore(localStorage, name);
  stateStore.write(createSyncClientState(crypto.randomUUID()));
  const metrics = {
    mode: config.name,
    repeat,
    totalMs: 0,
    prepareMs: 0,
    writeMs: 0,
    maxPrepareMs: 0,
    maxWriteMs: 0,
    requests: 0,
    writes: 0,
    minWriteRecords: Infinity,
    maxWriteRecords: 0,
    peakQueueRecords: 0,
    peakQueueJsonBytes: 0,
    outboxChecks: 0,
    outboxGets: 0,
    verified: false,
  };
  const trace = createTrace(
    tracing,
    new URLSearchParams(location.search).has("native"),
  );
  trace.instrument(db);
  instrumentOutbox(db, config.fast, metrics);
  const storage = new DexieSyncStorage({ db, tables: syncTables });
  const controller = new AbortController();
  active = controller;
  const remote = createRemote(controller.signal);
  const queue: { page: SyncPullResponse; bytes: number }[] = [];
  const maxPages =
    config.queuePages ?? (config.size ? Math.ceil(config.size / 500) : 8);
  const maxBytes = config.size ? 32 * 1024 * 1024 : 4 * 1024 * 1024;
  let queueBytes = 0,
    done = false,
    blocked = false,
    failure: unknown,
    received = 0,
    head: number | undefined,
    terminal = false;
  const waiters = new Set<() => void>();
  const signal = () => {
    for (const wake of waiters) wake();
    waiters.clear();
  };
  const wait = () => new Promise<void>((resolve) => waiters.add(resolve));
  controller.signal.addEventListener("abort", signal);
  const deadline = setTimeout(
    () => controller.abort(new Error("Benchmark exceeded 120 seconds")),
    120000,
  );
  const started = now();
  const producer = (async () => {
    try {
      while (!terminal) {
        metrics.requests++;
        let pages = 0;
        for await (const raw of remote.pullStream!(
          stateStore.read()!.deviceId,
          {
            cursor: received,
            ...(head === undefined ? {} : { head }),
            limit: 500,
            excludeOwnDevice: false,
          },
          controller.signal,
        )) {
          const endPage = trace.begin("producer-page-work");
          const page = config.lean ? raw : syncPullResponseSchema.parse(raw);
          pages++;
          if (
            terminal ||
            (head !== undefined && head !== page.head) ||
            page.cursor <= received ||
            page.cursor > page.head ||
            (!page.hasMore && page.cursor !== page.head)
          )
            throw Error("Invalid stream boundary");
          let seq = received;
          for (const row of page.records) {
            if (row.serverSeq <= seq || row.serverSeq > page.cursor)
              throw Error("Invalid record sequence");
            seq = row.serverSeq;
          }
          received = page.cursor;
          head = page.head;
          terminal = !page.hasMore;
          const bytes = config.lean
            ? frameSize(raw)
            : encoder.encode(JSON.stringify(page)).length;
          if (bytes > maxBytes) throw Error("Frame exceeds buffer");
          endPage();
          while (queue.length >= maxPages || queueBytes + bytes > maxBytes) {
            blocked = true;
            signal();
            controller.signal.throwIfAborted();
            await wait();
          }
          controller.signal.throwIfAborted();
          blocked = false;
          queue.push({ page, bytes });
          queueBytes += bytes;
          metrics.peakQueueRecords = Math.max(
            metrics.peakQueueRecords,
            queue.reduce((n, x) => n + x.page.records.length, 0),
          );
          metrics.peakQueueJsonBytes = Math.max(
            metrics.peakQueueJsonBytes,
            queueBytes,
          );
          signal();
          if (config.yieldPages && pages % config.yieldPages === 0)
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
        if (!pages) throw Error("Empty stream");
      }
    } catch (e) {
      failure = e;
    } finally {
      done = true;
      signal();
    }
  })();
  try {
    while (!done || queue.length) {
      controller.signal.throwIfAborted();
      if (failure) throw failure;
      const buffered = queue.reduce((n, x) => n + x.page.records.length, 0);
      if (
        !queue.length ||
        (config.size && buffered < config.size && !done && !blocked)
      ) {
        const endWait = trace.begin("consumer-wait");
        await wait();
        endWait();
        continue;
      }
      const batch = queue.splice(0, maxPages);
      queueBytes -= batch.reduce((n, x) => n + x.bytes, 0);
      signal();
      const records = batch.flatMap((x) => x.page.records);
      let t = now();
      const endPrepare = trace.begin("prepare");
      const prepared = storage.prepareRemoteRecords(records);
      endPrepare();
      const prepareMs = now() - t;
      metrics.prepareMs += prepareMs;
      metrics.maxPrepareMs = Math.max(metrics.maxPrepareMs, prepareMs);
      const endHlc = trace.begin("hlc");
      observeSyncHlcBatch(
        records.map((r) => r.hlc),
        stateStore,
      );
      endHlc();
      t = now();
      const endApply = trace.begin("apply");
      await storage.applyRemoteRecords(prepared, stateStore.read()!.deviceId);
      endApply();
      const writeMs = now() - t;
      metrics.writeMs += writeMs;
      metrics.maxWriteMs = Math.max(metrics.maxWriteMs, writeMs);
      metrics.writes++;
      metrics.minWriteRecords = Math.min(
        metrics.minWriteRecords,
        records.length,
      );
      metrics.maxWriteRecords = Math.max(
        metrics.maxWriteRecords,
        records.length,
      );
      const endCheckpoint = trace.begin("checkpoint");
      stateStore.write({
        ...stateStore.read()!,
        pullCursor: batch.at(-1)!.page.cursor,
        bootstrapped: false,
      });
      endCheckpoint();
    }
    await producer;
    if (failure) throw failure;
    stateStore.write({ ...stateStore.read()!, bootstrapped: true });
    metrics.totalMs = now() - started;
    const measuredSpans = trace.spans.slice();
    status.textContent = `Verify ${config.name}, round ${repeat + 1}`;
    // Full saved-row comparison is outside timing. Fetch a separate plain fixture.
    const expected: SyncRecord[] = await (await fetch("/verify")).json();
    const actual = new Map<string, string>();
    const loadStarted = now();
    const loaded: { table: string; rows: Record<string, unknown>[] }[] = [];
    for (const table of ["operations", "reviewLogOperations"])
      loaded.push({
        table,
        rows: (await db.table<Record<string, unknown>>(table).toArray()).map(
          (row) =>
            config.packed
              ? syncTables[table].decode!(row.value as string)
              : row,
        ),
      });
    const loadAndHydrateMs = now() - loadStarted;
    for (const { table, rows } of loaded)
      for (const row of rows)
        actual.set(table + ":" + row.id, JSON.stringify(row));
    let count = 0;
    for (let i = 0; i < expected.length; i += 500) {
      for (const row of storage.prepareRemoteRecords(
        expected.slice(i, i + 500),
      )) {
        const key = row.tableName + ":" + row.row.id;
        if (actual.get(key) !== JSON.stringify(row.row))
          throw Error("Saved row mismatch");
        actual.delete(key);
        count++;
      }
    }
    if (
      actual.size ||
      count !== meta.records ||
      stateStore.read()!.pullCursor !== meta.head ||
      !stateStore.read()!.bootstrapped ||
      (await db._sync_outbox.count())
    )
      throw Error("Restore state mismatch");
    metrics.verified = true;
    return {
      ...metrics,
      loadAndHydrateMs,
      ...(tracing ? { spans: measuredSpans, native: { ...trace.native } } : {}),
    };
  } finally {
    trace.dispose();
    clearTimeout(deadline);
    controller.abort();
    signal();
    await producer;
    await db.delete();
    localStorage.removeItem(name);
    active = undefined;
  }
}
document.querySelector<HTMLButtonElement>("#run")!.onclick = async () => {
  const button = document.querySelector<HTMLButtonElement>("#run")!;
  button.disabled = true;
  stop = false;
  try {
    const meta = await (await fetch("/meta")).json();
    const cases = experiments
      ? activeCandidates.map((c) => ({ ...c, size: 0, fast: true }))
      : tracing
        ? configurations.filter((c) => c.name === "adaptive-fast")
        : configurations;
    for (let repeat = 0; repeat < 3 && !stop; repeat++)
      for (const config of [
        ...cases.slice(repeat),
        ...cases.slice(0, repeat),
      ]) {
        if (stop) break;
        status.textContent = `Run ${config.name}, round ${repeat + 1}/3`;
        const sample = await run(config, repeat, meta);
        const host = await (await fetch("/host")).json();
        results.push({ ...sample, host });
        output.textContent = JSON.stringify(
          {
            last: { ...sample, spans: undefined },
            completed: results.length,
            host,
          },
          null,
          2,
        );
        await fetch(resultsPath, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            meta,
            userAgent: navigator.userAgent,
            plannedRuns,
            status: stop ? "stopped" : "running",
            results,
            host,
          }),
        });
        if (host.load[0] > 20) {
          stop = true;
          status.textContent =
            "Stopped after verified run: system load exceeds 20";
        }
      }
    if (!stop)
      status.textContent = `Complete: all ${plannedRuns} restores verified`;
    await fetch(resultsPath, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        meta,
        userAgent: navigator.userAgent,
        plannedRuns,
        status: stop ? "stopped" : "complete",
        results,
      }),
    });
  } catch (e) {
    status.textContent = String(e);
    await fetch(resultsPath, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        status: "failed",
        error: String(e),
        plannedRuns,
        results,
      }),
    }).catch(() => {});
  } finally {
    button.disabled = false;
  }
};
document.querySelector("#stop")!.addEventListener("click", () => {
  stop = true;
  status.textContent = "Will stop after the active run is verified";
});
document.querySelector("#abort")!.addEventListener("click", () => {
  stop = true;
  active?.abort();
});
document.querySelector("#cleanup")!.addEventListener("click", async () => {
  for (const { name } of await indexedDB.databases())
    if (name?.startsWith("SpacedOptimizationBenchmark-")) {
      await Dexie.delete(name);
      localStorage.removeItem(name);
    }
  status.textContent = "Disposable optimization databases removed";
});
