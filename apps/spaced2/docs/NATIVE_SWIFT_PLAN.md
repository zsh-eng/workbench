# Native Spaced plan: Mac first, then iPhone and iPad

26 September 2026. Proposal only; no native implementation or deployment is part
of this change.

## Recommendation

Build a native SwiftUI Mac app with native SQLite persistence and a shared Swift
core for the later iOS/iPadOS app. Keep the current server, record identities,
wire format, scheduling policy, and web app compatible. Prove the complete initial
restore path before porting the full UI.

Match Spaced's content, layout, colours, and review interactions closely. Use
native navigation, menus, dialogs, file selection, and platform controls where
appropriate. Use Liquid Glass for navigation and controls, not behind study text.
Apple's [adoption guide](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass)
describes native framework adoption. Exact pixel equality across WebKit, SwiftUI,
OS versions, and display scales is not a release promise; compare fixed-size
reference captures and document intentional native differences.

Working platform assumption: macOS 26 and iOS/iPadOS 26 minimum for the first
personal builds. Confirm device support before creating targets. This is not
an App Store release plan. Start with a signed local Mac build; add device
signing and TestFlight only when the mobile app is ready.

## Existing code and boundaries

- [Spaced architecture](../ARCHITECTURE.md): Dexie persistence, in-memory UI,
  local commits before publication, streaming sync, and stable review sessions.
- [Shared sync library](../../../packages/local-sync/README.md): protocol v2,
  HLC conflict order, fixed-head pulls, and bounded stream lookahead.
- [Arctic Swift sync](../../arctic/Sync/Package.swift): useful protocol, transport,
  Keychain, and browser sign-in code. It is staged, not live Arctic app sync.
- [Arctic store measurements](../../arctic/Sync/PERFORMANCE.md): the whole-file
  JSON journal has excessive edit cost; do not copy that persistence design.
- [Native auth handshake](../../../packages/arctic-sync-server/README.md): reuse
  its reviewed design and tests, with Spaced-specific configuration.

The currently checked-out Spaced Worker serves its own `/api/sync/v2`, auth,
and file routes. Do not make this port depend on a separate shared-server
cutover. Recheck the deployed endpoint at implementation time.

Swift cannot directly import the TypeScript sync engine. Extract reusable Swift
protocol/auth code into a sibling package, then implement a SQLite storage
adapter and streaming client. Conformance fixtures keep the two clients aligned.
Do not import Arctic app code into a shared package or activate Arctic's dormant
storage migration as part of this work.

## Proposed ownership

| Location | Responsibility |
| --- | --- |
| `apps/spaced-native/` | Xcode Mac/iOS targets, Spaced Swift core, views, assets, integration tests, benchmark runner |
| `packages/local-sync-swift/` | Generic protocol, HLC ordering, SQLite record/outbox storage, stream transport; no card domain |
| `packages/native-auth-swift/` | Reusable browser handshake, account lifetime, Keychain and session transport |
| `packages/spaced-content/` | Extracted Markdown rendering bundle, math/code assets and content styles consumed by web and native |
| `apps/spaced2/` | Existing web app and Worker; conformance fixtures and narrow native-auth integration |

Keep Spaced models, scheduler adapter, queues and statistics in its app-owned
Swift package. Avoid splitting every feature into a package. Reuse existing
server route factories where suitable; extract generic helpers only when the
actual Spaced integration needs them.

## Native data path

Use Apple's native SQLite library through a small Swift wrapper initially.
One dedicated writer serializes transactions away from MainActor. Network waits
must never hold the writer. Start with WAL and synchronous FULL, prepared
statements and 5,000-record bootstrap transactions; tune measured batch latency
without relaxing durability. Keep the existing logical indexes for comparison.
A Swift actor alone does not ensure file work is off MainActor; make executor
ownership explicit and test it.

Persist these logical tables in an account-scoped database:

- Records: opaque value, record key/type, schema version, deletion flag, HLC,
  winning device ID, server sequence, and useful indexed fields.
- Outbox: durable pending mutations, with revision identity for safe push ACKs.
- Sync state: cursor, device identity, clock, bootstrap completion and scope.
- Local state: drafts, settings, image metadata and durable pending upload intent.

Local grading commits card changes, review log, sibling effects, HLC and outbox
in one transaction. Only after commit does the UI advance. A failure keeps the
current card visible. Incoming records and their cursor checkpoint commit
atomically. A push response cannot erase a newer local edit.

