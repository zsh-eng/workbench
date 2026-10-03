# Reader and Spaced migration rehearsal

The tools in `scripts/` read production backups and produce a **local** candidate
database. They do not deploy, write to Cloudflare, or change either app's active
backend. The shared server runtime still treats record values as opaque.
The local verifier imports app codecs only to check migration output.

## Verified snapshot: 3 October 2026

Fresh D1 exports and complete R2 backups are stored outside Git in a private
`shared-sync-backups.local/2026-10-03T02-38-59Z` directory in the main checkout.
The private manifests contain file locations, checksums and account mappings.
Do not commit these files, source records, credentials, or Wrangler export logs.
Export logs can contain signed download URLs.

| Source | Records | Users | Catalogued files | All backed-up R2 objects |    R2 bytes |
| ------ | ------: | ----: | ---------------: | -----------------------: | ----------: |
| Reader |   1,090 |     1 |               78 |                      118 | 279,704,335 |
| Spaced | 101,168 |   265 |              634 |                      634 | 137,784,318 |

SQL exports total 81,467,385 bytes. The local imported source databases total
87,048,192 bytes. All 752 R2 objects total 417,488,653 bytes (417.5 MB).
The 712 catalogued objects selected for migration total 319,572,446 bytes.
The backup also retains 40 older Reader objects outside the current catalog.

The rehearsal verified:

- One exact Google provider-subject match merges the two source users into the
  existing Reader user ID. The target retains 265 users; no user data is filtered.
- All 102,258 records decode through the actual app codecs. Source/target checks
  preserve record keys, schema versions, HLCs, device IDs and 17 tombstones.
- All 712 selected files match their size, SHA-256 and existing xxh64 content ID.
  There are no missing file references. R2 inventories were unchanged across
  download; this does not replace a write freeze across both services.
- 852 relative image URLs in 821 Spaced records become URLs at the proposed shared
  origin. All other record values are unchanged, including FSRS state and reviews.
- Sessions, verification codes and OAuth tokens are not copied. Provider identities
  and password hashes are retained. Sign-in on the new service must be fresh.
- Repeating conversion produces the same report and record fingerprint. Importing
  the complete SQL dump into another local SQLite database reproduces every table.

The candidate `shared.sqlite` is 90,124,288 bytes. It uses the proposed origin
`https://api.zsheng.app`; that origin has not been deployed. The Worker domain list
has no matching entry and DNS did not resolve during preflight. The current token
could not list zone DNS records (403), so domain configuration is not fully checked.

The complete candidate was then loaded into isolated local Worker bindings using
71 resumable import batches. Every imported row matched the candidate; all 712
R2 objects matched their SHA-256 hashes. A fresh Chromium profile restored all
1,090 Reader records and the account's 98,623 Spaced records (30,215 operations and
68,408 review operations). EPUB and image downloads, an offline edit, reconnect
and outbox drain passed. The existing synthetic cross-app browser test also passed.
Other users remain in the target but are not exposed to this signed-in account.

Browser checks use a disposable credential added only to the isolated local copy.
They alias the proposed production image host to the local Worker. They are not
proof of production Google OAuth, DNS, Safari or installed-PWA behavior. Private
production-data tests disable traces, screenshots and video.

## Repeat the procedure

Use Python 3.11 or newer, Bun, installed workspace dependencies, and an authenticated
Wrangler account. Run commands from the workspace root. Use a new private backup
directory each time; do not use a tracked folder. D1 exports are read-only but
can affect availability briefly. Schedule the final export within the cutover window.

```sh
python3 apps/sync-server/scripts/backup-d1.py --backup-dir /private/path/new-snapshot
python3 apps/sync-server/scripts/backup-r2.py --backup-dir /private/path/new-snapshot
python3 apps/sync-server/scripts/rehearse-migration.py \
  --backup-dir /private/path/new-snapshot \
  --output-dir /private/path/new-rehearsal \
  --origin https://api.zsheng.app
bun --tsconfig-override apps/reader/tsconfig.app.json \
  apps/sync-server/scripts/verify-rehearsal.ts /private/path/new-rehearsal
python3 -m unittest discover -s apps/sync-server/scripts -p 'test_*.py' -v
```

`backup-d1.py` runs each app's installed Wrangler version. It keeps command output
private, imports the SQL locally, and checks integrity, foreign keys and hashes.
It refuses an existing backup directory. A partial D1 export requires a new directory.

`backup-r2.py` lists and downloads all objects with four workers. It can resume
from verified progress or skip a complete app backup. It refuses a changed R2
inventory and verifies sizes and SHA-256. If the source changes, start a new
complete snapshot. These scripts do not freeze production writes.

The converter refuses output replacement, unmatched email collisions, conflicting
password hashes, corrupt backup files and missing referenced files. Accounts merge
only on exact non-credential provider subjects, never email alone. It creates new
server sequences and snapshot-specific epochs; old device catalog rows are not
copied, but record device IDs are preserved. Devices register again on use.

Outputs include the candidate SQLite database, complete SQL dump, account map,
file-copy manifest and sanitized summary. Treat every output as private.
The file manifest refers to the original backup bytes; keep those backups in place.
The converter's `productionReady` flag stays false by design.

**`seed.sql` is a complete SQLite schema and data dump, not a production D1 import
script.** It is verified by importing into an empty local SQLite database. Do not
apply it on top of D1 migrations. A production importer still needs to handle D1
transaction syntax, schema migration bookkeeping and verified target loading.

## Import tools

