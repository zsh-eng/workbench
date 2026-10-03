# Workbench architecture

Workbench keeps independent apps under `apps/` and reusable code under
`packages/`. App folders own their UI, domain data, tests, deployment settings,
and local development files. Shared packages must not import app code.

## Current boundaries

- **sync-server** provides optional local shared auth, namespaced sync, and files
  for Reader and Spaced. Run `bun run dev:shared`. Its
  [local guide](../apps/sync-server/README.md) defines storage isolation and limits.
  Production cutover and Arctic integration remain separate work.

- **Spaced** owns flashcards, FSRS, review UI, local operation storage and its
  deployed Hono Worker. Read its [architecture](../apps/spaced2/ARCHITECTURE.md).
  It consumes `packages/local-sync` through a workspace dependency.

- **med** owns the local Git review host, browser UI, review links, syntax rendering, and video comparison helpers. Read its [architecture](../apps/med/ARCHITECTURE.md) and [agent integration](../apps/med/docs/AGENT_INTEGRATION.md). It has no deployed service.
- **Reader** owns the web EPUB app and its deployed Hono Worker. Read
  [Reader architecture](../apps/reader/docs/ARCHITECTURE.md) before changing
  its data loading, storage, caches, or Reader lifecycle.
- **Arctic browser** is a local React app under `apps/arctic/Browser`, with its own
  IndexedDB library and read-only Chrome/native seed importer. See its
  [browser guide](../apps/arctic/Browser/README.md). It has no active sync or deployment.
- **Arctic** owns the native iOS and Mac apps, share extension, Swift sync package,
  and WebView extraction bundle. Read its [app guide](../apps/arctic/README.md),
  [performance evidence](../apps/arctic/PERFORMANCE.md), and
  [sync boundaries](../packages/arctic-sync-server/README.md) before changes.
- **local-sync** owns the generic record protocol and engine. Its
  [adapter contracts](../packages/local-sync/README.md) apply to consumers.
- **text-highlighter** owns DOM selection and highlight restoration.
- **arctic-sync-server** exposes private auth and sync route factories. The
  Reader Worker supplies authentication and database/object-storage bindings.
  It is a package, not a separate deployed service.

- **podcast-lab** owns Undertone: cached RSS library metadata, local audio files,
  local transcription/diarization, hosted text classification, and a persistent
  loopback player. Its personal catalog has 20 shows with conditional disk-cached RSS refresh; it has no deployed service
  or sync. See its
  [experiment report](../apps/podcast-lab/README.md).

## Dependency and storage rules

Use Bun workspaces and the root `bun.lock`. Put dependencies in the manifest
of the app or package that imports them. Root scripts provide common entry
points; commands execute in the owning app directory. Reader keeps its explicit `rolldown-vite@7.3.1` alias; med uses Vite 8. Do not apply a root Vite override across these apps.

Keep metadata separate from large files. Local writes must not wait for the
network. Do not put API keys in synchronized records. Preserve the existing
storage and migration boundaries during structural changes. Arctic's live
ArticleStore migration requires separate explicit approval; moving files does
not activate it.

See [Local-first data and sync](../LOCAL_FIRST.md) and
[UI performance](../UI_PERFORMANCE.md) for reusable patterns and validation.
