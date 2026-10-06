import Dexie from "dexie";
import type {
  BenchmarkDatabase,
  BenchmarkMetadata,
  BenchmarkResult,
} from "./types";
import { createRemote } from "../../src/lib/sync/server";
import {
  SyncClient,
  createSyncClientState,
  createSyncClientStateStore,
  observeSyncHlcBatch,
  syncPullResponseSchema,
  type SyncPullResponse,
  type SyncRecord,
  type SyncPushChange,
} from "@zsh-eng/local-sync";
import { DexieSyncStorage, type PreparedRemoteRecord } from "@zsh-eng/local-sync/dexie";
import { syncTables, type StoredOperation } from "../../src/lib/sync/records";
const status = document.querySelector("#status")!;
const output = document.querySelector("#results")!;
const button = document.querySelector<HTMLButtonElement>("#run")!;
const results: BenchmarkResult[] = [];
const now = () => performance.now();
const encoder = new TextEncoder();
async function run(
  mode: string,
  delay: number,
  repeat: number,
  meta: BenchmarkMetadata,
) {
  const name = `SpacedSyncBenchmark-${crypto.randomUUID()}`;
  const db = new Dexie(name) as BenchmarkDatabase;
  db.version(1).stores({
    operations: "id,type,timestamp",
    reviewLogOperations: "id,type,timestamp",
    _sync_outbox: "key",
  });
  await db.open();
  const stateStore = createSyncClientStateStore(localStorage, name);
  stateStore.write(createSyncClientState(crypto.randomUUID()));
  const realStorage = new DexieSyncStorage({ db, tables: syncTables });
  const fixedSize = mode.startsWith("stream-fixed-")
    ? Number(mode.split("-").at(-1))
    : 0;
  const queueFrames = fixedSize ? Math.max(8, fixedSize / 500) : 8;
  const queueBytes = fixedSize ? 32 * 1024 * 1024 : 4 * 1024 * 1024;
  const metrics: BenchmarkResult = {
    mode,
    delay,
    repeat,
    totalMs: 0,
    prepareMs: 0,
    writeMs: 0,
    requests: 0,
    writes: 0,
    maxWriteMs: 0,
    maxPrepareMs: 0,
    peakQueueRecords: 0,
    peakQueueJsonBytes: 0,
    verified: false,
  };
  const storage = {
    prepareRemoteRecords(records: readonly SyncRecord[]) {
      const t = now();
      const p = realStorage.prepareRemoteRecords(records);
      const elapsed = now() - t;
      metrics.prepareMs += elapsed;
      metrics.maxPrepareMs = Math.max(metrics.maxPrepareMs, elapsed);
      return p;
    },
    async applyRemoteRecords(p: readonly PreparedRemoteRecord[], device: string) {
      const t = now();
      const r = await realStorage.applyRemoteRecords(p, device);
      const elapsed = now() - t;
      metrics.writeMs += elapsed;
      metrics.maxWriteMs = Math.max(metrics.maxWriteMs, elapsed);
      metrics.writes++;
      return r;
    },
    getPendingChanges: () => realStorage.getPendingChanges(),
    reconcilePushResults: (
      a: readonly SyncPushChange[],
      b: readonly PreparedRemoteRecord[],
    ) => realStorage.reconcilePushResults(a, b),
  };
  const started = now();
  try {
    if (mode === "package-stream") {
      const controller = new AbortController();
      const remote = createRemote(controller.signal);
      try {
        await new SyncClient({
          storage,
          stateStore,
          signal: controller.signal,
          remote: {
            ...remote,
            async *pullStream(device, request, signal) {
              metrics.requests++;
              yield* remote.pullStream!(device, request, signal);
            },
          },
        }).pull();
      } finally {
        controller.abort();
      }
    } else if (mode.startsWith("paged-")) {
      const size = Number(mode.split("-").at(-1));
      let cursor = 0,
        head: number | undefined,
        terminal = false;
      while (!terminal) {
        metrics.requests++;
        const response = await fetch(
          `/group?delay=${delay}&size=${size}&cursor=${cursor}`,
        );
        if (!response.ok) throw new Error("Fetch failed");
        const raw = await response.json();
        if (!Array.isArray(raw) || raw.length === 0)
          throw new Error("Empty group");
        const pages = raw.map((p) =>
          syncPullResponseSchema.parse(syncPullResponseSchema.parse(p)),
        );
        for (const page of pages) {
          if (
            terminal ||
            (head !== undefined && page.head !== head) ||
            page.cursor <= cursor ||
            page.records.some((r) => r.serverSeq <= cursor)
          )
            throw new Error("Invalid group cursor");
          cursor = page.cursor;
          head = page.head;
          terminal = !page.hasMore;
        }
        const records = pages.flatMap((p) => p.records);
        const prepared = storage.prepareRemoteRecords(records);
        observeSyncHlcBatch(
          records.map((r) => r.hlc),
          stateStore,
        );
        await storage.applyRemoteRecords(prepared, stateStore.read()!.deviceId);
        stateStore.write({
          ...stateStore.read()!,
          pullCursor: cursor,
          bootstrapped: terminal,
        });
      }
    } else if (mode === "current") {
      await new SyncClient({
        storage,
        stateStore,
        remote: {
          async pull(_device, body) {
            metrics.requests++;
            const response = await fetch(
              `/pull?delay=${delay}&cursor=${body.cursor}`,
            );
            if (!response.ok) throw new Error("Fetch failed");
            return syncPullResponseSchema.parse(await response.json());
          },
          async push() {
            throw new Error("Benchmark only pulls");
          },
        },
      }).pull();
    } else {
      metrics.requests++;
      const response = await fetch(`/stream?delay=${delay}`);
      if (!response.ok || !response.body) throw new Error("Stream failed");
      const reader = response.body
        .pipeThrough(new TextDecoderStream())
        .getReader();
      const queue: { page: SyncPullResponse; bytes: number }[] = [];
      let queuedBytes = 0,
        done = false,
        cancelled = false,
        producerBlocked = false,
        failure: unknown,
        changed = () => {};
      let waiter: Promise<void> | undefined;
      const signal = () => {
        changed();
        waiter = undefined;
      };
      const wait = () =>
        (waiter ??= new Promise<void>((resolve) => {
          changed = resolve;
        }));
      const producer = (async () => {
        let pending = "",
          cursor = 0,
          head: number | undefined,
          terminal = false;
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            pending += chunk.value;
            let newline: number;
            while ((newline = pending.indexOf("\n")) >= 0) {
              const line = pending.slice(0, newline);
              pending = pending.slice(newline + 1);
              const bytes = encoder.encode(line).length;
              if (bytes > 4 * 1024 * 1024) throw new Error("Frame too large");
              while (
                queuedBytes + bytes > queueBytes ||
                queue.length >= queueFrames
              ) {
                if (cancelled) throw new Error("Consumer stopped");
                producerBlocked = true;
                signal();
                await wait();
              }
              if (cancelled) throw new Error("Consumer stopped");
              producerBlocked = false;
              // Match the current path's two envelope validations.
              const page = syncPullResponseSchema.parse(
                syncPullResponseSchema.parse(JSON.parse(line)),
              );
              if (
                terminal ||
                (head !== undefined && head !== page.head) ||
                page.cursor <= cursor ||
                page.records.some((r) => r.serverSeq <= cursor)
              )
                throw new Error("Invalid stream cursor");
              cursor = page.cursor;
              head = page.head;
              terminal = !page.hasMore;
              queue.push({ page, bytes });
              queuedBytes += bytes;
              metrics.peakQueueRecords = Math.max(
                metrics.peakQueueRecords,
                queue.reduce((n, q) => n + q.page.records.length, 0),
              );
              metrics.peakQueueJsonBytes = Math.max(
                metrics.peakQueueJsonBytes,
                queuedBytes,
              );
              signal();
            }
            if (pending.length > 4 * 1024 * 1024)
              throw new Error("Unbounded partial frame");
          }
          if (pending || !terminal) throw new Error("Truncated stream");
        } catch (error) {
          failure = error;
        } finally {
          done = true;
          signal();
        }
      })();
      try {
        while (!done || queue.length) {
          if (failure) throw failure;
          if (
            !queue.length ||
            (fixedSize &&
              queue.length < fixedSize / 500 &&
              !done &&
              !producerBlocked)
          ) {
            await wait();
            continue;
          }
          const batch = queue.splice(
            0,
            fixedSize ? fixedSize / 500 : mode === "stream-500" ? 1 : 8,
          );
          queuedBytes -= batch.reduce((n, p) => n + p.bytes, 0);
          signal();
          const records = batch.flatMap((p) => p.page.records);
          const prepared = storage.prepareRemoteRecords(records);
          observeSyncHlcBatch(
            records.map((r) => r.hlc),
            stateStore,
          );
          await storage.applyRemoteRecords(
            prepared,
            stateStore.read()!.deviceId,
          );
          const last = batch.at(-1)!.page;
          stateStore.write({
            ...stateStore.read()!,
            pullCursor: last.cursor,
            bootstrapped: false,
          });
        }
        await producer;
        if (failure) throw failure;
        stateStore.write({ ...stateStore.read()!, bootstrapped: true });
      } finally {
        cancelled = true;
        signal();
        await reader.cancel();
        await producer;
      }
    }
    metrics.totalMs = now() - started;
    const count =
      (await db.operations.count()) + (await db.reviewLogOperations.count());
    if (
      count !== meta.records ||
      stateStore.read()!.pullCursor !== meta.head ||
      !stateStore.read()!.bootstrapped ||
      (await db._sync_outbox.count()) !== 0
    )
      throw new Error("Restore verification failed");
    // Compare every stored row to the domain decoder output, outside the timed section.
    const expected = await fetch("/stream");
    const text = await expected.text();
    for (const line of text.trimEnd().split("\n")) {
      const prepared = realStorage.prepareRemoteRecords(
        JSON.parse(line).records,
      );
      for (const table of ["operations", "reviewLogOperations"]) {
        const subset = prepared.filter((p) => p.tableName === table);
        const actual = await db
          .table(table)
          // syncTables decodes these rows through toStoredOperation, which assigns string IDs.
          .bulkGet(subset.map((p) => p.row.id as StoredOperation["id"]));
        if (
          actual.some(
            (row: unknown, i: number) =>
              JSON.stringify(row) !== JSON.stringify(subset[i].row),
          )
        )
          throw new Error("Stored row mismatch");
      }
    }
    metrics.verified = true;
    return metrics;
  } finally {
    await db.delete();
    localStorage.removeItem(name);
  }
}
button.onclick = async () => {
  button.disabled = true;
  cleanupButton.disabled = true;
  packageButton.disabled = true;
  smokeButton.disabled = true;
  batchButton.disabled = true;
  results.length = 0;
  try {
    const meta = await (await fetch("/meta")).json();
    for (let repeat = 1; repeat <= 3; repeat++)
      for (const delay of [0, 100]) {
        const modes = ["current", "stream-500", "stream-adaptive"];
        // Rotate order to reduce cache/order bias.
        for (const mode of [
          ...modes.slice(repeat - 1),
          ...modes.slice(0, repeat - 1),
        ]) {
          status.textContent = `Running ${mode}, ${delay} ms/request, repeat ${repeat}/3`;
          results.push(await run(mode, delay, repeat, meta));
          output.textContent = JSON.stringify(results, null, 2);
          await fetch("/result", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              meta,
              userAgent: navigator.userAgent,
              results,
            }),
          });
        }
      }
    status.textContent = "Complete: all restores verified";
  } catch (error) {
    status.textContent = `Failed: ${error instanceof Error ? error.stack : error}`;
  } finally {
    button.disabled = false;
    smokeButton.disabled = false;
    batchButton.disabled = false;
    cleanupButton.disabled = false;
    packageButton.disabled = false;
  }
};

