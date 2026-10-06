# Browser bulk and point-write repeat — 3 October 2026

This repeats the browser storage test and adds single-record transactions. It
uses the same read-only 19 September snapshot: 97,266 records / 43.85 MB JSON,
or 30,215 main-data records / 9.98 MB excluding review history. No production
service, database, account or application storage code is changed.

## Results

Chrome **154.0.8037.97**, five persistent-profile rounds: **40 verified bulk
cases and 8,000 individual point transactions**. All samples, including tails,
are retained in [raw results](OPFS_POINT_WRITE_RESULTS.json).

Bulk times below are medians of five runs. Indexes remain enabled.

| Engine                    | All 97,266 records | Main 30,215 records |
| ------------------------- | -----------------: | ------------------: |
| Dexie / IndexedDB default |            7.834 s |             2.263 s |
| Raw IndexedDB default     |            8.100 s |             2.252 s |
| Raw IndexedDB strict      |            8.457 s |             2.198 s |
| SQLite WASM / OPFS FULL   |            1.357 s |             0.340 s |

OPFS reduces full-dataset write time by **5.8×** (83%, about **6.48 seconds**)
and main-data write time by **6.7×** (85%, about **1.92 seconds**) versus Dexie.
Its full-data range is 1.318–1.405 seconds; Dexie's is 7.446–8.488 seconds.
Raw IndexedDB does not materially improve bulk writes over Dexie.

Point times are **p50 / p95 in milliseconds**, pooled across 500 transactions
per engine and workload. Each insert or update plus outbox uses one atomic
transaction on the populated full dataset.

| Engine                    |      Insert |      Update | Insert + outbox | Update + outbox |
| ------------------------- | ----------: | ----------: | --------------: | --------------: |
| Dexie / IndexedDB default | 0.25 / 0.52 | 0.28 / 0.38 |     0.38 / 0.56 |     0.37 / 0.54 |
| Raw IndexedDB default     | 0.21 / 0.49 | 0.23 / 0.31 |     0.29 / 0.41 |     0.28 / 0.41 |
| Raw IndexedDB strict      | 0.69 / 1.31 | 0.66 / 1.05 |     0.78 / 1.21 |     0.99 / 1.44 |
| SQLite WASM / OPFS FULL   | 2.06 / 5.37 | 1.74 / 2.09 |     1.86 / 2.32 |     1.75 / 2.02 |

OPFS is slower for individual commits, even against strict IndexedDB. Updating
a card and its outbox entry takes 1.75 ms at p50 versus Dexie's 0.37 ms and
strict IndexedDB's 0.99 ms. The largest OPFS insert is 17.0 ms; its largest
update-plus-outbox is 2.45 ms. Dexie's corresponding maxima are 7.88 and 1.24 ms.
These are local storage timings, not input-to-next-card UI latency.

### Work outside the bulk timer

For all records, domain validation and JSON preparation still take about
**2.23 seconds**. OPFS setup takes 91–126 ms versus Dexie's 10–20 ms. The
median of each sample's preparation + setup + bulk-write sum is **3.68 seconds
for OPFS versus 10.08 seconds for Dexie**. This excludes fetch/JSON parse,
batch grouping and final in-memory application projection; it is not a
complete restore time.

The fresh-worker read and decode check takes 0.493 seconds for OPFS and
0.530 seconds for Dexie for all stored records after point writes. It excludes
hashing, outbox verification and MemoryDB construction, so it is not an app
startup benchmark. Main-data read times are 0.138 and 0.175 seconds respectively.

### Interpretation

- **Initial sync:** the bulk benefit repeats the earlier result (September
  full-write medians: Dexie 7.153 s, OPFS 1.295 s). A browser OPFS adapter is
  worth prototyping if first restore is the target. Do not subtract these
  storage timings directly from older overlapping full-sync traces.
- **Continuous sync and review edits:** no point-write speedup. Dexie is
  already sub-millisecond for these local writes. OPFS adds roughly 1.4 ms to
  the median update-plus-outbox transaction. It does not explain second-long
  review stalls. Small incoming sync batches still need separate testing.
