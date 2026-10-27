# Spaced architecture

Spaced is a local-first flashcard PWA and a Cloudflare Worker in
`apps/spaced2`. Workbench owns its source and dependency installation. The
app consumes `@zsh-eng/local-sync` from `packages/local-sync`; packages do not
import Spaced code.

## Runtime

- React 18, TypeScript 5.6 and Vite 6 build the UI. The app keeps its own tool
  versions; Reader and med can use different versions in the same workspace.
- Dexie stores operations, review logs and the durable sync outbox in
  `SpacedRecordsV3`. An in-memory projection supplies fast UI queries.
- FSRS-6 runs through ts-fsrs 5.4.2 with the fitted client defaults. Existing
  due dates are preserved. Statistics use the user's local study day, starting
  at 04:00. See `docs/FSRS_OPTIMIZATION.md`.
- The `spaced2` Worker serves the built frontend. Production auth, sync, images,
  and devices use `https://api.zsheng.app` in `apps/sync-server`, with namespace
  `spaced`. Local records and images use API-origin-scoped browser stores.
  Legacy app record/file writes return 410; old D1/R2 data is retained for recovery.
  Google callback: `https://api.zsheng.app/api/auth/callback/google`.

## Local writes and sync

A user action builds operations. One IndexedDB transaction stores the local
rows and outbox entries before publishing the change to memory. Background
sync uploads the outbox and downloads remote records. The generic shared
package handles HLC conflict ordering and the protocol. Spaced's record adapter
validates domain payloads. Deck membership is a last-write-wins boolean.

The app sync engine retries in the background every 30 seconds while online,
and on connectivity or visibility changes. Transient failures do not show a
retry banner. Initial restore keeps its progress message until bootstrap finishes;
session expiry still asks the user to sign in.

Network requests hold only the cross-tab network-sync lock. Local writes and
incoming transactions use a separate short lock. The app's sync state bridge
merges clocks when it publishes cursor progress, preserving clocks advanced
by local reviews during network waits. See `docs/REVIEW_LATENCY.md`.

The current review card is a session snapshot. Queue updates must not replace
it while the user is thinking. A successful grade or explicit action advances
the session; Undo restores the graded card. See `src/lib/review/session.ts`.

## App updates

The service worker precaches the app (`vite.config.ts`). A new version
downloads in the background and waits; `src/lib/app-update.ts` runs the
shared `createAppUpdate` from `@workbench/background-activity` and decides
when it takes over (`src/lib/update-policy.ts`): never while a card is on
the review screen or something a reload would lose is under way, by itself
at a launch or after two minutes away, and at once on "Restart to update".
Run `bun run test:update` after a build to check it on the real worker.

The entry chunk names every lazy file, so its name changes with every
release. The app code that Stats shares with the first load has its own
chunk, so Stats and its charts keep their names across a release.

## Images

`ImageCacheV2` separates metadata and image blobs. Review HTML checks the local
cache before assigning an image URL. The current card and next 20 cards retain
deduplicated object URLs and decoded images, with four concurrent preloads.
Images outside the window release their references. Missing images can download
independently; cached display and local grading do not wait for network sync.
"Download all images" (`src/lib/images/images-activity.ts`) skips stored
images, asks for Spaced's own files up to 32 to a request, six requests at
once (`downloadMany` in `src/lib/images/db.ts`,
[bulk file downloads](../../docs/FILE_BATCH.md)), and keeps each image as it
arrives. Images on other sites download five at a time. One client keeps the
account's sync scope for file reads (`src/lib/files/shared-request.ts`), so a
read no longer asks `/sync/v3/state` first.

## Source and checks

- `src/routes`, `src/components`: UI and interactions.
- `src/lib/db`, `src/lib/sync`: persistence, projections and sync integration.
- `src/lib/review`, `src/lib/images`: scheduling, session state and image cache.
- `src/elements`: the Elements page at `/debug/elements` (see
  `../../docs/ELEMENTS.md`). It loads lazily and shows production components
  on sample data. Pages under `/debug/elements` do not start sync.
- `server`: auth, file routes, schema-independent sync and retirement handler.
- `drizzle`: current backend migrations.
- `scripts`: import compiler, migration, optimizer and benchmark tooling.
- `tests` and colocated tests: browser-DOM, IndexedDB and server regressions.

From Workbench, run `bun run test:spaced2` and `bun run build:spaced2`.
Run browser checks for interaction changes. `wrangler.jsonc` remains the app's
production configuration. Migration, restore and retirement evidence is in
`docs/`; historical reports retain their original paths and commit IDs.

The earlier Workbench import changed source ownership only. The shared-backend
cutover on 4 October 2026 is documented in `../sync-server/MIGRATION.md`.
That earlier source import did not change browser
origins, storage keys, Worker names, secrets, account identities or production
records. See `../../docs/SPACED_MIGRATION.md`.
