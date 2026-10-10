# Agent Guidelines

This repository uses **bun** as the package manager and for running scripts.

Read [Architecture and performance principles](docs/ARCHITECTURE.md) before
changing architecture, data loading, caching, or Reader performance.

## General Coding Practices

- After you finish editing code, provide a brief summary in the conversation rather than generating a separate document
- Prefer early returns / guard clauses to avoid nested conditionals
- Use `bun run build` for type-checking the project. DO NOT run `npx tsc`.
- For interaction or performance changes, use Playwright, computer use, or the Reader Diagnostic Harness to test the relevant user sequence. Check visible behavior and stored state where applicable. User testing complements these checks; report any browser or device verification that remains open.
- Include comments and documentation for major pieces of code (not every helper function requires it, use your judgement).
  For example, hooks that do a lot of work/handle complex behaviour deserve documentation.
- Unless explicity stated, you do not need to handle "backwards compatibility".
- Do not be overly defensive in the code. Where possible, avoid using null and undefined - figure out a way to maintain data integrity and being explicit.

## Styling & UI

- **Colours**: Avoid introducing new colours. Use existing CSS variables from `index.css`. Refactor any hardcoded colours to use theme variables. Clarify with user before adding new colours
- **Animations**: Use the `motion` library for complex animations (simpler than verbose CSS)
- **Shared layout indicators**: A conditional `layoutId` marker inside the active list row is valid only when all rows share one stacking context. Do not give each row `isolate`, `z-index`, `transform`, or opacity that creates a separate stacking context; DOM order can then place the moving marker above row content in one direction. Put the stacking context on the list container and keep all row foreground layers above the marker, or render the marker as a container-level sibling.
- **Context menus**: A context-menu trigger must keep the object’s hover visual state while its menu is open. Use Base UI’s `data-popup-open` state, typically with `group-data-[popup-open]` on the hovered descendant. Apply the same visual treatment to focused or selected objects.
- **Data Fetching**: Use TanStack React Query for data fetching and caching
- **UI components**: Keep only components in `src/components/ui` that are actually used. Add specific ones as needed via `bunx shadcn@latest add <component>` rather than pre-adding a broad library, and remove any that fall out of use.

---

## Backend Structure

- **Framework**: Hono with Cloudflare Workers
- **Database**: D1 Database with Drizzle ORM
- **Auth**: BetterAuth for authentication
- **Database Schema**: Auth tables in `server/db/auth-schema.ts`, custom tables in `server/db/schema.ts`
- **API Logic**: Main logic lives in `server/lib/`. Route handlers in `server/index.ts` should only parse params and return responses
- **API Client**: Use the typed Hono client from `src/lib/api.ts`:
  ```ts
  const res = await honoClient.posts.$get({ query: { id: "123" } });
  ```
- **Protected Routes**: See `server/index.ts` for examples using `c.get('user')`

### Testing

Choose checks from the changed behavior before starting validation:

| Change                                  | Default checks                                                                                                                          |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Documentation or comments               | Review the diff and links. No build or browser run.                                                                                     |
| Internal application logic              | Focused unit or integration tests, `bun run build`, and `bun run lint`.                                                                 |
| Sync, storage, or cache behavior        | Database integration tests, build, and lint. Add one focused browser check when visible behavior changes.                               |
| Layout, navigation, or Reader lifecycle | Test the exact interaction sequence in a browser, plus relevant tests, build, and lint. Use before/after traces for performance claims. |
| Tests or test configuration only        | Run the affected tests or check test discovery, plus lint. No application build unless application code or build inputs also change.    |

- Prefer integration tests with the database for persistence behavior. Run focused tests once with `bun run test --run <test-file>`.
- Run the full client suite (`bun run test:client --run`) for shared application changes or changes across domains. It is inexpensive; do not replace a fast suite with a longer manual check.
- Run a focused browser test with `bun run test:e2e <spec-file> --grep <test-name>`. Use `test:e2e:ui` or `test:e2e:headed` when visual inspection is needed.
- To check a design with real data, run `bun run dev:local-data` and open port 5177. It serves the local Workbench Backup mirror read-only; see the README.
- The suite serves on port 5190. To run suites from two worktrees at once, give one another port: `E2E_PORT=5192 bun run test:e2e`.
- Reuse `test/e2e/helpers/fixtures.ts` or the Reader Diagnostic Harness instead of creating temporary browser scripts. For warm Reader checks, use prepared local data and controlled network responses. Keep cold import checks separate; do not clear caches in a warm-cache test.
- The E2E `localBook` fixture restores imported EPUB rows into each test's isolated database; it does not precompute pagination. `openLocalBook` starts the Reader from those local bytes. The suite uses a dedicated dev server and mocked API, with service workers blocked. Use separate tests for real-server sync and PWA behavior.
- Wait for observable readiness and completed interactions, not fixed delays. Assert visible results and stored state where relevant; avoid assertions about incidental setup counts. Retain traces and screenshots on failure.
- Stop when the relevant checks pass. Repeat or broaden checks only after a new change, failure, or unresolved concern. If a failure appears unrelated, reproduce it once on unchanged code, record the evidence, and track it separately. Report any required check that remains blocked; do not silently skip it or increase retries to hide a failure.

