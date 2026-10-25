# Reader Roadmap

This document tracks upcoming product, platform, and reader-engine work. It is
meant to be a working roadmap, not a promise that every idea below should ship.

## Current Direction

Reader stays a web app. The Expo mobile shell is shelved. The current goal is
to find how far the look and feel of a web app can go, on phones (installed
PWA) and on desktop:

1. Make the PWA feel native on phones: gestures, sheets, safe areas and
   motion.
2. Finish Reader paper cuts and Reader Experience Work (search, selection,
   jump history).
3. Keep the sync and storage contracts clean, so that a native port stays
   possible later if it becomes necessary.

The Reader depends on browser APIs, DOM layout, CSS, selection behavior,
IndexedDB, and web workers. A native port, as a WebView shell or as a native
reader, is a separate project. Start it only if the web app reaches a limit
that the evidence shows it cannot pass.

## If A Native Port Comes Back

This sequence is kept for reference. It is not current work.

1. **Expo shell spike**
   Prove that the existing app can run inside an Expo wrapper, authenticate,
   open the library, open a book, and survive basic app background/foreground
   transitions.

2. **Sync package and platform contracts**
   Extract the reusable sync model, HLC handling, remote adapter, storage
   adapter interfaces, file storage interfaces, and device/session identity
   seams. This should happen before implementing native Library, Highlights,
   Sessions, or Settings screens.

3. **Native shell screens**
   Build native Library, Continue Reading, Highlights, Sessions, Settings, and
   file import around the shared sync/domain layer.

4. **Reader decision**
   Keep the web reader in a WebView if the goal is a reliable mobile app soon.
   Rebuild the reader natively only if the project is ready to spend real time
   on native text layout, EPUB rendering, highlight selection, and pagination.

## Platform Architecture Work

Source audit: 8 September 2026. An unchecked item below has an implementation
boundary and a completion gate; it does not authorize an unmeasured rewrite.

- [ ] Extract domain types from `src/data/` into a package with no React, DOM,
      Dexie, or application-runtime imports. Include synchronized table mapping
      and anchor types. Gate: existing persistence tests use the exported types.
- [x] Extract pure HLC tick/observe/compare operations into
      `packages/local-sync/src/clock.ts`, with explicit state and time inputs.
      Package tests cover rollback, remote-ahead clocks, same-millisecond batches,
      restart and device tie breaks without browser globals.
- [x] Extract sync storage operations for atomic pull apply and push reconciliation
      into `@zsh-eng/local-sync/dexie`. The core receives a `SyncStorage` adapter;
      independent consumer tests cover edit/edit, edit/delete, duplicate push,
      rollback and edits during a request. Reader uses the package for record sync.
- [ ] Define browser adapters around the explicit Dexie factory, local state and
      file store. Gate: two client instances share no database, cursor, file
      upload intent or lifecycle state; use Sync Lab isolation tests as a base.
- [ ] Implement SQLite, native file and secure-session adapters after the shared
      contracts. Gate: the same contract tests plus device kill/relaunch and
      foreground/network recovery preserve committed data and pending work.
- [ ] Decide whether note conflict or undo requirements need append history.
      Evaluate existing Sync Lab scenarios plus concurrent note composition.
      Gate: a decision records the failing product invariant, storage growth,
      transfer cost and retention policy before selecting a new protocol.
- [ ] Audit backend history requirements with that decision. Current D1
      `sync_records` keeps one latest value per user/key, not full history.
      Gate: retain the current compacted model or specify history retention and
      replay behavior with fixtures; do not add history solely for simplification.
- [x] Keep binary files in a separate content-addressed transfer system.
      `docs/ARCHITECTURE.md` and `src/lib/files/` define the implemented boundary.
- [x] Refresh domain queries after incoming committed records, including notes,
      highlights, checkpoints and reading state (`src/lib/query-invalidation.ts`).
      Active Reader preferences still use localStorage; the legacy synchronized
      readingSettings table does not imply that those preferences synchronize.
- [x] Stop each transport's automatic retries after a stale-session 401. Sync
      and file uploads pause until sign-in or explicit retry; this does not
      globally cancel authentication or automatically refresh the session.
      Gate passed: focused recovery tests and `sync-status.spec.ts` browser checks.
- [ ] Verify cross-device file availability: Book before uploaded EPUB, bytes
      without expansion, expansion without source bytes, source 404 then recovery,
      and changed source ID. Gate: each state opens or gives an actionable error;
      no partial expansion is treated as complete.

## Mobile App Work

