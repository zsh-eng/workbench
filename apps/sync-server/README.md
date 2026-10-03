# Local shared service

Reader and Spaced can use one local Better Auth server, D1 database, and R2
bucket. Arctic is not connected. This is an opt-in development profile.

From the workspace root:

```sh
bun install --frozen-lockfile
bun run dev:shared
```

This builds shared packages, applies local migrations, and starts:

| Service               | URL                   |
| --------------------- | --------------------- |
| Reader                | http://localhost:5175 |
| Spaced                | http://localhost:5180 |
| Auth, sync, and files | http://localhost:8792 |

Use `localhost` for all three. Select **Sign in to Workbench** in Reader or create
an account in Spaced, then open the other app in the same browser.
Local registration does not send an email code. Both frontends
send authenticated requests to the shared API host using its session cookie.

D1 and R2 persist under this app's `.wrangler/`. Each frontend uses separate
shared-profile browser storage whose name includes the API origin. Existing
browser libraries and production data are not imported or deleted. Import an
EPUB or create cards to try this profile.

## Data contract

Requests use `/api/apps/reader` or `/api/apps/spaced`. The server authenticates
the user and validates the namespace. Record uniqueness, pull cursors, winner
lookups, files, and device records all use the user and namespace. Both apps can
use the same record key or file ID without changing each other's data.

Sync v3 binds local state to the server origin, user ID, namespace, and stream
epoch. Each request sends its expected scope. A changed account or epoch stops
sync and preserves local data. After a server reset, use a fresh browser profile
or an explicit export/import migration. Do not reuse an old cursor.

Files use scoped R2 paths and verified `xxh64:` IDs. Upload limits are 100 MiB for
Reader and 2 MiB for Spaced. Delete removes a file from the catalog but retains
its bytes. Physical garbage collection is not implemented.

Spaced's existing explicit sign-out action clears that browser's Spaced data.
Other tabs lose server access after the shared session is revoked. An account
change during sync fails the scope check instead of adopting the old library.

## Checks and remaining cutover work

```sh
bun run test:sync-server
bun run test:shared:e2e
bun run build:sync-server
```

Service tests exercise real Better Auth, D1, and R2 with namespace, user, file,
epoch, CORS, and logout checks. The browser test uses both real app adapters and a fresh browser context to
check shared sign-in, separate restore, EPUB/image downloads, an offline Spaced
edit followed by sync, and repeated file deletion.

The configuration contains local resource IDs and a development secret. It has
no deployment command. Existing deployment commands still use the app backends.
Fresh backups and the complete local conversion have passed. The
[rehearsal guide](MIGRATION.md) records sizes, checks, repeatable commands and
remaining cutover work. The [migration plan](../../docs/SHARED_SYNC_PLAN.md)
defines the account, namespace and local-state contracts. Production deployment
and client cutover remain separate work.