Scope storage and credentials by server and authenticated account, plus any
namespace/epoch required by that server. Account changes cancel old transport
work and reject late responses. Never discard the outbox on a sync error.
Unknown schemas stop safe cursor advancement rather than silently losing data.
Preserve original value bytes and unknown fields where possible when updating
supported records; define versioned local SQLite migrations separately from
wire schema changes.

Keep cards, decks, membership and due-queue projections in memory. Apply committed
changes incrementally. Keep history durable in SQLite and compute statistics on
a background executor when needed, with revision-based caches. The history path
must match current results without placing all logs in the observable UI model.
Do not equate 10 MB of encoded JSON with 10 MB of Swift heap usage; measure it.

Use URLSession for existing compressed streaming pulls. Parse frames with size
limits, cancellation and idle deadlines. Feed one ordered writer through a
bounded queue; batch local transactions independently of server frame sizes.
Honor fixed-head pagination, clean end markers and commit-ordered checkpoints.
Do not collect an unbounded full response or rebuild the whole UI on every frame.

The first benchmark restores every record before declaring bootstrap complete.
Do not declare the review queue correct from an arbitrary prefix of the stream:
later membership, deletion or scheduling records can change it. A main-data-first
bootstrap is a separate possible server/protocol change after measurement.

## Content, images and review behaviour

Reuse the current Markdown pipeline (remark/GFM/math, KaTeX and code highlighting)
and CSS in a small bundled WKWebView content surface. Swift owns persistence,
sync, scheduling and navigation. Keep the renderer mounted; change content only
on reveal, successful review, or another explicit action. Prepare the next
content document without replacing the current card.

Use native multiline text controls for front/back editing, with a shared WebKit
preview. The existing editor is Markdown text, not a rich document editor.
Preserve pasted/dropped images, draft recovery, save failures and confirmation
before draft loss. Verify text selection, scrolling, accessibility, links,
code wrapping and mathematical notation against the web app.

Bundle assets locally. Supply cached images through an account-scoped local
asset scheme with strict path validation. Card HTML does not receive auth tokens
or unrestricted native commands. Allow only narrow renderer messages; open
external links through the system. Preserve the current safe Markdown behaviour.

Keep original images in files separate from SQLite and decoded images in a
bounded memory cache. Prefetch the current card and next 20 cards, deduplicate
requests, prioritize visible images and release unused work. Bound decoded bytes
as well as card count. Do not create 20 live WebViews. Missing images load
independently and never block a grade or record bootstrap. Avoid lossy replacement
of original study diagrams; display-size derivatives are optional cache entries.

Preserve these existing regression requirements:

- Background sync or a newly due card cannot replace the visible review card.
- Undo reverses the full review action, including sibling suspensions, while
  preserving unrelated later changes.
- Slow connectivity and a hung request cannot delay local grading or editing.
- Deck membership remains last-write-wins; deletion/tombstone rules are unchanged.
- Study days start at 04:00 in the user's current time zone, including DST cases.
- Heatmaps support selection/focus; duration follows the heatmap and totals all
  four states in the tooltip. Preserve draft and account-loss safeguards.

## Scheduler compatibility gate

The current app uses ts-fsrs 5.4.2 and the fitted 21 weights in
[fsrs6-personal-parameters.ts](../src/lib/review/fsrs6-personal-parameters.ts).
Retain retention 0.9, maximum interval 100 days, fuzz enabled, short-term
scheduling, learning steps 1/10 minutes and relearning step 10 minutes.

