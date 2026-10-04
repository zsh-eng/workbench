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

The package depends on Zod. Adapter peers are optional for consumers that use
only the core. The package ships ESM JavaScript and TypeScript declarations.

## Dexie integration

The application owns its Dexie schema and migrations. Add `_sync_outbox: "key"`
to the schema. Synchronized rows require a string `id` and an `isDeleted` field;
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
`remote` for `SyncClient` and `request(path, init)` for namespaced file APIs. It
uses cookie credentials and the host's `/api/apps/:namespace/sync/v3/state`
endpoint. `SyncClient` obtains and binds the scope before pull and push. Requests
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
implementations with the same transaction guarantees.

The retained v2 limits are 500 records per batch/page, 64 KiB per value,
1 MiB per encoded push body, and five minutes of allowed future clock skew.
Clock ranges are reserved in the state store before local database writes.
Callers must serialize use of a shared state store; the current synchronous
key/value adapter does not coordinate multiple browser tabs.

This extraction preserves the current protocol. It does not add server reset
recovery, retained versions for acknowledged local rows, deletion expiry,
history merging, or cross-device transaction groups. Keep server records and
tombstones until a recovery and retention protocol exists. Binary transfer is
separate and remains in the application in this release.

## Development

Run `bun run build` in this package to emit `dist`. Run `bun run test` after
building; tests import the public package entry points. The tests use Node.js
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
