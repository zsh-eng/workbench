# Native SQLite bulk-write benchmark — 26 September 2026

Native SQLite writes this snapshot much faster than the saved browser restore
trace. This is a storage-only experiment, not an end-to-end sync benchmark or
a controlled SQLite-versus-IndexedDB A/B test.

## Results

Six samples per case, from two complete three-round series. Case order rotates
within each series. All 30 restores passed row-count, full-content SHA-256,
indexed-column, and SQLite `quick_check` verification. No slow samples excluded.

| Dataset              | Records per transaction | Median writes including commits |         Range | Median final WAL checkpoint |
| -------------------- | ----------------------: | ------------------------------: | ------------: | --------------------------: |
| All records          |                     500 |                         1.574 s | 1.522–2.083 s |                     0.011 s |
| All records          |                   5,000 |                         0.727 s | 0.688–0.801 s |                     0.001 s |
| All records          |                  20,000 |                         0.493 s | 0.481–0.614 s |                     0.001 s |
| All records          |                  97,266 |                         0.470 s | 0.448–0.556 s |                     0.002 s |
| Card/deck state only |                   5,000 |                         0.152 s | 0.149–0.446 s |                     0.003 s |

Source: the same read-only converted 19 September snapshot used by the earlier
experiments, largest account: **97,266 records / 43.85 MB of JSON**. Its main-data
subset has **30,215 records / 9.98 MB**. These are historical single-account
figures, not the newer all-account production totals. Images are excluded.

## Method

- Bun 1.3.5, native SQLite 3.51.0, macOS ARM64, local disk files (not `:memory:`).
- Separate `operations` and `reviewLogOperations` tables, primary key `id`, and
  secondary indexes on `type` and `timestamp`; indexes were retained.
- Full domain row stored as JSON text alongside those indexed fields.
- Reused prepared UPSERT statement, one execution per record, grouped into
  explicit transactions. Fresh file per run; inserts exercise the empty-restore
  path, not update-heavy sync.
- WAL journal with `synchronous=FULL`, default automatic checkpoint settings.
  Writes include transaction commit and any automatic checkpoints. The final
  explicit WAL checkpoint is measured separately. No unsafe durability PRAGMAs.
- Source reads, domain decode/validation, JSON encoding, database setup and
  statement preparation are outside write timing. Preparing all rows took
  approximately 3 seconds per series; this work does not disappear in a real
  sync. Binding values and SQLite index maintenance are inside write timing.
- Read-back/JSON parsing and content verification are outside write timing.
  Read/parse does not reconstruct application Dates or the app's MemoryDB.
- All work ran serially. Another task was transcribing audio during these runs;
  host load was below the stop threshold of 20. These are not idle-machine
  guarantees. Both series and all slower observations are retained.
- First-series timings survive in the log at 1 ms precision; the second series
  contains full-resolution timings and host-load samples. The second run followed
  a correction to descriptive metadata only; the timed write path was unchanged.
- Disposable SQLite files and WAL files were removed after verification. Source
  snapshot was opened read-only; production was never contacted.

## Comparison with the earlier browser result

The [saved IndexedDB trace](SYNC_RESTORE_TRACE.md) restored the same 97,266
records in 15.697 seconds: 8.983 seconds awaiting bulk row writes, 3.735 seconds
awaiting outbox checks, 2.034 seconds decoding/preparing, and other work. Native
`IDBObjectStore.put()` calls in separate instrumented runs took 5.4–6.3 seconds.
That trace used 27 adaptive write transactions and retained the same secondary
index definitions. SQLite's 5,000-record case uses 20 fixed transactions.

SQLite's approximately 0.7-second bulk-write result is much smaller than that
saved roughly 9-second browser write span. It does **not** establish a precise
speedup: runs occurred on different days, batch boundaries and runtimes differ,
and the browser's awaited write span overlaps incoming stream work. SQLite
receives pre-encoded JSON; IndexedDB receives objects and performs structured
cloning. Browser durability and SQLite FULL are not proved equivalent at the
hardware level. Neither timing alone is the user's full restore wait.

A fresh Dexie/native IndexedDB comparison could not run: the computer-use tool
rejected this task's configured symlinked workspace root. Its attempted server
was stopped and its unused browser harness removed. Do not infer Dexie overhead
from this experiment. Native SQLite is also not SQLite WASM/OPFS in a browser;
that would require its own measured prototype before an application change.

## Reproduce

From `apps/spaced2`:

```sh
bun scripts/storage-benchmark/sqlite.ts
```

Requires private `cutover.local/converted/backend.sqlite`. Each invocation writes
a unique, content-free result JSON under `cutover.local/storage-benchmark`.
Committed aggregate samples: [SQLITE_STORAGE_BENCHMARK_RESULTS.json](SQLITE_STORAGE_BENCHMARK_RESULTS.json).
No app, shared-library, storage schema, or deployed runtime was changed.

Review this report first, then the result JSON, then
`scripts/storage-benchmark/sqlite.ts` for transaction boundaries and verification.
