# Shared sync service

Reader and Spaced use one production Better Auth server, D1 database, and R2
bucket at `https://api.zsheng.app`. Arctic native auth and the `arctic` namespace
are implemented locally; they have not been deployed or connected to its live library. The production
cutover completed on 4 October 2026; see [migration evidence](MIGRATION.md).

## Local development

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

Use `localhost` for all three. Create a local account in Spaced or at
`http://localhost:8792/login?returnTo=http://localhost:5175`, then open the other
app in the same browser. In production, each app's Google button goes straight to
Google and returns through the shared callback without an intermediate login page.
Local registration does not send an email code. Both frontends
send authenticated requests to the shared API host using its session cookie.

D1 and R2 persist under this app's `.wrangler/`. Each frontend uses separate
shared-profile browser storage whose name includes the API origin. Existing
browser libraries and production data are not imported or deleted. Import an
EPUB or create cards to try this profile.

## Data contract

Requests use `/api/apps/reader`, `/api/apps/spaced`, or `/api/apps/arctic`. The server authenticates
the user and validates the namespace. Record uniqueness, pull cursors, winner
lookups, files, and device records all use the user and namespace. Both apps can
use the same record key or file ID without changing each other's data.

Sync v3 binds local state to the server origin, user ID, namespace, and stream
epoch. Each request sends its expected scope. A changed account or epoch stops
sync and preserves local data. After a server reset, use a fresh browser profile
or an explicit export/import migration. Do not reuse an old cursor.

Files use scoped R2 paths and verified `xxh64:` IDs. Upload limits are 100 MiB for
Reader and 2 MiB for Spaced. Delete removes a file from the catalog but retains
its bytes. Physical garbage collection is not implemented. Arctic file routes
return 404: native media sync is outside this milestone.

Spaced's existing explicit sign-out action clears that browser's Spaced data.
Other tabs lose server access after the shared session is revoked. An account
change during sync fails the scope check instead of adopting the old library.

## Checks and deployment

```sh
bun run test:sync-server
bun run test:shared:e2e
bun run build:sync-server
```

Service tests exercise real Better Auth, D1, and R2 with namespace, user, file,
epoch, CORS, and logout checks. The browser test uses both real app adapters and a fresh browser context to
check shared sign-in, separate restore, EPUB/image downloads, an offline Spaced
edit followed by sync, and repeated file deletion.

`wrangler.jsonc` contains local resource IDs and a development secret. Production
uses `wrangler.production.jsonc` and secrets stored on the Worker. Deploy with
`bun run deploy:sync` from the workspace root. Deploy the Reader and Spaced
frontends separately with their owning app commands.

The production defaults in both clients select the shared API. An explicit empty
`VITE_SHARED_API_URL` selects the legacy profile for recovery tooling; it must not
be used for a normal release. Old app Workers return 410 for legacy record and
file writes. Their old databases and buckets remain available for recovery.
Reader's independent Arctic/auth routes remain available.

The [migration guide](MIGRATION.md) records backup sizes, full remote verification,
and repeatable commands. The [design](../../docs/SHARED_SYNC_PLAN.md) defines the
account, namespace, and local-state contracts. Fresh sign-in and restore are
required after the client switch; old local stores are preserved, but old outboxes
are not replayed automatically. Production Google sign-in completion, Safari,
and installed-PWA restore remain manual checks until recorded there.

## Arctic native sign-in (local implementation)

`/api/arctic/auth/start`, `/finish`, and `/exchange` reuse the native PKCE
handoff in `packages/arctic-sync-server`. The wrapper selects the shared
`__Secure-workbench.session_token` cookie; legacy Reader-hosted auth retains its
old cookie name. Google returns to `/api/auth/callback/google`, then the native
flow returns a 60-second, one-use code to `articles://auth/callback`.

Migration `0003_native_auth.sql` adds only flow/code tables and expiry indexes.
It does not change accounts, existing streams, or existing records. Apply it
before deploying these routes. No remote migration or deployment was performed
for this implementation. The device trial is documented in
[Arctic sync design](../arctic/SYNC_DESIGN.md#native-trial-checklist).

`test/native-auth.test.ts` runs real Better Auth and D1 locally. It checks the
Google authorization URL, browser-bound finish, wrong verifier, one-use exchange,
expiry, revocation, session renewal, scoped push/pull, and disabled media routes.
Google's external login UI and native device handoff still require a device test.

## Read-only backup CLI

[Workbench Backup](../sync-backup/README.md) signs in through `/device` and
`/api/cli/{device,approve,token,revoke}`. Migration `0004_cli_auth.sql` adds
short-lived device grants, hashed 90-day read-only credentials, and rate limits.
CLI credentials resolve the authenticated user and are restricted to Reader and
Spaced state/pull/file reads plus `/api/me` and `/api/namespaces`. They cannot
push, upload, delete, or inspect browser sessions. The browser approval requires
an authenticated session, same-origin POST, and an explicit code confirmation.
No Google credentials or browser cookies are transferred to the CLI.

The CLI addition was deployed on 4 October 2026 without the pending Arctic native
migration/runtime changes. See [validation and timings](../sync-backup/BENCHMARKS.md).
