# @zsh-eng/local-sync

Local-first record sync extracted from the Reader's sync v2 implementation.
The core has no application, React, Dexie, or browser-storage imports. Each
client receives its own storage adapter, transport, and durable state store.

## Entry points

| Import                      | Responsibility                                   | Additional peers              |
| --------------------------- | ------------------------------------------------ | ----------------------------- |
| `@zsh-eng/local-sync`       | Protocol, clock, state store, sync engine        | None                          |
| `@zsh-eng/local-sync/dexie` | Local mutation capture and atomic reconciliation | `dexie`                       |
| `@zsh-eng/local-sync/hono`  | Authenticated routes and compacted D1 storage    | `hono`, `@hono/zod-validator` |
| `@zsh-eng/local-sync/react` | Status and sync history hooks                    | `react`                       |

The package depends on Zod. Adapter peers are optional for consumers that use
only the core. The package ships ESM JavaScript and TypeScript declarations.

## Sync status

`createSyncController` decides when sync runs and keeps a status store
(`subscribe`, `getSnapshot`) with three separate axes: the connection
(`online`, `offline`, `unreachable`), the account (`unknown`, `signed-in`,
`signed-out`, `expired`) and sync activity (running, pending, last sync,
failure, retry time). Only a server answer changes the account, so a device
that is offline or cannot reach the server keeps its remembered user.
`describeSyncStatus` turns the status into a label, a detail, and an action
(sign in, retry or reload). The app supplies one sync attempt (`run`), passes
its session check's answers to `confirmSignedIn` or `confirmSignedOut`,
reports its outbox count with `setPending`, and calls `beginSignIn` before a
sign-in redirect, so the page it returns to reads `unknown` rather than "Sign
in again" until the server answers.

[docs/SYNC_STATES.md](docs/SYNC_STATES.md) has the design, when the client
cannot tell offline from signed out, and the TLA+ model and chart that check
the rules.

## Sync history

`createSyncJournal({ store })` keeps one local entry per sync pass that moved
a record or failed: keys, origin devices, change times, deletions and lost
edits, never values, for 30 days. Pass it to `createSyncController({ journal
})`; `run` then gets `trigger` and `pass`, and hands `pass` to
`SyncClient.sync({ observer: pass })`. `summarizeSyncHistory` groups the
entries by device and direction for a view, and `useSyncHistory(journal,
options)` in `/react` does the same in React. `/dexie` has
`DexieSyncJournalStore` over an app-owned `_sync_journal: SYNC_JOURNAL_SCHEMA`
table, which stays out of the synced table map.
[docs/SYNC_HISTORY.md](docs/SYNC_HISTORY.md) has the design and its limits.

## Dexie integration

The application owns its Dexie schema and migrations. Add `_sync_outbox: "key"`
to the schema, and `_sync_journal: SYNC_JOURNAL_SCHEMA` for sync history. Synchronized rows require a string `id` and an `isDeleted` field;
the middleware supplies `false` when it is absent. Keep caches and drafts out
of the synchronized table map.

```ts
import {
  SyncClient,
  createSyncClientStateStore,
  getOrCreateSyncClientState,
  nextSyncHlcBatch,
} from "@zsh-eng/local-sync";
import { installSync, DexieSyncStorage } from "@zsh-eng/local-sync/dexie";

const tables = { tasks: { schemaVersion: 1 } };
const stateStore = createSyncClientStateStore(
  localStorage,
  "tasks/account-123/sync",
);
getOrCreateSyncClientState(deviceId, stateStore);

// Two connections to the same database. Install interception on local writes only.
const applicationDb = new TaskDatabase("tasks/account-123");
const rawDb = new TaskDatabase(applicationDb.name);
installSync(applicationDb, tables, (count) =>
  nextSyncHlcBatch(count, stateStore, Date.now()),
);

const sync = new SyncClient({
  storage: new DexieSyncStorage({ db: rawDb, tables }),
  stateStore,
  remote, // Implements SyncRemote: pull(deviceId, request), push(deviceId, changes).
});
await applicationDb.tasks.put({ id: "one", title: "Read" });
await sync.sync();
```