`prepare-import.py` writes bounded data-only SQL and 50-object upload batches.
Apply target migrations first; never import the full SQLite `seed.sql` into D1.
The runner applies the migrations, requires an empty database on its first run,
and writes a target-specific progress receipt. SQL uses `INSERT OR IGNORE` so an
uncertain batch can be replayed without replacing an existing record. Verification
must compare every row afterward; ignored conflicts are not accepted as success.
The runner refuses the old Reader, Spaced and Arctic resource names/IDs.

```sh
python3 apps/sync-server/scripts/prepare-import.py \
  --rehearsal /private/path/rehearsal --output /private/path/import
python3 apps/sync-server/scripts/run-import.py \
  --plan /private/path/import/import-plan.json \
  --config /private/path/local-worker.json \
  --database workbench-sync-local --bucket workbench-sync-local \
  --persist-to /private/path/isolated-worker-state
bun apps/sync-server/scripts/verify-local-import.ts \
  /private/path/import/import-plan.json /private/path/local-worker.json \
  /private/path/isolated-worker-state
```

Use strict JSON for the config passed to the runner. Its local `main` and
`migrations_dir` must point at this service's source and migrations. The local
verification uses Wrangler's supported binding proxy with remote bindings disabled.
For a browser rehearsal, run `prepare-browser-rehearsal.ts` with the rehearsal,
local config and state directory, then set `SHARED_WORKER_CONFIG`,
`SHARED_PERSIST_TO`, and `SHARED_REHEARSAL_FIXTURE` (the generated
`browser-fixture.json`) when running `bun run test:shared:e2e`.
Use an isolated target: browser tests add sessions, devices and fixture records.

`production-config.py --database-id <new-D1-UUID> --output <private-config.json>`
generates a **closed** target named `workbench-sync` with the proposed API domain.
Create its new D1 database and R2 bucket separately; this script creates neither.
Set a fresh `BETTER_AUTH_SECRET` and Reader's `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET` through Wrangler secrets. No production secret belongs in
this config. `MIGRATION_MODE=closed` returns 503 for all routes except health.
The config was checked with the service's pinned Wrangler deployment dry run;
no production resource has been created or deployed.

For the final remote import, use the runner's `--remote-new-target` instead of
`--persist-to`. It requires the closed production config. Keep that Worker closed
and run the read-only `verify-remote-import.py --plan <plan.json> --config
<private-config.json> --output <new-private-verification-directory>`. It exports
target D1, compares all tables, and downloads each selected R2 object to verify its
SHA-256. Remote execution remains untested; the same SQL/upload batches passed
against the local Worker. Do not mark an import verified from upload progress alone.

Run Wrangler from `apps/sync-server` so it uses that app's pinned version. Root
`bunx wrangler` can select an unrelated older installation.

## Auth and browser transition

The shared service accepts Spaced's legacy PBKDF2 passwords. All three affected
accounts are verified; production still requires verified email and does not allow
new password registrations. A real production-mode sign-in test verifies the
migrated hash, rejects wrong passwords, and rejects an unverified account.
No password reset or credential replacement is needed for those accounts.

The shared login shows Google when configured, and GitHub only when both GitHub
client secrets are set. The 94 GitHub identities remain in the imported account
store. GitHub was already disabled in the current Spaced server; it is not enabled
without explicit provider configuration. Preserve these identities for later use.

The current transition uses fresh browser stores whose names include the shared
API origin, as allowed for the server restore. Old databases and outboxes remain
intact. There is **no automatic replay of old unsynced edits** into the new scope.
Before cutover, drain sync/uploads on every active browser and finish or export
local note drafts. Run `scripts/browser-cutover-preflight.js` in each old app's
browser console: it reports pending counts without reading record contents or
changing IndexedDB. Any nonzero count blocks that device's cutover. Do not clear
browser storage to silence the check. Offline or unaccounted-for devices require
an explicit pending-data recovery before retiring the old backend.

## Remaining production steps, in order

1. Confirm the Google callback
   `https://api.zsheng.app/api/auth/callback/google` is added to Reader's OAuth
   client. Keep existing callbacks. Confirm every active device has drained its
   outbox/uploads and that any local drafts are preserved.
2. Create the new target D1/R2 resources, generate the closed config, set secrets,
   and check production DNS/custom-domain configuration. The earlier zone DNS
   inspection was denied by the current token (403). Keep app auth/CORS origins exact.
3. Deploy the old app Workers with `SYNC_CUTOVER_MODE=freeze`. The tested gate
   returns 503 for record pushes and file PUT/DELETE only. Reads and auth remain
   available, including Arctic's independent Reader routes. Freeze edits during
   final export/import. No cutover flag has been enabled in production yet.
4. Make fresh final D1/R2 backups, convert and prepare a new import plan. Import
   into the empty closed target and verify all rows and files. Earlier snapshots
   are rehearsal evidence, not permission to discard newer writes.
5. Remove the target's closed mode only after verification. Check real Google
   login and restore on the target; use the local opt-in clients first if needed.
   Verify Safari and installed PWAs before publishing the client switch.
6. Build/release both frontends with `VITE_SHARED_API_URL=https://api.zsheng.app`.
   Require a fresh sign-in and restore into the new scoped browser stores. Keep
   old app data gates at `SYNC_CUTOVER_MODE=retired` (410), so old clients cannot
   write to an independent backend. Check an old-client reconnect and new offline
   edits. Keep Reader's Arctic/auth routes available.
7. Retain old stores and backups. Before target writes, rollback can remove the
   freeze and keep the old frontends. After target writes, rollback requires a
   freeze and reconciliation of new changes; switching URLs alone loses work.
   Resource deletion and Arctic migration remain separate.

See the [shared service plan](../../docs/SHARED_SYNC_PLAN.md) for the full contract.
