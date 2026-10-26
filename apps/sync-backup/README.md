# Workbench Backup CLI

A read-only sync client for Reader, Spaced and Arctic, and one domain command
that saves links to Arctic (`wb arctic save`). Uses Bun's native SQLite, HTTP,
crypto and xxHash. Its runtime packages are the workspace `@zsh-eng/local-sync`
(including its protocol validator) and `@workbench/arctic-links` (Arctic's link
records). `wb arctic` loads Arctic's extractor from `apps/arctic/Browser` only
when it reads a page. No ORM or new UI.

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
bun run wb arctic save https://example.com/article
```

Use `bun run wb --help` for all commands. Every command accepts `--json`.
Progress and errors use stderr; results use stdout. Failures return nonzero.
Each sync is one-shot. On macOS, launchd can run it periodically.

## Login and permissions

`auth login` prints a code and opens `https://api.zsheng.app/device`. Sign in
with Google, enter the code and approve access. `--no-browser` leaves
browser opening to you. Credentials expire after 90 days; sign in again when
needed. `auth logout` revokes the current CLI credential and keeps local data.
Browser sign-out does not revoke this independent CLI credential.

`wb sync` only downloads. The credential may write two things, and the server
checks both: Arctic article text (`arctic-content`), which `wb arctic` and
`apps/arctic/Browser/scripts/upload.ts` upload, and Arctic links: a new link in
the phone's three records, or a link from History saved again. It cannot
change or remove any other record.

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

## Saving links to Arctic

```sh
bun run wb arctic save https://example.com/article https://news.example/story
pbpaste | bun run wb arctic save            # links on stdin, any whitespace
bun run wb arctic save --no-text <url>      # save only
bun run wb arctic save --unwall <url>       # paywalled sites through Unwall
bun run wb arctic text <url>                # text for a link already saved
```

`arctic save` reads the account's `arctic` and `arctic-content` records, then
handles each link in turn, as Arctic for the web and the phone do:

- A new link gets the phone's three records (`article/<id>`, `library/<id>`,
  `tags/<id>`) for its canonical URL, from `@workbench/arctic-links`: the same
  bytes as the web's, but for the title and the time. The title is the page's
  own; with `--no-text`, or when there is no page to read (a PDF), it is
  empty, and the phone fills in the title, image and topics when it next opens.
- A link in History is saved again: its library record alone changes (saved,
  not archived, saved now), as a field edit. Nothing else about it changes.
- A link already saved (or archived) is reported and left alone.

Then it fetches the text with Arctic's extractor (`server/extractor.ts`, the
same Defuddle extraction as `scripts/copies.ts`) and uploads the copy by the
Article text page's rules: at least 120 words, at most 2 MiB, no scripts, and
it replaces a copy only when it is 30% longer. A link that already has text is
not read again; `arctic text` reads it again and applies the 30% rule. A site
on the phone's Unwall list, or a page that marks itself not free
(`isAccessibleForFree`), needs 400 words: less is its paywall preview.
`--unwall` reads such sites through unwall.app, as the phone opens them.
Reading a page that needs a browser uses Playwright's Chromium:
`bun run --cwd apps/arctic/Browser browser:install`.

Each link prints one line as it finishes; `--json` prints an array of results
(`status`, `url`, `id`, `title`, `text`, `words`, `reason`, `error`).

```text
saved          https://example.com/article · text: 2,140 words
restored       https://example.com/polar-night · text: has text (1,312 words)
already saved  https://example.com/older · text: has text (980 words)
saved          https://www.nytimes.com/… · no text: paywall preview (210 words)
saved          https://arxiv.org/pdf/1706.03762 · no text: PDF
invalid        "not a link" · not a web address
```

A link that is not a web address, a refused write or a network error makes
the command exit with 1; a page without text does not. The command uses a
transport that allows only the requests it needs (`src/arctic.ts`). An older
server that does not allow link saves answers "this server does not let wb
save links yet". On a loopback `--origin`, `WORKBENCH_TOKEN` replaces the
Keychain credential, for tests against a local API.

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

Native Arctic backs up records only: its Reader copies and images stay on each
device, and the server has no file API for them. The article text that Arctic's
web app reads is the `arctic-content` namespace, records and files; highlights
and notes are `arctic-annotations`, and reading sessions `arctic-reading`
(records only). Its keys are `article/<id>`, `library/<id>`
and `tags/<id>`, so its tables are `article`, `library` and `tags`. Arctic is
synced once the server lists it; after that, coverage requires it.

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
include `live_records`, `table_counts`, `reader_books`, `spaced_operations` and
`arctic_articles` (URL, title, library state, saved date and tag names).
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

Coverage `complete` means Reader and Spaced have a completed full pull and catalog
scan, every other synced namespace (Arctic) has a completed full pull, and known
active/referenced xxh64 objects are present. This is **not** a claim
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
bun run --cwd apps/sync-server test -- test/cli-links.test.ts
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

`test/arctic.test.ts` runs `wb arctic` against a small fake API and checks
every request it sends. `apps/arctic/Browser/tests/cli.spec.ts` runs it against
the local shared API and compares its records with the web's.

Review: this guide, `src/cli.ts`, `src/sync.ts`, `src/store.ts`,
`src/snapshot.ts`, `src/auth.ts`, `src/arctic.ts`, then the sync-server
device-auth routes/tests and `src/cli-links.ts`.

See [verified live timings](BENCHMARKS.md) for measured results.