Use table `encode` and `decode` functions for application value conversions.
The adapter rejects unknown tables, unsupported schema versions, and values
whose `id` or deletion state differs from the record envelope. The application
owns schema changes and domain validation.

Use a separate database and state key for each independent client or account.
The caller owns authentication, account switching, timers, online detection,
UI notifications, and disposal. Each adapter instance can report committed
record events through `onEvent`.

## Hono and D1 integration

```ts
import { createSyncHonoRoutes } from "@zsh-eng/local-sync/hono";

app.route(
  "/sync/v2",
  createSyncHonoRoutes<AppEnv>({
    requireAuth,
    getIdentity: (c) => ({
      userId: c.get("user").id,
      deviceId: c.get("deviceId"),
    }),
    getDatabase: (c) => c.env.DATABASE,
  }),
);
```

The host must authenticate the request before returning its user identity.
Mount paths and device-header extraction belong to the host. Each database
contains one `sync_records` table; user IDs isolate records within that database.
Use separate databases or host-assigned user namespaces for separate apps.
Apply `SYNC_D1_SCHEMA_SQL` through the host's migration system. The host can add
its own user foreign key. Reader keeps its existing Drizzle schema and migrations.

The routes expose `POST /push` and `GET /pull`. Values remain opaque strings on
the server. Versions compare clock wall time, counter, and device ID. Pull uses
a fixed sequence head for each paginated run. Push returns the current winner
for every submitted key, including rejected or repeated changes.

## Optional namespaced shared host

A host can pass a validated `namespace` beside its authenticated `userId` in
`getIdentity`. Apply `NAMESPACED_SYNC_D1_SCHEMA_SQL` to a separate database for
that mode. Record uniqueness, conflict winners, pull heads and streamed pages
then use `(userId, namespace)`. Omitting the namespace retains the v2 schema;
adding a namespace does not migrate existing data. The host owns the allowed-app
registry, authentication and epoch lifecycle.

`createNamespacedHttpClient({ origin, namespace, stateStore, signal })` supplies
`remote` for `SyncClient` and `request(path, init, refresh)` for namespaced file
APIs. It uses cookie credentials and the host's `/api/apps/:namespace/sync/v3/state`
endpoint. `SyncClient` obtains and binds the scope before pull and push. By
default `request` asks for the scope first; with `refresh` false it sends the
scope the state store has bound, and concurrent requests made before one is
bound share one question. Keep one client for many requests: the browser
sends identical scope requests one at a time. Requests
and responses carry `X-Sync-Scope` with origin, user ID, namespace and epoch.
An HTTP failure throws `SyncHttpError` with its status and response; fetch-style
app adapters may return that response to preserve their existing status handling.

Only a new state with no cursor and no completed bootstrap can bind implicitly.
A changed account, origin, namespace or epoch fails without resetting local
state. Existing unscoped installations require an explicit migration. The host
must isolate local stores, cancel obsolete sessions and serialize state updates;
this transport does not adopt or merge accounts. The optional stream retains the
same bounded lookahead and cancellation behavior.

The local reference host is [sync-server](../../apps/sync-server/README.md).
It integrates Reader and Spaced while keeping their production profiles separate.

## Storage contract and limits

Local rows and their compacted outbox changes commit in one transaction.
Deletes retain rows with `isDeleted: true`. Incoming writes use a raw database
connection. Push reconciliation clears only the exact submitted change, so an
edit made during the request remains queued. A failed apply does not advance
the client's cursor. The core exposes `SyncStorage<Prepared>` for other storage
implementations with the same transaction guarantees. `applyRemoteRecords`
may return `keptLocal`, the keys it left alone because a newer local edit was
pending; sync history reads them.

The retained v2 limits are 500 records per batch/page, 64 KiB per value,
1 MiB per encoded push body, and five minutes of allowed future clock skew.
A local write whose encoded value exceeds 64 KiB fails inside its transaction
with `SyncValueTooLargeError` (a `SyncRecordError` with `bytes`, `limit` and
`key`), so nothing is stored that could never sync. Keep large derived data in
local tables.
Clock ranges are reserved in the state store before local database writes.
Callers must serialize use of a shared state store; the current synchronous
key/value adapter does not coordinate multiple browser tabs.