const smokeButton = document.querySelector<HTMLButtonElement>("#smoke")!;
smokeButton.onclick = async () => {
  smokeButton.disabled = true;
  cleanupButton.disabled = true;
  packageButton.disabled = true;
  button.disabled = true;
  batchButton.disabled = true;
  status.textContent = "Running streaming smoke check";
  try {
    const meta = await (await fetch("/meta")).json();
    const result = await run("stream-adaptive", 0, 1, meta);
    output.textContent = JSON.stringify(result, null, 2);
    await fetch("/smoke-result", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result),
    });
    status.textContent = "Smoke check complete: all records verified";
  } catch (error) {
    status.textContent = `Failed: ${error}`;
  } finally {
    smokeButton.disabled = false;
    button.disabled = false;
    batchButton.disabled = false;
    cleanupButton.disabled = false;
    packageButton.disabled = false;
  }
};

const batchButton = document.querySelector<HTMLButtonElement>("#batches")!;
batchButton.onclick = async () => {
  for (const b of [
    button,
    smokeButton,
    batchButton,
    cleanupButton,
    packageButton,
  ])
    b.disabled = true;
  const batchResults: BenchmarkResult[] = [];
  try {
    const meta = await (await fetch("/meta")).json();
    const cases = [
      ["stream-fixed-500", 0],
      ["stream-fixed-5000", 0],
      ["stream-fixed-20000", 0],
      ["paged-500", 100],
      ["paged-5000", 100],
      ["paged-20000", 100],
    ] as const;
    for (let repeat = 1; repeat <= 3; repeat++) {
      const shift = (repeat - 1) * 2;
      for (const [mode, delay] of [
        ...cases.slice(shift),
        ...cases.slice(0, shift),
      ]) {
        status.textContent = `Batch comparison: ${mode}, repeat ${repeat}/3`;
        batchResults.push(await run(mode, delay, repeat, meta));
        output.textContent = JSON.stringify(batchResults, null, 2);
        await fetch("/batch-result", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            meta,
            userAgent: navigator.userAgent,
            results: batchResults,
          }),
        });
      }
    }
    status.textContent = "Batch comparison complete: all restores verified";
  } catch (error) {
    status.textContent = `Failed: ${error instanceof Error ? error.stack : error}`;
  } finally {
    for (const b of [
      button,
      smokeButton,
      batchButton,
      cleanupButton,
      packageButton,
    ])
      b.disabled = false;
  }
};

