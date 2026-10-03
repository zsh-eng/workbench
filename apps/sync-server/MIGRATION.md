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

This proves local data conversion. The previous synthetic browser test proved
cross-app login and restoration on the local service. A fresh-browser restore of
this complete private production dataset through the shared Worker remains open.

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

## Remaining cutover work, in order

1. Prepare the production Worker configuration, separate target D1/R2 resources,
   resumable upload/import tools, and manifest checks. Keep current stores intact.
   The local service configuration must not be deployed as-is.
2. Resolve auth compatibility. The snapshot retains 169 Google, 94 GitHub and three
   credential identities. All three passwords use Spaced's legacy PBKDF2 format.
   The local shared server supports Google and its normal password verifier; it
   cannot yet authenticate those legacy passwords or GitHub identities. Choose a
   tested legacy verifier/reset flow and provider policy before switching clients.
3. Reuse Reader's Google client configuration, set a new shared signing secret, and
   add `https://api.zsheng.app/api/auth/callback/google` to that Google OAuth client.
   Keep the existing callbacks during verification. Configure exact production
   app origins for auth and CORS, then test Safari and installed web apps.
4. Implement old-client write gates and an explicit local-storage transition.
   Drain sync and uploads on active clients; preserve and account for pending
   outboxes before any reset. The current opt-in profile opens separate browser
   stores; it does not migrate pending edits from existing stores.
5. Freeze old Reader/Spaced record and file writes, then make fresh final backups.
   Do not disable all Reader APIs: Arctic still depends on Reader auth and routes.
   Convert again using the final API origin and verify every imported row and file.
6. Restore both apps from a fresh browser. Check Reader books/positions/highlights,
   Spaced cards/reviews/images/due dates, offline edits, and old-client reconnects.
   Switch web clients only after these checks pass.
7. Keep backups and old stores for rollback. Once shared-server writes begin,
   rollback requires freezing and reconciling those new writes; switching URLs
   alone would lose changes. Resource deletion and Arctic migration are separate.

See the [shared service plan](../../docs/SHARED_SYNC_PLAN.md) for the full contract.
