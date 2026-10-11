# Dormant native journal performance

The app does **not** use this repository yet. These measurements describe the
staged sync code, not current Arctic UI latency. Live persistence migration
remains a separate approval and validation step.

## Reproduce

Run from the repository root:

```sh
python3 apps/arctic/Tests/check-article-sync.py
python3 apps/arctic/Tests/check-article-sync.py --configuration release --performance
python3 apps/arctic/Tests/check-article-sync.py --performance
swift test --package-path apps/arctic/Sync --scratch-path /tmp/arctic-sync-build
```

The runner compiles the production model and repository with the local sync
package. Performance fixtures contain 1,000 or 10,000 generated articles with
fixed dates, a title, a short description and two tags. There is no network,
authentication or user-library access. Each mutation timing below is the median
of three archive-toggle edits in one process. These are indicative Mac results;
iPhone measurements remain required before activation.

## Measured 2026-10-10: SQLite journal

Apple M1 Pro, macOS 27.0.1, SwiftPM debug/release builds. Milliseconds:

| Build | Articles | Full-library transaction | One-article transaction, full import outbox | One-article transaction, empty outbox |
| --- | ---: | ---: | ---: | ---: |
| Release | 1,000 | 144 | 1.3 | 0.6 |
| Release | 10,000 | 1,489 | 7.4 | 5.6 |
| Debug | 1,000 | 370 | 1.6 | 3.8 |
| Debug | 10,000 | 3,342 | 14.8 | 5.0 |

The full outbox contains three pending records per article. An empty-outbox
fixture imports the same articles and then acknowledges every upload through an
in-process remote. Its database is 2.49 MB at 1,000 articles and 24.6 MB at
10,000. SQLite keeps the free pages of a cleared outbox and reuses them for later
writes.

Release-mode phase checks for 10,000 articles:

| Operation | Time |
| --- | ---: |
| Project the entire journal into articles | 384 ms |
| Canonicalize and hash every article URL | 28 ms |
| Build the full-library edit transaction | 798 ms |
| Project one article | 0.09 ms |
| Build one article's transaction | 0.12 ms |
| Import 30,000 records and outbox entries in one transaction | 463 ms |
| Reopen the profile and validate every record | 587 ms |

Phase checks are separate operations, not additive trace spans. Full transaction
work includes projection and comparison.

The 2026-09-20 JSON journal took 320 ms for the same 10,000-article edit with a
full outbox, and 179 ms with an empty outbox. Encoding the whole snapshot for
each change caused that cost.

## Storage

`SyncStore(database:accountID:)` keeps one SQLite file in each profile folder.
The account actor owns the only connection and does no network work inside a
transaction. The file uses WAL with `synchronous=FULL`.

| Table | Contents |
| --- | --- |
| `records` | Each key's current value, deletion flag, schema version, HLC, device ID and server sequence |
| `outbox` | Each pending key and the version to upload; the payload is its record |
| `local_values` | Private share receipts and cache markers by article identity |
| `state` | Account identity, device ID, HLC and pull cursor |

Each step names the keys it can change. A one-article edit, a pull page or an
upload acknowledgement then writes only those rows, in one `BEGIN IMMEDIATE`
transaction with the clock and cursor. A failed write rolls back and leaves the
actor's state unchanged. A batch import is one transaction. A missing `state`
row means that no transaction committed, so an interrupted migration can run
again. The same store tests run against the JSON trial journal and SQLite.

`ArticleSyncRepository.editArticle(at:_:)` reads only the URL's article, library
and tags records plus its local receipt/cache value. It applies the callback in
the same `SyncStore.transaction` that persists the domain values and outbox.
It returns one article instead of rebuilding and sorting the whole library.
Imports retain the batch transaction API.

Only semantically changed record families become local edits. Different JSON
field order on a remote record does not turn an archive action into a metadata
or tags edit. Deletion creates tombstones. Canonical URL changes are rejected.
The journal also skips unchanged writes while retaining the first empty write
as the completed-migration marker.

This meets the 50 ms Mac release target at 10,000 articles. The remaining cost
of a one-article edit is the actor's in-memory copy of the journal. Measure
actual iPhone interactions before activation. Do not add a second, best-effort
outbox beside the domain store.