const cleanupButton = document.querySelector<HTMLButtonElement>("#cleanup")!;
cleanupButton.onclick = async () => {
  for (const b of [
    button,
    smokeButton,
    batchButton,
    cleanupButton,
    packageButton,
  ])
    b.disabled = true;
  try {
    const names = (await Dexie.getDatabaseNames()).filter((name) =>
      name.startsWith("SpacedSyncBenchmark-"),
    );
    for (const name of names) {
      await Dexie.delete(name);
      localStorage.removeItem(name);
    }
    status.textContent = `Removed ${names.length} disposable benchmark databases`;
  } catch (error) {
    status.textContent = `Cleanup failed: ${error}`;
  } finally {
    for (const b of [
      button,
      smokeButton,
      batchButton,
      cleanupButton,
      packageButton,
    ])
      b.disabled = false;
  }
};

const packageButton = document.querySelector<HTMLButtonElement>("#package")!;
packageButton.onclick = async () => {
  const buttons = [
    button,
    smokeButton,
    batchButton,
    cleanupButton,
    packageButton,
  ];
  for (const b of buttons) b.disabled = true;
  status.textContent = "Checking installed package with the full snapshot";
  try {
    const meta = await (await fetch("/meta")).json();
    const result = await run("package-stream", 0, 1, meta);
    output.textContent = JSON.stringify(result, null, 2);
    await fetch("/package-result", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result),
    });
    status.textContent =
      "Installed package check complete: all records verified";
  } catch (error) {
    status.textContent = `Failed: ${error instanceof Error ? error.stack : error}`;
  } finally {
    for (const b of buttons) b.disabled = false;
  }
};
