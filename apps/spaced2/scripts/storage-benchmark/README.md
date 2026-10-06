# Local storage comparisons

These scripts read the private converted snapshot at
`cutover.local/converted/backend.sqlite`. Run from `apps/spaced2`. They never
contact production. Measurements contain no card content or account identifiers.

## Native SQLite

```sh
bun scripts/storage-benchmark/sqlite.ts
```

Uses temporary disk files and checks all stored content before deleting them.
See `docs/SQLITE_STORAGE_BENCHMARK.md` for completed measurements and limits.

## Browser SQLite OPFS versus IndexedDB

```sh
bun scripts/storage-benchmark/opfs-server.ts
```

Open `http://127.0.0.1:5399/` once and leave that tab open. The benchmark starts
when you click **Start comparison**. The server rejects a second runner to avoid overlapping work.
Stop the server after the page reports completion. Do not run two copies or
unrelated heavy builds concurrently.

The 18-case matrix rotates three engines and two datasets over three rounds:

- Dexie bulkPut with the browser's default transaction durability.
- Native IndexedDB put calls in the same transaction groups, default durability.
- Official SQLite WASM 3.53.4-build1 with OPFS SAH-pool, rollback journal DELETE
  and synchronous FULL. This adapter prioritizes performance over multi-tab access.

Each uses 5,000-record transactions and primary id plus type/timestamp indexes.
All engines execute in dedicated workers. Each writer receives the same source
rows and validates them with the current Spaced codec before timing starts.
SQLite receives JSON strings plus indexed columns; IndexedDB receives objects.
Fixture fetch, validation, JSON encoding, batch grouping, engine initialization,
and schema creation are excluded from write timing and initialization/preparation
are reported separately. The write timer includes transaction completion.

After writing, the connection closes and the worker terminates. A fresh worker
reopens the same store, checks record count and SHA-256 of every row, and checks
SQLite integrity or IndexedDB Date preservation. Only then is a result accepted.
Successful verification deletes the temporary store. This verifies persistence
across worker recreation, not power-loss recovery or cross-tab correctness.

The loopback server accepts only its own Host/Origin and serves a fixed asset
allowlist. SQLite assets come from the pinned local development dependency.
Aggregate results use unique filenames under `cutover.local/storage-benchmark`.
The page and server show per-case progress. A failed or timed-out run may leave
its uniquely named `SpacedOPFSBench-*` test store for diagnosis; no application
store shares this origin or prefix.

A native SQLite speedup is not a browser speedup. Compare the fresh browser
measurements with each other; treat earlier native measurements as context.
No network, remote D1, outbox/conflict handling, or MemoryDB rebuild is measured.