---

## Domain Persistence

`src/data/` owns domain types and persistence functions, grouped into books,
book content, reading checkpoints, reading sessions, reading settings,
highlights, notes, and reading state. `src/lib/db.ts` is the application export
entry point; keep implementation in the domain modules.

- Keep cross-table transactions with the operation that owns them. Book deletion
  belongs in `books.ts`; EPUB replacement and its completion marker belong in
  `book-content.ts`.
- `src/data/database.ts` exposes the shared application connection and the
  tombstone filter. Schema definitions and migrations remain in
  `src/lib/sync-v2/db.ts`.
- Domain modules import their connection and sibling types directly, not through
  the `src/lib/db.ts` export entry point.

---

## Sync Architecture

The app stores domain rows in IndexedDB and synchronizes them through one
opaque record log in D1.

- `packages/local-sync` exposes the shared protocol and engine, plus `/dexie`
  and `/hono` adapters. Keep application imports out of this package. Its
  [README](../../packages/local-sync/README.md) defines the adapter contracts.
- `src/lib/sync-v2/db.ts` owns the Dexie schema and migrations.
  `src/lib/sync-v2/tables.ts` owns synchronized tables and Reader value codecs.
- The package's Dexie middleware converts ordinary local writes into compacted
  outbox changes in the same transaction. Its storage adapter applies remote
  rows and reconciles pushes through a raw connection.
- `src/lib/sync-v2/sync.ts` connects the shared engine to Reader's database,
  codecs, typed Hono transport, and Sync Lab runtime.
- `src/lib/sync-v2/client-state.ts` supplies Reader's existing storage key and
  runtime storage to the package's clock and state functions.
- `src/lib/sync-service.ts` owns periodic sync and online recovery.
- `src/lib/query-invalidation.ts` maps committed domain-table writes to
  TanStack Query prefixes. `SyncProvider` owns its subscription, including
  offline local writes. Update this map when query dependencies change.

Synced domain tables include Books, reading checkpoints, reading sessions,
highlights, reading settings, reading state, and notes. Application types do
not contain protocol metadata. Stored rows add only the plain `isDeleted`
field that the sync middleware needs.

The following data is local-only and regenerable:

- `bookFiles` contains expanded EPUB entries.
- `bookMaterializations` proves that expansion completed for one source file
  and recipe version.
- `bookTextCache` and `bookChapterSourceCache` contain Reader-derived data.
- `files` contains local binary bytes.
- `fileUploadOperations` contains durable upload intent.

---

## File Storage System

Files are separate from synchronized values. Books store only opaque references
to an original EPUB and an optional 480 px WebP cover. A small BlurHash can be
stored with the cover reference.

### Architecture

`src/lib/files/files-manager.ts` provides the generic files API:

- `put()` calculates an opaque `FileId` and atomically stores the Blob and its
  upload operation. It does not wait for the network.
- `get()` returns local bytes or downloads and stores them.
- `ensureLocal()` uses the same deduplicated download path as `get()`.
- `listLocal()` and `listRemote()` expose file inventory.
- `deleteRemote()` deletes only the remote object. It does not remove local
  bytes or inspect Book references.

The application controls request order by awaiting these operations. The files
manager has no file types, Book behavior, or numeric priority scheduler.

The server exposes only the generic routes:

```text
PUT    /api/files/:fileId
GET    /api/files/:fileId
GET    /api/files
DELETE /api/files/:fileId
```

### Usage Pattern

```ts
const fileId = await files.put(blob, { mediaType: blob.type });
const localOrDownloadedBlob = await files.get(fileId);
const hasLocalBytes = await files.hasLocal(fileId);

// React components can use useFileUrl(fileId) for a managed object URL.
```

---

## Adding New Synced Entities

To add a new synchronized domain entity:

1. Add its domain type and Dexie table to `src/lib/sync-v2/db.ts`.
2. Add the table definition to `READER_SYNC_TABLES` in `src/lib/sync-v2/tables.ts`.
3. Use ordinary Dexie `add`, `put`, and `delete` operations. The middleware
   writes protocol changes to `_sync_outbox`.
4. Add integration tests for local mutation, pull conflict resolution, push
   reconciliation, and deletion.
5. Add the table's dependent query prefixes to `src/lib/query-invalidation.ts`.

Do not add a type-specific server table or route. The generic sync endpoints
store encoded domain values in `sync_records`.