Shelved. Reader stays a web app, and phone work happens in the PWA (see PWA
Product Work). The milestones below apply only if a native port starts
later. They require one iOS and one Android device for acceptance. The
WebView shell can start before the native storage adapter is complete.

- [ ] Build an Expo WebView shell: authenticate, open Library/book, route a deep
      link and handle Android back. Decide remote versus bundled web content and
      the development origin. Gate: relaunch and cached offline book reopen.
- [ ] Add safe-area top/bottom chrome. Gate: no clipped controls in portrait,
      landscape, keyboard-open and standalone navigation states on both devices.
- [ ] Prototype the bottom bar after safe areas work. Compare a platform-supported
      glass treatment with an opaque fallback; gate on readable contrast, clear
      selected state and no overlap with Reader controls or keyboard.
- [ ] Add foreground/background/resume/network handling through one lifecycle
      adapter. Gate: background during save or transfer, then resume, produces no
      duplicate request and retains pending durable work.
- [ ] Add native EPUB picker import through the file bridge. Gate: cancellation,
      duplicate, malformed and large-file outcomes preserve the batch summary.
- [ ] Add share/open-in and deep-link entry routes. Gate: cold and warm app entry
      reach the intended book; unsupported files return to a usable screen.
- [ ] Store EPUBs/covers as native files with database references. Gate: relaunch,
      interrupted write and deletion leave no committed reference to partial data.
- [ ] Store auth/session secrets through the secure adapter. Decide the native
      sign-in callback flow; gate on expiry, logout, account switch and reinstall
      behavior without copying secrets through general WebView messages.
- [ ] Add best-effort background transfer with foreground recovery. Gate: OS
      deferral/termination leaves resumable intent; UI never promises immediate
      background completion. Expo BackgroundTask scheduling is OS controlled.
- [ ] Add optional haptics for page turns and explicit controls. Gate: one event
      per completed action; disabled preference and unsupported device are quiet.
- [ ] Add orientation, keep-awake and brightness controls owned by the Reader
      lifetime. Gate: exit/background restores the prior device behavior.
- [ ] Choose native shell order using the shell spike. Proposed first slice:
      Library/Continue Reading, then Settings; defer Highlights/Sessions until
      shared queries work. Gate: chosen screen works offline with the same data.
- [ ] Decide WebView versus native Reader using a representative EPUB corpus:
      fonts, images, tables, footnotes, selection, highlights and reflow anchors.
      Gate: rendering/interaction evidence and maintenance cost, not packaging
      alone, justify any native rewrite.

## PWA Product Work

The recent Library, Continue Reading, Sessions, Highlights, mobile navigation,
long-press, and reader-settings redesign is the current baseline. The backlog
below contains only work that still has a clear product or reliability reason.

### Next

- [x] Context menu when right click should keep the book card remained in the pressed state (so we know what we are right clicking)
- [x] Add more "continue reading" in the sidebar
- [x] Fix gradient continue reading
- [x] Reference telegram and simplify / unify the sidebar design
- [x] Add an OLED reading theme with dim reading text and theme values that are
      distinct from the current dark theme.
- [x] Fix overscroll in reader
- [x] Swipe to toggle chrome
- [x] Trace debugging UI
- [x] Fix library search bar cannot type text
- [x] Right click menu also hover UI - do this check for all context menus and add to AGENTS.md for this project

- [x] Keeping the images and the book name in the same column on mobile (since one column only)
- [x] Fix gradient, spacing in highlights page
- [x] Clean up highlights page mobile - spacing, background and stickiness, etc.
- [x] Fix measurement for "in this page" pinned sidebar scroll detection for highlights
- [x] Change book row in highlight masonry mobile
- [x] Fix animations when tapping sheet button
- [x] Highlight button circles should be bigger
- [x] Improve library page search bar
- [x] Swipe to change page (carousel style)
- [x] Perf improvements

- [x] New simplified sync engine
- [x] Check code lines saved
- [x] Organize doc files
- [x] Long press animation improvements
- [x] Benchmark highlights page for bottlenecks
- [x] New local-first file storage and EPUB materialization flow

- [x] BUG: With reading position being saved. Going back and coming back in - position is not preserved. Same when changing the reader size (e.g. changing to half page for the window position)
- [x] Optimize Highlights rendering using the measured plan in
      `docs/0004-highlights-performance.md`. Start by bounding React and DOM
      work; keep worker-based Pretext as a measured follow-up.

Notetaking flow

