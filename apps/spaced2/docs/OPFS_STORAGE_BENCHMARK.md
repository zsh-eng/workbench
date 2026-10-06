# Browser OPFS storage comparison — 26 September 2026

**Worth a further prototype, not enough evidence to migrate production.** Later
OPFS full writes took 1.28–1.30 seconds versus 6.76–8.09 seconds for IndexedDB.
The first OPFS full write took 8.97 seconds. All samples are retained below.
No claim is made that OPFS will always be faster, or that this is full sync time.

## Verified results

Three rotated rounds; 5,000-record transactions; indexes retained. Times are
seconds spent writing, through transaction completion. Every sample passed a
full-content comparison after reopening in a **fresh worker**, then removed its
temporary database. All 18 samples passed.

| Dataset     | Engine             | Three samples (seconds, round order) | Median (seconds) |
| ----------- | ------------------ | ------------------------------------ | ---------------: |
| All records | Dexie / IndexedDB  | 7.005 / 7.153 / 7.412                |            7.153 |
| All records | Raw IndexedDB      | 8.087 / 6.763 / 7.699                |            7.699 |
| All records | SQLite WASM / OPFS | 8.974 / 1.278 / 1.295                |            1.295 |
| Main data   | Dexie / IndexedDB  | 2.258 / 1.971 / 2.006                |            2.006 |
| Main data   | Raw IndexedDB      | 2.311 / 2.354 / 1.911                |            2.311 |
| Main data   | SQLite WASM / OPFS | 2.437 / 2.561 / 0.337                |            2.437 |

“All records” is the historical largest-account snapshot: **97,266 records,
43.85 MB JSON, 20 transactions**. Main data excludes historical reviews:
**30,215 records, 9.98 MB JSON, 7 transactions**. This is the same read-only
19 September source used by the native SQLite and earlier sync experiments,
not a new production export. Images are excluded.

## Variation matters

The first OPFS full sample took 8.974 seconds; subsequent full samples took
1.279 and 1.295 seconds. Main OPFS samples were 2.437, 2.561 and 0.337 seconds.
Simply quoting the fastest result would hide this variation. Likewise, the main
OPFS median is slower than Dexie's despite the much faster final sample.

Slow early cases also had slow **preparation before loading SQLite/WASM**:
27.794 seconds for the first OPFS full sample versus 2.263–2.273 seconds later.
Early main-data preparation took about 4.7–5.3 seconds across all engines;
later it took 0.42–0.45 seconds. Therefore WASM cold compilation alone does not
explain the pattern. Background scheduling, machine contention, GC or runtime
warm-up were not isolated. Another task was transcribing audio during this
session. Host load stayed below the stop threshold of 20, but that does not
exclude these effects. No samples were removed or selectively rerun.

During the later comparable rounds, full-data preparation was about 2.2–2.3
seconds for all engines while OPFS writes were still substantially faster.
This is promising enough for a controlled cold/warm follow-up, not a guaranteed
5x production speedup.

## Method and boundaries

- Chrome 153 on this Mac; all three engines run in dedicated Web Workers.
- Dexie 4.4.2 `bulkPut`, raw IndexedDB `put`, official SQLite WASM
  `@sqlite.org/sqlite-wasm` 3.53.4-build1, SQLite 3.53.4.
- OPFS adapter: **SAH-pool**. One writer at a time. SQLite reports journal mode
  `delete`, synchronous level `2` (FULL). IndexedDB uses browser-default
  durability, matching the app. These do not prove equivalent hardware-level
  crash durability. Native SQLite's earlier WAL settings are a separate case.
- Same logical rows; primary `id` plus secondary `type` and `timestamp` indexes.
  SQLite stores JSON text alongside indexed columns; IndexedDB stores objects,
  including Dates. SQLite's binding and byte conversion are inside write time;
  its initial JSON encoding is outside, as is source validation for all engines.
- Fixture fetch, decode/validation, JSON preparation, batch grouping, WASM load,
  engine initialization, schema creation and prepared-statement creation are
  outside the write timer. Preparation and setup are recorded separately.
- Each batch commits before the next starts. The SQLite statement is reused;
  both IndexedDB paths receive the same pre-grouped batches. Every case starts
  with an empty uniquely named database.
- After write timing, close the connection and terminate the writer worker.
  A new worker opens the persisted store, compares count and SHA-256 of every
  field, checks SQLite `quick_check` or IndexedDB Date preservation, and removes
  the test store. This tests worker-restart persistence, not browser/OS crash
  recovery, sudden power loss, or concurrent tabs.
- Read timings include SQL JSON parsing or IndexedDB structured cloning, but
  not the app's full memory projection. Diagnostic `caseWallMs` includes both
  writer and verifier fixture loading; it is not a user-facing restore estimate.
- No D1, internet transfer, authentication, pending edits, conflict checks,
  production data writes, images, schema migrations or UI updates are measured.

## What this suggests for Spaced

1. Keep Dexie for the current app while prototyping: raw IndexedDB showed no
   consistent advantage in these samples.
2. OPFS is worth testing with the actual sync adapter. Measure first-use and
   warm starts separately, include decoding and memory hydration, and test both
   Chrome and Safari plus abrupt interruption and multiple tabs.
3. Retain the main-data-first restore plan. It reduces the initial work for
   either backend and does not depend on obtaining the fastest OPFS result.

SAH-pool has concurrency tradeoffs; this single-writer benchmark does not choose
the production multi-tab architecture. See the official
[SQLite persistence guidance](https://sqlite.org/wasm/doc/trunk/persistence.md).

## Reproduction and review

From `apps/spaced2`, run `bun scripts/storage-benchmark/opfs-server.ts`, open
`http://127.0.0.1:5399/`, click **Start comparison** once and leave the page open.
The benchmark server binds only to loopback, validates Host/Origin, and serves
only fixed assets. Results contain aggregates, not card contents or account IDs.

Initial setup attempts found an oversized array-spread bug in verification and
an automatic-start/duplicate-page guard problem. Both were fixed before this
complete matrix; those attempts produced no accepted measurements. The final
page requires an explicit click. The benchmark server was stopped after all
18 cases completed; each successful case removed its own test store. Aborted
setup attempts can leave prefixed test databases on their local test origins.

Review this report, then [all samples](OPFS_STORAGE_BENCHMARK_RESULTS.json), then
`scripts/storage-benchmark/opfs-worker.ts` for timer and persistence boundaries,
and `opfs-server.ts` for fixture selection and run ordering. The SQLite dependency
is development-only; no application storage code or production deployment changed.