[Open Spaced Repetition's Swift implementation](https://github.com/open-spaced-repetition/swift-fsrs)
now advertises FSRS-6 with 21 supplied weights, but its default example still
selects FSRS-5. Pin an audited revision and pass the fitted parameters explicitly.
Do not assume algorithm version alone guarantees scheduling parity.

Generate fixtures from the current TypeScript scheduler for every state/rating,
same-day reviews, overdue cards, learning steps, interval limits and date edges.
Verify field mapping, timestamp precision, rounding and deterministic fuzz/seed
behaviour. Use exact dates/discrete fields and explicit floating-point tolerances.
If the Swift library differs, port the missing behaviour behind the scheduler
adapter before enabling native writes. Existing due dates must not be recomputed
on import. No new optimization run or server data conversion is required.

## Delivery sequence and completion gates

### 1. Mac restore experiment — first deliverable

Create a small Mac app with an account/fixture picker, restore progress, deck/card
counts, one read-only review card and an exportable timing report. Implement the
real SQLite repository, decoder, streaming transport and in-memory projection
that the finished app will use. This is not a throwaway SQL insertion loop.

Start with the existing private snapshot served through a local instance of the
same streaming route. Source data stays read-only; native databases are disposable.
Then add native Google sign-in and an authenticated, read-only production restore.
Reuse Better Auth identity and the HTTPS Google callback. The additional native
handoff needs narrowly scoped server routes, short-lived one-use codes with PKCE,
a fixed app callback and Keychain storage. Never embed a client secret. Validate
locally first; any production route deployment is a separate explicit action.

Measure a release build with fresh app processes and empty stores, plus resumed
restores and normal cached launches. Repeat at least three times and retain all
samples. Use the same snapshot, indexes and controlled network conditions as a
browser comparison, including a documented 100 ms RTT case; do not silently treat
an old result with different conditions as a controlled A/B comparison.

Record overlapping trace spans for transfer/decompression, envelope/domain decode,
conflict/outbox checks, SQLite transaction/commit, projection, first usable review
screen, total record restore, and image readiness. Report transfer bytes, peak
memory and MainActor stalls. Report wall-clock totals separately; overlapping
stage times must not be added together.

Verify every logical record after app restart, full-content hashes, indexed
fields and database integrity. Interrupt mid-stream and mid-transaction, resume,
and prove no skipped records/cursor advancement. A clean close/reopen test alone
is not crash recovery evidence.

The historical 97,266-record / 43.85 MB snapshot took about 0.73 s for native Bun
SQLite writes at batch size 5,000, versus about 7 s in the recent browser Dexie
write comparison. Neither is a Swift end-to-end result. The saved browser restore
trace was about 15.7 s. See [native results](SQLITE_STORAGE_BENCHMARK.md) and
[OPFS comparison](OPFS_STORAGE_BENCHMARK.md) for exclusions and variation.

Gate: a reproducible full-restore report, correct reopened data, and a clear
remaining bottleneck. Aim for low-single-digit seconds on the test Mac under a
fast local connection, but set the release budget from these measurements rather
than promise that time over arbitrary networks. Do this before broad UI work.

### 2. Daily-use Mac review app

Complete scheduler parity, reveal/grade/Undo, queues, deck filtering, saved and
suspended cards, image caching, keyboard shortcuts and offline edits. Add outbox
push only after read-only restore and interoperability tests pass. Check native
writes in the web app and web writes in native, including concurrent offline edits.

Gate: review offline and under a stalled network with no card replacement,
no lost review on restart, and matching schedules. Target cached next-card display
below 100 ms at p95 on the test Mac; measure real interactions with cached images.

### 3. Complete Mac feature and visual parity

Port card/deck management, search, create/edit, import/export flows present in the
web app, image management, statistics and account/settings. Inventory each current
route before declaring parity. Keep library screens mounted where that preserves
selection and scroll state. Use native menus, command palette, dialogs, drag/drop
and file pickers; keep Spaced's card layout and colour vocabulary.

Capture web references first, then compare native light/dark, empty/loading/error,
long code/math, images and narrow/wide layouts at matched content widths and scale.
Record accepted platform differences. Check keyboard focus, VoiceOver and Reduce
Motion. Do not use a screenshot check alone to approve interactive behaviour.

Gate: complete feature checklist and reviewed visual differences, plus no material
restore/review regression from adding the UI.

### 4. iPhone and iPad adaptation

Reuse the same Swift domain, SQLite store, scheduler and sync packages. Adapt
navigation, safe areas, touch grading, sheets, keyboards and layouts with platform
views. Use the compact Spaced arrangement on narrow widths; preserve the existing
640-point compact boundary where equivalent, with accessibility-driven reflow.

Handle foreground sync, interruption and bounded background execution. Correctness
must not depend on iOS running an indefinite background task. Test memory pressure,
image cancellation, process termination and resume on physical devices. iPad
sidebar/multicolumn views reuse Mac feature logic without copying desktop density.

Gate: equivalent review and sync behaviour on device, touch-accessible statistics,
acceptable memory use and measured device latency. Simulator timings do not prove
physical-device performance.

## Test and review order

1. Cross-language fixtures: protocol/HLC ordering, date/enum encodings, domain
   projection and FSRS output. Follow current tests in `apps/spaced2/tests`.
2. SQLite plus local Worker integration: push/pull, interrupted streams, restart,
   local edit during pull/push, rejected payloads, account switch and image files.
3. Native UI journeys: restore, review/Undo, offline edit, search, draft loss,
   image preload, keyboard/touch navigation and statistics selection.
4. Release-build performance traces and matched visual captures on Mac, then iOS.

Suggested implementation review order: generic storage/protocol transaction rules,
Spaced domain/scheduler parity, benchmark traces, then rendering and platform UI.
Preserve existing web behaviour throughout. The proposed first increment has no
wire-format rewrite, binary compression migration or production data replacement.