- [x] Decomp note-taking flow
- [x] We should preserve whatever right sidebar option that we chose
- [x] Autofocus on the notebook when opening sidebar on desktop
- [x] Notetaking storage
- [x] Fix exit animation sidebar state bug
- [x] Bug: Frozen no internet for the bottom loading bar and the whole reader as well (blocking loading bug)
- [x] Bug: Swipe should pass through for no UI chrome
- [x] Wire up to the UI
- [x] Add editing note UI flow (reference telegram)
- [x] Add deleting note UI flow
- [x] Make app feel more native to iOS
- [x] Sync lab

- [x] See highlights
- [x] Gesture for showing the footer
- [x] Remove the progressive blur on the themes page
- [x] Shift the continue reading to the top right
- [x] Remove animations when choosing chapter - feels sluggish. Add back hover animations for desktop
- [x] Show time read (day, total?)

- [x] Shift icons in sidebar panel to the right a little bit
- [x] UI chrome on desktop should not translate in - it should just fade in
- [x] Improve note-taking flow on desktop (edit + width of input)
- [x] Fix broken images in the reading status
- [x] Reading sessions bar
- [x] More UX improvements for note-taking and editing
- [x] Find better placement for prompts (the chrome accessories)
- [x] Jump history - persistent ?
- [x] Check for recent improvements to pretext and whether they are relevant to us
- [x] Update toast design and copy for consistency
- [x] Add time read for the day / for the book more prominently somewhere?

- [ ] Remove unnecessary sheet items
- [ ] Improve sheet placement + animations

- [ ] Fix the height of the input field for notebooks on mobile
- [ ] Remove the sidebar icons entirely? Or improve it in some way

- [ ] Additional UI indicator for highlights with notes
- [ ] The highlight comment box should be next to the highlight section, not on the right

- [ ] Fix the bug with selecting the right "contents" (prefer what was just clicked first?)
- [ ] Change the length of the bookmark ribbon + hit radius on mobile
- [ ] See highlights on mobile?
- [ ] Change to scrollable mode in the pagination (need think of the UX)
- [ ] Width of input field can be a bit narrower as well
- [ ] Improve mobile note-taking UX
  - [ ] Pinned to the top and scroll down
- [ ] Search - should search backwards only (spoiler free) if possible

- [ ] Appropriate scrolling for the notebook stuff (pinned input for keyboard, keyboard goes up)
- [ ] Review what's the policy for figuring out the reading usage (what are the thresholds
      we set, etc.)
- [ ] Nice, more beautiful sync states - persistent UI for showing the syncing of books, etc.
- [ ] BUG: Still have bug for freezing when network connection is bad (but not nothing)
- [ ] Benchmark binary encoding/table IDs against current JSON using representative
      Book/note/highlight data. Gate: compressed bytes, codec time and bundle size
      justify a change; define immutable IDs, schema versions and unknown-ID
      behavior before changing `packages/local-sync/src/protocol.ts`.
- [x] Expose automatic sync state, pending file transfers and stale-session errors.
      Reading-data success is separate from file availability; browser checks in
      `test/e2e/sync-status.spec.ts` verify the distinction.

- [ ] Extend the existing materialization tests (`book-preparation.test.ts`):
      source replacement during preparation, source 404 recovery, quota/write
      failure and recipe-version change. Gate: atomic marker/entries agree after
      each failure and the next valid open recovers without stale artifacts.
- [ ] Generate a 500+ chapter EPUB fixture. Test cold open, middle/last chapter,
      reflow and reopen; gate on exact completed totals and preserved anchor.
      Retain the generated fixture so the earlier large-spine report is repeatable.
- [x] Debug mode has an explicit Settings override and defaults off in production
      (`test/e2e/reader-pwa.spec.ts`); Sync Lab is available through that mode.
- [x] Reading status feedback is owned by the bottom Reader footer. Handoff takes
      priority and the note button stays above the prompt; the mobile browser
      check verifies stored status and reload.
- [ ] Audit remaining toast callers in Library, Devices, account actions and
      Reader errors. Gate: screenshots at 390 px and desktop show no overlap with
      keyboard/footer/dialogs; actionable failures stay beside the affected task.
- [ ] Compare shared Sonner radius with Reader status controls in light/dark
      themes. Gate: use existing radius tokens and verify both screenshots;
      avoid a global style change without checking action buttons and dialogs.

- [x] Test import followed immediately by Open book; the mobile browser checks
      stored expansion/marker before opening and waits for visible Reader content.
