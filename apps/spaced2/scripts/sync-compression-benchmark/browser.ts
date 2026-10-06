import Dexie from "dexie";
import type { BenchmarkDatabase } from "../sync-benchmark/types";
import type { SyncPullResponse, SyncRecord, SyncPushChange } from "@zsh-eng/local-sync";
import { gunzipSync } from "../../cutover.local/compression/deps/node_modules/fflate";
import { decompress } from "../../cutover.local/compression/deps/node_modules/fzstd";
import {
  SyncClient,
  createSyncClientState,
  createSyncClientStateStore,
} from "@zsh-eng/local-sync";
import { DexieSyncStorage, type PreparedRemoteRecord } from "@zsh-eng/local-sync/dexie";
import { syncTables } from "../../src/lib/sync/records";
const status = document.querySelector("#status")!;
const results: Awaited<ReturnType<typeof run>>[] = [];
const textDecoder = new TextDecoder();
function decode(value: string, mode: string) {
  if (mode === "plain") return value;
  const data = Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  return textDecoder.decode(
    mode.startsWith("gzip") ? gunzipSync(data) : decompress(data),
  );
}
async function* pages(mode: string, metrics: { decompressMs: number }) {
  const response = await fetch("/data/" + mode);
  if (!response.ok) throw Error("Fixture unavailable");
  const reader = response
    .body!.pipeThrough(new TextDecoderStream())
    .getReader();
  let pending = "";
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      pending += item.value;
      let end: number;
      while ((end = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, end);
        pending = pending.slice(end + 1);
        if (!line) continue;
        const page = JSON.parse(line) as SyncPullResponse;
        const t = performance.now();
        for (const r of page.records) r.value = decode(r.value, mode);
        metrics.decompressMs += performance.now() - t;
        yield page;
      }
    }
    if (pending) throw Error("Truncated fixture");
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}
async function run(mode: string, repeat: number) {
  const name = "SpacedCompressionBenchmark-" + crypto.randomUUID();
  const db = new Dexie(name) as BenchmarkDatabase;
  db.version(1).stores({
    operations: "id,type,timestamp",
    reviewLogOperations: "id,type,timestamp",
    _sync_outbox: "key",
  });
  await db.open();
  const stateStore = createSyncClientStateStore(localStorage, name);
  stateStore.write(createSyncClientState(crypto.randomUUID()));
  const storage = new DexieSyncStorage({ db, tables: syncTables });
  const metrics = {
    mode,
    repeat,
    totalMs: 0,
    decompressMs: 0,
    prepareMs: 0,
    writeMs: 0,
    records: 0,
    verified: false,
  };
  try {
    const t = performance.now();
    const client = new SyncClient({
      stateStore,
      storage: {
        prepareRemoteRecords(records: readonly SyncRecord[]) {
          const t = performance.now();
          const prepared = storage.prepareRemoteRecords(records);
          metrics.prepareMs += performance.now() - t;
          return prepared;
        },
        async applyRemoteRecords(prepared: readonly PreparedRemoteRecord[], device: string) {
          const t = performance.now();
          const r = await storage.applyRemoteRecords(prepared, device);
          metrics.writeMs += performance.now() - t;
          return r;
        },
        getPendingChanges: () => storage.getPendingChanges(),
        reconcilePushResults: (
          a: readonly SyncPushChange[],
          b: readonly PreparedRemoteRecord[],
        ) => storage.reconcilePushResults(a, b),
      },
      remote: {
        pull: async () => {
          throw Error("Unexpected fallback");
        },
        push: async () => {
          throw Error("Read-only benchmark");
        },
        pullStream: () => pages(mode, metrics),
      },
    });
    await client.pull();
    metrics.totalMs = performance.now() - t;
    // Compare every stored domain row outside timing against the plain fixture.
    const stored = new Map<string, string>();
    for (const table of ["operations", "reviewLogOperations"])
      for (const row of await db.table(table).toArray())
        stored.set(table + ":" + row.id, JSON.stringify(row));
    let expectedCursor = 0;
    for await (const page of pages("plain", { decompressMs: 0 })) {
      expectedCursor = page.cursor;
      for (const prepared of storage.prepareRemoteRecords(page.records)) {
        const key = prepared.tableName + ":" + prepared.row.id;
        if (stored.get(key) !== JSON.stringify(prepared.row))
          throw Error("Stored row mismatch");
        stored.delete(key);
        metrics.records++;
      }
    }
    if (
      stored.size ||
      metrics.records !== 97266 ||
      stateStore.read()?.pullCursor !== expectedCursor ||
      !stateStore.read()?.bootstrapped ||
      (await db._sync_outbox.count())
    )
      throw Error("Incomplete restore");
    metrics.verified = true;
    return metrics;
  } finally {
    db.close();
    await Dexie.delete(name);
    localStorage.removeItem(name);
  }
}
document.querySelector("#run")!.addEventListener("click", async () => {
  const button = document.querySelector("#run") as HTMLButtonElement;
  button.disabled = true;
  try {
    for (let repeat = 0; repeat < 3; repeat++) {
      const modes = ["plain", "gzip6", "zstd3"];
      modes.push(...modes.splice(0, repeat));
      for (const mode of modes) {
        status.textContent = `Run ${repeat + 1}/3: ${mode}`;
        results.push(await run(mode, repeat));
        await fetch("/results", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userAgent: navigator.userAgent, results }),
        });
      }
    }
    status.textContent = JSON.stringify(results, null, 2);
  } catch (e) {
    status.textContent = String(e);
  } finally {
    button.disabled = false;
  }
});
document.querySelector("#cleanup")!.addEventListener("click", async () => {
  for (const { name } of await indexedDB.databases())
    if (name?.startsWith("SpacedCompressionBenchmark-")) {
      await Dexie.delete(name);
      localStorage.removeItem(name);
    }
  status.textContent = "Disposable compression databases removed";
});
