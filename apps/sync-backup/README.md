# Workbench Backup CLI

A read-only sync client for Reader and Spaced. Uses Bun's native SQLite, HTTP,
crypto and xxHash. Its only runtime package is the existing workspace
`@zsh-eng/local-sync` (including its protocol validator). No ORM or new UI.

From the workspace root:

```sh
bun run wb auth login
bun run wb sync
bun run wb tree
bun run wb status
bun run wb db path
bun run wb db schema --table records
bun run wb snapshot create
bun run wb snapshot list
bun run wb snapshot verify <id>
```

Use `bun run wb --help` for all commands. Every command accepts `--json`.
Progress and errors use stderr; results use stdout. Failures return nonzero.
Each sync is one-shot. On macOS, launchd can run it periodically.

## Login and permissions

`auth login` prints a code and opens `https://api.zsheng.app/device`. Sign in
with Google, enter the code and approve read-only access. `--no-browser` leaves
browser opening to you. Credentials expire after 90 days; sign in again when
needed. `auth logout` revokes the current CLI credential and keeps local data.
Browser sign-out does not revoke this independent CLI credential.

This is a first-party device-code flow, not a general OAuth authorization
server. Device grants expire after ten minutes, can be approved/exchanged once,
and are polled at five-second intervals. The server hashes credentials, rate
limits grant/approval requests, requires same-origin browser approval, and
checks token expiry on every API request. Tokens cannot push records, change
files, list browser sessions, or access another account. Authentication resolves
the user ID. There are no production database credentials in the client.

On macOS, credentials live in Keychain, keyed by API origin. On other platforms
they use a mode-0600 credential file in the private data directory. No silent
Keychain-to-file fallback occurs. Login codes are shown, credentials are not.

## Local state and selections

Default macOS data directory:
`~/Library/Application Support/Workbench Backup/` (outside Git). Use
`--data-dir` for an independent mirror, and `--origin` for a local test service.

- `mirror.sqlite`: opaque records, scopes, selection cursors, files and run times.
- `objects/<sha256>`: verified file bytes, retained after remote deletion.
- `snapshots/<timestamp-id>`: standalone SQLite database, objects and manifest.

Directories are private. Keep the directory on an encrypted disk and back it up
to another device if machine-loss recovery matters. No automatic pruning occurs.

```sh
bun run wb sync --namespace reader
bun run wb sync --namespace spaced --table operations --records-only
bun run wb sync --namespace reader --table books --table notes
bun run wb table list --namespace reader
bun run wb export --output /private/new-export-directory
```

Each table selection has its own cursor. The API only filters namespaces, so
table sync still scans that namespace's records, retaining selected tables.
A later full sync cannot skip excluded tables. Older overlapping selections
cannot overwrite newer rows. Files are all active catalog entries in the selected
namespace unless `--records-only` is passed; table selection does not restrict
file downloads. Unknown domain tables/versions remain valid opaque backups.

Scope includes API origin, authenticated user, namespace and stream epoch.
Changes refuse reuse of an existing mirror; choose a new data directory.
Records and cursors commit together, in batches of up to approximately 5,000
records or 8 MiB, also flushing at bounded HTTP stream boundaries. SQLite uses
WAL, synchronous FULL, prepared UPSERTs and indexes. A separate SQLite lease prevents
concurrent CLI mutation; the operating system releases it when a process exits
or crashes. Interrupted runs resume from the last committed cursor.

`tree`, `namespace list` and `table list` use **local** counts, including
tombstones, and do not contact the server. Domain table names (`books`) are
encoded in record keys; physical SQLite tables (`records`) are separate.
`status` shows coverage, cursors and last successful pulls/catalog scans.

## Hourly sync on macOS

```sh
bun run wb schedule install
bun run wb schedule status
bun run wb schedule uninstall
```

Install runs a full sync immediately, then every hour while logged in and awake,
and at subsequent logins. The user LaunchAgent uses absolute Bun and CLI paths,
the chosen `--origin` and `--data-dir`, and the existing Keychain credential.
Reinstall after moving the checkout or Bun. One schedule is supported per macOS
user; install refuses to replace an existing schedule. No credentials enter the
plist. Uninstall stops the job and preserves data and logs.

`status` reports launchd's last exit code and actual log paths. Logs are under
`<data-dir>/logs/`. A locked Keychain, expired login or network failure makes that
run fail; the next hourly run retries. After credential expiry, run `auth login`
again. Manual and scheduled sync share the same writer lock. If another writer
is active, the new run fails safely and can be retried later. Scheduling only
updates the mirror; use `snapshot create` to retain dated recovery points.

## Browsing and recovery

Open `mirror.sqlite` in a SQLite viewer with a read-only connection to browse
the current mirror while sync runs. Refresh the viewer after a sync. For a fixed
recovery point, open a snapshot's `records.sqlite` read-only instead. Basic views
include `live_records`, `table_counts`, `reader_books`, and `spaced_operations`.
Spaced operations are not a reconstructed card/deck model. Values and record
versions remain unmodified. There is no outbox or outbound change processing.

`snapshot create` uses SQLite `VACUUM INTO`, copies downloaded objects (using
copy-on-write where available), verifies SQLite integrity and every SHA-256 and
xxHash ID, then publishes a dated directory. `export` creates the same portable
format at a chosen new destination. No credentials enter snapshots. A failed
snapshot remains a `.partial` directory for diagnosis. Do not use a raw copy of
an active WAL database as a backup.

Snapshots preserve locally observed states. Server records contain current
winners, not every edit. A pull head bounds traversal, not a historical server
snapshot. Records and files are not captured atomically across namespaces.
Files deleted before the first capture, uncatalogued objects, external resources,
and unsynced device data cannot be recovered through this API.

Coverage `complete` means both namespaces have a completed full pull and catalog
scan, with known active/referenced xxh64 objects present. This is **not** a claim
that external URLs or all domain references were resolved. The reference scan is
conservative; unsupported keys and missing xxh64 IDs are reported. Cached bytes
are checked on initial download and during snapshot verification.

To restore offline, verify the snapshot, open its SQLite database, and use its
manifest to locate objects. The lossless raw data is available for future
app-specific imports. There is deliberately no remote restore command: restoring
old clocks can lose to current tombstones, while new clocks overwrite live data.

## Validation and timings

```sh
bun run test:sync-backup
bun run --cwd apps/sync-backup test:e2e
bun run --cwd apps/sync-server test -- --maxWorkers=1 --testTimeout=60000
bun run build:sync-server
bun apps/sync-backup/test/benchmark.ts /private/path/mirror.sqlite
```

The benchmark opens the source read-only and uses disposable disk databases.
Three rotated rounds compare 500, 5,000 and 20,000-record transactions with FULL
durability and indexes. Every case checks complete row equality and integrity.
These are SQLite-only times; sync commands separately report record-pull time,
SQLite commit time, file-transfer time and total elapsed time. Preparation and
network costs must not be inferred from storage-only results.

`test/run-local-e2e.ts` creates its own local Worker config, database, bucket and
free port, applies local migrations, and runs the browser/CLI fixture. It uses
the existing sync-server Playwright dev dependency. It removes its temporary
state and closes its server/browser afterward. The fixture creates only synthetic
local data, deletes its mirror, and revokes its credential. Production origins
are rejected by the fixture.

Review: this guide, `src/cli.ts`, `src/sync.ts`, `src/store.ts`,
`src/snapshot.ts`, `src/auth.ts`, then the sync-server device-auth routes/tests.

See [verified live timings](BENCHMARKS.md) for measured results.