- **Production adoption:** this measures the SAH-pool with one writer.
  Multi-tab ownership, Safari/mobile browsers, adapter conflict/outbox behavior,
  upgrades, quota failures and real end-to-end restore still need validation.
  No storage migration or production deployment was made.

All cases passed full-content, outbox and reopen verification. Temporary stores,
browser profiles and the benchmark server were removed or stopped after timing.

## Method

- Dedicated installed Chrome in headless mode. Five rounds, four configurations and
  two dataset sizes. Engine order rotates; dataset order alternates. Each round
  uses a fresh persistent disk profile. An IndexedDB marker must survive closing
  and reopening Chrome before that round starts. Every case uses a fresh worker and
  uniquely named empty database; no other benchmark runs concurrently.
- Before each case, wait until no `swift-frontend`, `swift-build` or `xcodebuild`
  process is present and one-minute host load is at most 8. Record load before
  and after each case. This reduces contention; it cannot prove an idle machine
  or eliminate scheduling, thermal, filesystem-cache and GC effects.
- Dexie 4.4.2, raw IndexedDB with default durability, raw IndexedDB with
  explicitly verified strict durability, and official SQLite WASM 3.53.4-build1 / OPFS
  SAH-pool. SQLite uses DELETE journal and synchronous FULL. IndexedDB uses the
  browser's default durability for the primary app comparison, matching the current
  app. The strict control is reported separately. These settings do not
  prove equal sudden-power-loss durability.
- Primary ID plus type/timestamp indexes remain. SQLite stores complete JSON
  rows alongside indexed columns. IndexedDB stores typed objects and Dates.
- Bulk writes use 5,000-record transactions. Fetch/JSON parse, domain validation
  and JSON preparation, engine/WASM setup and write completion are reported
  separately. Batch grouping and prepared-statement creation are outside the
  bulk timer. No final app MemoryDB rebuild or real network sync is measured.
- Full-dataset cases then run 100 transactions for each of four point workloads:
  insert, update, insert plus outbox, update plus outbox. Main-data cases measure
  bulk writes only. The point workloads reuse the open, populated database.
- Point rows are deterministic edits of 100 card-content rows sampled throughout
  the actual fixture. Inserts receive fresh IDs; updates change front text and
  the indexed timestamp. Each outbox pair commits both entries atomically.
  Point-write timing includes JSON serialization required by that backend and
  transaction completion. Fixture selection/edit construction is outside timing.
  Raw per-transaction latencies are retained, including first writes and tails.
- These outbox pairs model the storage boundary, not the complete production
  sync adapter: HLC generation, pending-version/conflict resolution, cursor
  management, networking, UI RPC and scheduling are not timed.
- After bulk plus point writes, close the connection and terminate the worker.
  A fresh worker compares the full saved dataset against the source plus expected
  mutations, checks every outbox entry, SQL indexed values/`quick_check` and
  IndexedDB Date preservation. Full cases should reopen 97,466 records and
  200 outbox entries. Main cases should reopen 30,215 records and no outbox.
  Delete each temporary store only after verification.
- Page and worker isolation headers enable the browser's higher-resolution timer.
  A fresh profile is not a guaranteed cold filesystem or cold WASM compiler cache;
  setup and individual first-case results must remain visible.

## Validation

- All 40 cases passed source/content hashes, outbox checks and reopen checks.
- All 8,000 point-transaction latencies are retained.
- `bun run test:spaced2`: 137 pass, 0 fail.
- `bun run build:spaced2`: pass. Existing bundle-size and browser-data warnings remain.
- Runner syntax and changed-file whitespace checks passed.

## Reproduce

From `apps/spaced2`, in two terminals:

```sh
bun scripts/storage-benchmark/opfs-repeat-server.ts
node scripts/storage-benchmark/opfs-repeat-runner.mjs
```

The server binds to `127.0.0.1:5403`, restricts Host/Origin and serves only the
fixture and a fixed asset allowlist. The runner claims the server once, uses
installed Chrome through pinned Playwright 1.63.0 and saves aggregate results
under `cutover.local/storage-benchmark`. Set `OPFS_REPEAT_RESULTS` to override
its output path. Stop the server afterward. The runner closes its browser on
completion or failure. Successful rounds remove only their task-created profiles.
A failed round retains its unique profile path for diagnosis.

