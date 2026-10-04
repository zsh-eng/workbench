# Architecture and performance principles

This document records the main design decisions and guides future changes.
Source code defines current behavior. Older plans describe implementation
history; they do not override these decisions.

## Optimize the reading experience

Prioritize the time from user intent to useful, stable content, then fast
navigation and interaction. Measure the first useful spread, settled visible
content, and full pagination separately. Full pagination must complete, but it
does not need to block the first spread.

Preserve coherent rendering: stable page geometry, native text selection,
correct fonts and images, and predictable controls. A faster intermediate frame
is not a win if the visible page then shifts or the reading position changes.

## Complete pagination and reuse prepared work

Exact page numbers and full-book pagination are product requirements. The
worker prioritizes the visible location, then completes the remaining chapters.
Navigation must remain responsive while background preparation continues.

Keep useful book content, chapter artifacts, and pagination data in memory for
fast reuse. Persistent caches support later app launches; they do not replace
memory caches. Avoid repeated storage reads, parsing, measurement, and layout
when the inputs have not changed. Introduce eviction only when measured memory
pressure justifies the cost of rebuilding data.

Loading order, storage granularity, and memory retention are separate choices.
Loading the first chapter earlier does not require discarding other chapters.
Bulk reads and batched writes can be faster than many small operations. Keep
the current bulk source-loading path unless a measured alternative improves
the relevant user interaction. Use bounded concurrency or yielding when work
competes with rendering; more parallel work is not automatically faster.

## Local data and sync

Production Reader uses `https://api.zsheng.app` for auth, sync, files, and devices,
with namespace `reader`. `apps/sync-server` owns that service. Browser stores are
scoped to the API origin; legacy local stores remain intact after the fresh
sign-in and restore. The Reader Worker serves assets and retains independent
Arctic/auth routes. Legacy Reader record/file writes return 410; old remote stores
remain for recovery. See the [migration evidence](../../sync-server/MIGRATION.md).

Domain data lives in IndexedDB. Local writes must work without the network;
the sync outbox records durable changes with those writes. The server stores
opaque records and resolves versions without owning book-specific behavior.

`@zsh-eng/local-sync` owns the protocol, clock, and sync engine. Its `/dexie`
adapter owns atomic mutation capture and reconciliation; `/hono` supplies the
generic D1 endpoints. Reader supplies schemas, value codecs, authentication,
storage identity, lifecycle, and query invalidation. The package core must not
import Reader, React, Dexie, or browser storage. See the
[package contract](../../../packages/local-sync/README.md).

Binary EPUB and cover files are separate from synced domain values. Books hold
file references. Expanded EPUB entries and Reader caches are local, derived
data that can be rebuilt. Keep generic file transfer separate from decisions
about which book or resource the application needs first.

Refresh cached data when its inputs change. Prefer targeted invalidation to
clearing or reloading unrelated warm data. Local persistence, remote sync, and
UI refresh are separate phases; report and test failures at the correct phase.

## Ownership and correctness

Give each stateful process a clear owner and lifetime. Async work must not
publish into a newer book or configuration after it is superseded. Keep cache
identity consistent between prefetch and active reading, including source
content and all settings that affect the cached result.

Keep reading location separate from reading-duration accounting. Navigation,
relayout, and reopen must preserve the latest committed content location; a
page number can change when the layout changes. Test persistence and restore
as one interaction sequence, not only as separate helpers.

Use React for composition and presentation. Keep substantial scheduling,
persistence, and layout rules in modules with explicit inputs and outputs.
Split modules by responsibility when that makes ownership easier to follow.
Avoid extra abstraction layers that only forward calls or move complexity.

Group feature-owned UI and orchestration under `src/features/<feature>`, with
flat folders and direct imports until a larger structure earns its place.
Library owns its page, grid cards, and import flow in `src/features/library`;
the app shell can use that flow through its provider and hook. Keep shared book
queries, cover loading, sorting, and reusable book UI outside the feature, and
keep persistence in `src/data`. Highlights owns its grouped view, filtering,
and mosaic layout; Devices owns signed-in device management; Reading Sessions
owns the reading-history page. Reader keeps its existing content pipeline,
hooks, controls, and diagnostics together under `src/features/reader`, including
the toolbar and settings panels shared by its reading and debug views.

## PWA performance

Optimize repeat use as well as first installation. Cached assets avoid repeat
downloads; a fresh app process still has initialization work. Measure an
existing-process resume separately from a fresh launch with cached assets.
Bundle size alone does not justify route splitting. Preserve offline access
when changing asset loading or caching.

## Measure and test real interactions

Use Playwright, computer use, or the Reader Diagnostic Harness to exercise
interaction and performance changes. Reproduce the exact action order and
timing, including rapid navigation, close/reopen, resize, and background/resume
where relevant. Inspect both visible behavior and stored state. Automated unit
and integration tests complement these checks; they do not prove the browser
interaction works. State any browser or device verification that remains open.

Start with existing performance traces. Add focused spans where attribution is
missing: storage, source preparation, fonts, worker execution and message wait,
React commit, image decode, and settled content. Trace async work with enough
identity to distinguish books, runs, and layout changes. Keep instrumentation
lightweight and avoid including private book text in timing logs.

Compare before and after under the same book, initial location, settings,
viewport, build, browser, cache state, and network conditions. State whether
CPU throttling affects the main thread, worker, or both. Use repeated runs and
report variation. Do not clear site data in a warm-cache test. Confirm the
bottleneck before changing architecture, and separate measured results from
hypotheses.

## Further detail

- [Reader pipeline and diagnostic tools](../src/features/reader/README.md)
- [Performance metrics and benchmark evidence](../src/features/reader/PERFORMANCE.md)
- [Reader terminology and rendering invariants](CONTEXT.md)
- [Agent workflow and current storage contracts](../AGENTS.md)
- [Product and platform roadmap](../ROADMAP.md)