- [x] Test Highlights → jump to page with local bytes and a metadata-only book.
      Both browser paths preserve the requested highlight anchor through opening.
- [ ] Extend Highlights opening coverage to offline/404. Gate: failure shows a
      retry path and reconnect reaches that anchor without an unrelated jump.
- [x] Add page-animation preferences on mobile and desktop. Browser checks use
      touch on mobile, verify saved choices, reload and navigate without animation.
- [ ] Prototype footer page-change feedback only after page preferences settle.
      Gate: interrupted navigation shows the final page, reduced-motion is quiet,
      and hidden page numbers do not leave a placeholder or animation.
- [x] Add page-number preferences on mobile and desktop. Focused checks cover
      loading/hidden states; browser checks verify saved choices and reload in
      both modes, including turning page numbers back on.

- [ ] Benchmark targeted Zod 4.5 compilation before upgrading installed 4.3.6.
      Compare final push/pull schemas on valid/invalid data, cold startup and
      bundle size; confirm behavior when code generation is unavailable.
      The [original post](https://x.com/colinhacks/status/2093725420462182512)
      returned 403 during this audit; use the [official compile documentation](https://zod.dev/compile).
      Compilation adds code and uses `new Function`; do not enable it globally
      without an application-level improvement.
- [x] Batch pushes by exact encoded request bytes as well as record count.
      `sync-v2-sync.test.ts` verifies escaped UTF-8 notes across accepted batches
      and preserves an oversized restored mutation with a record-specific error.
- [ ] Complete limit-boundary fixtures for key 1 KiB, value 64 KiB, body 1 MiB,
      records 500 and future-clock 5 min. Gate: exact/one-byte-over/multibyte cases
      identify the failure owner without changing established limits.
      Audit file-route/provider limits separately; define a tested import/upload
      size boundary before showing a maximum file size in the product.
- [x] Separate reading-data synchronization from file-transfer progress in the
      shared sync status. Pending uploads do not produce a Library-synced claim.
- [ ] Add per-book download/preparation feedback and an explicit Open action.
      Gate: slow download, parse, error, retry and completion states work on
      mobile; metadata sync completion never implies that EPUB bytes are local.
- [ ] Define account-owned local stores before account merging. Current production
      DB/cursor/outbox are not account scoped. Proposed scope: drain old work,
      switch account-specific DB/state/upload intent, retain prior local data.
      Product decision: explicitly copy anonymous data or keep it separate; never
      silently merge signed-in accounts. Gate: A→logout→B→A, offline pending edits,
      in-flight uploads and different remote cursors send no A-only data to B.

- [ ] Capture theme-sheet screenshots for every theme before changing gradient,
      order or background. Current order is Light/Dark/Night/Flexoki Light/
      Flexoki Dark. Gate: selected tile and full sheet use intended theme tokens
      on mobile/desktop; identify the failing screenshot before a visual fix.
- [ ] Add a nested-scroll priority rule to Reader swipe handling. Gate: a
      scrollable table/code block consumes horizontal pan before page navigation;
      define edge behavior and test with chrome visible and hidden.

- [ ] Stabilize the Sessions redesign: reproduce and fix the overscroll flicker,
      then verify that the hover state does not create a duplicate visual layer.
      Gate: fixed dataset, desktop pointer and mobile overscroll recordings show
      one visual layer; retain the sequence before changing compositing.
- [ ] Diagnose slow-network startup flicker across Library and Reader. Keep the
      atomic reveal, and fix the first real blocking boundary that the evidence
      identifies. Gate: separate cached launch from cold download, capture storage/
      image/font/worker timing and compare first settled content on the same book.
- [x] Offer Open book after exactly one new import, including mixed batches;
      multiple successes remain in Library. Unit tests preserve duplicate/error
      summaries; `library.spec.ts` verifies the mobile handoff.
- [ ] Decide the mobile Continue Reading entry point. Wire the existing
      `ContinueReadingCarousel` only if it is the chosen surface; otherwise
      remove the unused component and keep the current card design. Gate: compare
      both at 390 px with one/many/no active books and choose one entry point.
- [ ] Reproduce the remaining long-press report on a named surface/device.
      Gate: hold opens one context menu, movement cancels hold and preserves
      scrolling, release does not also open the book; keep a browser/device trace.
- [ ] Implement meaningful-navigation jump history under Reader Experience Work;
      use its bounded stack and restore-anchor acceptance gate below.
- [ ] Decide whether a Reader-local History tab adds value beyond existing
      Sessions totals. Gate: specify entry point and session aggregation rules;
      reuse persisted reading sessions and avoid counting idle time twice.

- [ ] Build the per-book download/preparation surface scoped above before motion.
      Gate: mobile entry/completion transitions preserve readable status and a
      usable Open action; retry and reduced-motion states work without animation.

### Later

- [ ] Choose the product name and rename the project/repository from the
      prototype name. Product input required: name and intended public identity.
      Gate: audit repository/package/PWA metadata and deep links, then rename
      without changing deployed URLs until that migration is explicitly chosen.

## Reader Experience Work

### Current implementation

- [x] Create, edit, and delete notes from the Reader notebook, including notes
      attached to selected text. The old composer-wiring task is complete.
      Source: `ReaderNotes.tsx`, `NotebookNote.tsx`, and
      `use-reader-annotations.ts`; regression coverage: `reader-notes.spec.ts`
      and the note storage/draft tests.
- [x] Direct swipe navigation for previous and next spreads is implemented in
      `use-spread-swipe-navigation.ts`. It preserves text selection, leaves
      system navigation edges available, and respects reduced motion.
      Focused swipe and spread-layering tests passed in this roadmap pass.

### Next

- [ ] Ship Reader search end to end.
      Reader tools still show a placeholder. First
      connect literal-text search to a cancellable query and result list, then
      map each result to a canonical content anchor. Keep result state per
      book; invalidate cached text when the source EPUB changes. Include
      loading, no matches, local content unavailable, and extraction failure.
      Acceptance: next/previous match works across chapters; a selected match
      remains correct after typography reflow; opening and closing search does
      not overwrite the reading checkpoint until the user selects a result.
      Verify match offsets across inline markup and Unicode before treating
      the current plain-text offsets as navigation anchors.
- [ ] Make whole-paragraph selection reliably open the highlight toolbar.
      `use-reader-annotations.ts` already observes mouse, touch, and selection
      changes; engine tests cover anchor conversion. Add actual desktop
      triple-click and touch-handle sequences across inline markup and a page
      boundary. Acceptance: the toolbar remains usable, the selected quote is
      complete, and the saved highlight returns to the same canonical text
      after reload and reflow. Native iOS selection needs a device check.
- [ ] Add jump-back history for meaningful Reader navigation.
      Record the current canonical anchor before chapter, internal-link,
      search-result, highlight, committed scrubber, and handoff jumps. Do not
      record page turns, scrub previews, or the return action itself. Keep a
      bounded local stack per book; define its persistence limit before adding
      a synced domain record. Acceptance: repeated jumps unwind in order,
      returning does not form a loop, and entries survive reflow. Decide
      whether the stack must survive closing the book; if so, test reopen too.

### Later

- [ ] Add a visible anchor cue only where a navigation or reflow reproduction
      shows that readers lose their place. Reuse canonical anchor resolution;
      a short cue must not change layout or cover selection controls. Compare
      a subtle text cue with no cue before choosing a default.
- [ ] Explore desktop point-to-annotate and a keyboard shortcut. Keep ordinary
      text selection and keyboard navigation available. Scope the first trial
      to an explicit mode that resolves a pointer location to a content anchor,
      opens the existing composer, and exits with Escape. Margin comments and
      persistent annotation mode require a separate product decision.

## Reader Engine And Reliability

Keep this list evidence-led. Record the book/source identity, Reader Page
Debug Dump, viewport, settings, initial anchor, and exact interaction for each
failure. A synthetic fixture is useful for a known boundary; it does not prove
that an unprovided problem EPUB is fixed.

- [ ] Fix horizontal overflow and baseline clipping in affected EPUBs. Reduce
      each report to a chapter fixture; verify text, inline images, and font
      fallback at narrow and wide viewports. Acceptance: no clipped baseline
      or inaccessible content, with unchanged canonical highlight offsets.
- [ ] Investigate first-open spread and image flicker. Separate file download,
      EPUB expansion, chapter preparation, first spread, and image readiness.
      Compare cold import and warm reopen independently. Acceptance: useful
      content does not shift after reveal; repeated traces identify the fixed
      boundary without hiding a delay behind a longer loading screen.
- [x] Keep theme and display-only preferences out of pagination invalidation.
      `use-reader-core.ts` now builds its pagination configuration from layout
      fields only. Toggling numbers, page animation, or theme no longer sends
      an unchanged layout configuration to the worker. This is an ownership
      fix, not a measured timing claim.
- [ ] Reduce measured typography reflow latency. Capture the existing anchor,
      change font/size/line height, and compare repeated settled-spread traces
      with the same book and cache state. Acceptance: the anchor is preserved,
      the complete book receives exact page numbers, and measured latency
      improves without an unstable intermediate spread.
- [ ] Improve table, code-block, and publisher-specific layout only with a
      reproducible fixture. Keep native horizontal scrolling for content that
      cannot fit; coordinate gesture ownership with page swipe. Acceptance:
      all content remains reachable, vertical gestures remain native, and
      dragging the content does not also turn a page.
- [ ] Investigate highlight placement on indented paragraphs. Use canonical
      and rendered text dumps to separate an anchor error from rectangle
      positioning. Acceptance: the selected text and highlight geometry match
      through indentation, inline elements, reload, and typography reflow.
- [ ] Extract pagination or search into a package after their public contracts
      stabilize. First document inputs, worker ownership, source/cache keys,
      canonical anchors, and cancellation. Acceptance: the app uses the same
      behavior through the package and existing fixture tests pass; avoid a
      second implementation or a native-rendering promise in this extraction.

## Research Queue

Research must produce a fixture, comparison or runnable proof that informs a
specific implementation decision. These groups cover the original topic list.

- [ ] **Expo/React Native, Router, native SDKs and WebView bridge** (shelved
      with the Expo shell; keep for a later native port): deliver the
      first mobile shell above and a versioned request/reply bridge for auth,
      file references, deep links and Reader commands. Include picker/sharing,
      secure store, lifecycle/background tasks, haptics, orientation, brightness
      and safe-area device checks. Notifications require a defined user-facing
      event before implementation. Gate: cold/warm launch and import on iOS and
      Android with no binary payload or secret in general bridge messages.
      References: [Expo WebView](https://docs.expo.dev/versions/latest/sdk/webview/),
      [BackgroundTask](https://docs.expo.dev/versions/latest/sdk/background-task/).
      Background execution is deferred by the OS and can stop after user exit;
      foreground recovery is a requirement, not a fallback promise.
- [ ] **RxDB replication, Merkle trees, HLC, Loro/Yjs/Automerge and CRDT papers:**
      produce one comparison against current conflict/delete/lost-response/clock
      scenarios and concurrent note composition. Gate: identify an unmet product
      invariant and measure transfer bytes, storage growth and recovery cost.
      Keep the present LWW protocol unless a measured requirement needs change;
      pure HLC extraction is separately scoped under Platform Architecture.
- [ ] **Service workers, PWA updates and background sync:** extend existing cached
      offline-open/reconnect coverage with old-build→new-build during Reader
      activity, then offline relaunch. Deliver the update lifecycle and browser
      support matrix. Gate: committed reading state survives activation/reload;
      unsupported background execution still resumes pending work on foreground.
- [ ] **EPUB format/CFI, embedded resources, object URLs, tree walking and offsets:**
      build a licensed or generated fixture corpus covering resource references,
      nested text, repeated quotes, images, tables and footnotes. Deliver an
      anchor/resource conformance report. Gate: anchors survive reload/reflow;
      each object URL has an owner and release point; unsupported cases include
      a reproducible fixture rather than a general format-rewrite task.
- [ ] **Hook testing, pagination/startup benchmarks and React performance scans:**
      extend the existing database/browser diagnostic harness with cold, warm,
      reflow and theme sequences. Record book/location/viewport/cache state and
      main-thread, worker, storage and React timings. Gate: repeatable first
      settled content measurements identify one bottleneck before optimization;
      hook tests cover state transitions and persistence, not implementation counts.

## Not In Scope Yet

- Native reader rewrite before the shared sync/storage layer is understood.
- CRDT rewrite before the simpler HLC/log model has been evaluated.
- Full design-system migration unless it directly supports the mobile shell or
  reader workflows.

## Earlier lists

These lists come from the first README. Some items have shipped since.

v0.3:

- [ ] Better book text styles
- [ ] Text notes
- [ ] Reading stats over time
- [ ] Book shelves (DNF, completed, etc.)
- [x] Full text search
- [ ] Add multiple EPUBs at once

Future:

- [ ] Voice notes
- [ ] Audio notes
- [ ] Quote sharing
- [ ] Read articles
- [ ] Read PDFs
- [ ] LLM (ask questions)
- [ ] Flashcard integration
- [ ] Chinese learning (show pinyin, translation of words)
- [ ] Desktop / Mobile App (Tauri)

Not on the roadmap:

- Paginated view
- RTL or Top to bottom layout
- EPUB CFI for reading progress