This extraction preserves the current protocol. It does not add server reset
recovery, retained versions for acknowledged local rows, deletion expiry,
history merging, or cross-device transaction groups. Keep server records and
tombstones until a recovery and retention protocol exists. Binary transfer is
separate and remains in the application in this release.

## Development

Tests: `bun run build && bun run test` in this package (tests import the
public entry points in `dist`). The schemas use `zod/mini`, so an app bundles
only the checks it uses; `protocol.ts` loads zod's English messages. The tests use Node.js
with `node:sqlite` support. Reader also runs the server
adapter in Cloudflare's D1 test runtime. Run `bun run build:packages` from the
Reader root after a package edit when a development server is already running.
Use `bun pm pack` to produce a local installable archive; this does not publish it.

## Optional streaming pull (0.2)

The Hono adapter exposes `GET /pull-stream` with the same query and identity as
`/pull`. It returns newline-delimited page envelopes followed by `{"type":"end"}`.
A response contains at most 32 pages. A clean partial response resumes with the
same pagination head; EOF without the end marker is a failed transfer. The head
bounds pagination, not a transactionally isolated snapshot. Later updates beyond
that head arrive in the next pull.

D1 pages are bounded by 500 rows and a 512 KiB raw-value/key budget (including a
metadata allowance). One lookahead row determines whether more data remains.
Wire frames are capped at 4 MiB after JSON escaping. The response uses gzip when
accepted, with streaming compression and `encodeBody: "manual"` on Workers.

Implement optional `SyncRemote.pullStream(deviceId, query, signal)` with
`readSyncPullStream(response, signal)`. The decoder checks frame sizes, valid
UTF-8, envelope schemas, the end marker, and a 30-second idle timeout. The remote
must honor cancellation during pending reads. Hosts may fall back to `pull` on
404/405; never hide auth errors or truncated streams as successful fallback.

`SyncClient` uses one ordered writer and one page of lookahead. It retains at
most the active page and the next decoded page, in addition to parser and
transport buffers. Cursor checkpoints follow committed storage writes. Initial
bootstrap is marked complete only after a clean final stream. Failed writes
abort pending reads; local edits are still resolved by the storage adapter at
apply time. Pass the host's sync lifetime signal as `SyncClientOptions.signal`
when opting into streams. Account ownership and the in-memory domain model stay
with the host. Consumers that do not implement `pullStream` keep paginated pull.

## Priority restore

`new SyncClient({ ..., priority })` takes the key prefixes of the records an
app's first screen needs, such as `syncTablePrefix("books")` for keys from
`encodeSyncKey("books", id)`: printable ASCII, at most 8. Until the state
has bootstrapped, a pull first asks `SyncRemote.pullPrefixed` for those keys
from cursor 0, commits them without moving the cursor, then runs the full
pull. The full pull's request goes out when the priority pull has its last
page; its commits wait for the priority pull. A full-pull record at or below
the sequence that the priority pull applied for its key is skipped; a newer
version or a tombstone is applied. Both pulls share the signal, the device
check and the scope; either failing ends both.

The Hono routes take `prefix` (repeatable) on `/pull` and `/pull-stream`.
Each prefix is a range search of the `(user, [namespace,] key)` unique index;
pages, heads, cursors and limits are those of a plain pull, and no migration
is needed. A server without it answers 400 to the unknown parameter;
`createNamespacedHttpClient`'s `pullPrefixed` then yields no pages, does not
ask again, and the client does a plain pull. The design and its measurements
are in [docs/PRIORITY_RESTORE.md](docs/PRIORITY_RESTORE.md).

## Client performance

- Parse domain values once. Select schemas by record type; avoid trying every
  branch of a union. Zod 4 compilation can reduce validation cost further;
  measure it with your data and browser policy.
- Overlap reads with one ordered writer. Bound the queue and save the cursor
  only after the write commits. Streaming already supports one-page lookahead.
- Tune local write batches separately from server pages. Larger batches can
  reduce transaction overhead but increase memory use and UI pauses.
- An empty-outbox shortcut can avoid per-record lookups. This is an experimental
  optimization, not a built-in feature: check emptiness inside each apply
  transaction and keep conflict checks when pending edits exist.
- Measure the full restore. Network reads and database writes can overlap;
  their elapsed times must not be added as independent costs.