Summarize the saved samples without running the benchmark again:

```sh
python3 scripts/storage-benchmark/opfs-repeat-summarize.py docs/OPFS_POINT_WRITE_RESULTS.json
```

The source backup and prior reports are retained unchanged. Setup failures and
waiting periods before any accepted case are not performance samples. The older
September results used Chrome 153 and a user-visible browser session; compare
engines within this repeat before comparing absolute times across those sessions.

## Non-persistent diagnostic runs

The first automated matrix used `browser.newContext()`. Playwright documents
that as [non-persistent / incognito storage](https://playwright.dev/docs/api/class-browsercontext).
Its 30 cases and six default-versus-strict controls passed worker-reopen checks,
but were unsuitable for normal disk-storage conclusions. Their low IndexedDB
write times prompted a profile-mode audit. They are retained separately in
[diagnostic samples](OPFS_INCOGNITO_DIAGNOSTICS.json), not pooled into final results.

The final runner uses `launchPersistentContext` and an IndexedDB marker across
an actual browser restart to establish disk-profile persistence. This method
correction is distinct from removing a slow sample: the entire diagnostic series
is retained and the complete comparison is rerun under the corrected mode.

## Bundle size follow-up

Measured the pinned SQLite WASM 3.53.4-build1 package with Vite 6 production
minification, using a minimal dedicated SAH-pool worker. The browser opened an
OPFS database and returned SQLite version 3.53.4. This is a runtime dependency
measurement, not a completed production-adapter bundle comparison.

All sizes below use decimal KB. Each file is compressed independently with gzip
level 9 or Brotli quality 11; deployed CDN compression may differ.

| Added asset                         |            Raw |         Gzip |       Brotli |
| ----------------------------------- | -------------: | -----------: | -----------: |
| Minified worker + SQLite JavaScript |       217.7 KB |      66.8 KB |      58.2 KB |
| SQLite WASM                         |       868.9 KB |     403.2 KB |     348.8 KB |
| **Required SAH-only total**         | **1,086.6 KB** | **470.0 KB** | **407.0 KB** |

Vite also emits a generic worker and an asynchronous proxy. Including all emitted
files, the deployment artifact grows by **1,334.6 KB raw / 546.7 KB gzip /
473.5 KB Brotli**. Default initialization requests the proxy for other backends;
its unique requested assets total 480.6 KB gzip. A second verified run uses
`?opfs-disable&opfs-wl-disable` on the dedicated worker URL to disable those
unused backends. That run requests only the worker and WASM; SAH-pool still works.
Request lists and all asset sizes are in [bundle measurements](OPFS_BUNDLE_SIZE_RESULTS.json).
The totals count unique assets, not HTTP headers or repeated proxy requests.

The current built app's JavaScript and CSS total **620.1 KB gzip / 501.9 KB
Brotli**, excluding fonts, images and service-worker code. The required SQLite
assets therefore add roughly **76% / 81%** to that asset budget if both remain.
No Dexie removal savings are assumed. Real RPC, storage-adapter and migration
code are not included in the minimal worker and will add further bytes.

Keep SQLite in a separately loaded worker. The current main build puts all
node_modules into one vendor chunk; a dynamic import alone is not enough to
assume separation. Also check Workbox precaching: emitted helper JavaScript
could be downloaded even when the runtime does not use it. Lazy loading can
keep SQLite off the first-screen path, but opening an OPFS-backed account will
still require the runtime. Cached assets avoid repeat transfer, not setup cost.

Recommendation: prototype the complete restore with this worker boundary before
migration. The measured bulk saving is large enough to justify the download
cost for evaluation. Point writes remain a few milliseconds, so their relative
slowdown is not a reason to reject the prototype. Multi-tab ownership, browser
support and end-to-end timings remain the decision gates.

Reproduce after building Spaced (the script reads its existing `dist/assets`):

```sh
bun scripts/storage-benchmark/opfs-bundle-size.mjs
```

The script needs no private snapshot. It creates a temporary build and loopback
server, checks both runtime modes in a task-owned Chrome instance, records sizes
under `cutover.local/storage-benchmark`, and removes its build/browser/server.
