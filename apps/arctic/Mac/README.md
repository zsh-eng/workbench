# Arctic for Mac

A native macOS 14+ workspace for Arctic. Open `../ArcticMac.xcodeproj`, select
**ArcticMac**, and run on **My Mac**. Xcode 26 is used for validation. The Mac
project compiles the existing article, annotation, reading-session, metadata,
tagging, image-codec and WebKit-resource sources directly. These are shared
sources, not copies or a new database implementation.

The local optimized build is at `../.build/mac/Arctic.app`. Build products are
ignored by Git; the Xcode project is the reproducible source. This is a local
development build, not a notarized distribution.

## Interaction

- The left sidebar holds library folders and collections in compact, text-only
  rows. Open articles sit in a horizontal strip above the content. Notes open
  on the right. Selection uses a neutral wash in both system appearances.
- Tabs have fixed widths and reserved close-button space, so hover does not
  move their titles. Overflow scrolls to reveal the selected tab. Close is also
  available through the context menu and keyboard.
- Hover and selection washes use a 140 ms fade; Reduce Motion removes it.
  Article switches mount the retained reader immediately. Opening notes changes
  the reader width once, without a spring resizing WebKit on every frame. The
  notes content enters with a 180 ms fade and 6 pt translation inside its final
  bounds; Reduce Motion removes both.
- **⌘K** finds a library article or opens a URL. Opening does not save it.
  Saved, Favourites, Downloaded, History and Archive keep the iPhone rules, and
  the [opening policy](../OPENING.md) applies.
- **⇧⌘[ / ⇧⌘]** switch articles; **⌘W** closes an article;
  **⇧⌘T** reopens the last closed article. Open tabs restore on next launch,
  without starting their publisher requests.
- **⌘B** toggles the sidebar. **⌘L** returns to the library.
- **⌥⌘B** opens notes beside the article. Text selection supports Highlight
  (**⇧⌘H**) and Quote in note. New annotations on an unsaved article explicitly
  save it; existing annotations remain separate from library status.
- **⌘F** opens Find; **⌘R** refreshes Reader from the original URL.
  Article links open independent tabs. Command-click opens a background tab.
- **?** opens searchable shortcut help outside text fields. **⇧⌘/** also
  opens it while a text input has focus. App-specific bindings come from one
  catalogue shared by the menus and help panel.
- Import accepts Chrome Reading List HTML and preserves its source dates.
  Automatic tags use a user-provided Jev key in the Mac Keychain.

This first port uses one workspace window with multiple article tabs. It does
not replace the iPhone app, migrate its storage, or enable cross-device sync.
Mac data lives in its own sandbox container. Public HTTP-only websites retain
macOS transport-security restrictions; use Open in browser for those sites.
The local-network exception is limited to development replay and LAN URLs.

## Why keep three readers?

A tab is a URL and title. The three most recently used tabs can own live Reader
WebViews. Warm switching mounts the same view; it does not reconstruct HTML or
reset the document. Eviction saves a text checkpoint and preserves the draft
and its quoted context in workspace memory. Cold tabs reload their saved HTML.
Memory pressure drops inactive readers. Website views are created on demand
and released after extraction when the website is not visible. Keeping Website
mode in all three retained tabs can retain three additional website views.

After 300 ms, the adjacent open tabs can prepare **local saved HTML**. This never
visits a publisher, creates history, saves a link or records reading time. There
is no unbounded web-view pool. Unsaved tabs without a local Reader copy need
network access again after eviction. Note drafts survive tab eviction, but are
not durable across quitting the app until sent.

Warm tab switches also avoid rewriting the whole article index. History records
one visit when a tab first becomes visible and another when it is closed and
reopened. This tradeoff keeps the existing JSON storage untouched. Initial opens,
saves and imports retain the shared store's write costs. A future approved
storage migration should address very large library mutations independently.

## Library and image work

`NSCollectionView` reuses visible grid items. Filtering uses a cancellable background
snapshot. Viewport notifications do not invalidate the parent SwiftUI view.
The shared metadata scheduler gets visible items and four neighbors on each side after a short
scroll-idle interval. Only visible cells and that nearby range request images.

ImageIO decodes at 640 px for Retina grid cards. The disk cache stores only these
JPEG/PNG derivatives, not original publisher downloads. It is trimmed to 64 MiB
in batches; decoded memory has a separate 48 MiB limit. Three workers serve
visible requests before queued prefetch work. URL requests are shared by leases;
when the last consumer cancels, queued or active work cancels too. These Mac
adapters reuse Arctic's tested codec and work limiter.

## Reproduce checks

```sh
# From apps/arctic
xcodebuild -project ArcticMac.xcodeproj -scheme ArcticMac \
  -destination 'platform=macOS,arch=arm64' \
  -derivedDataPath /tmp/arctic-mac-build \
  -only-testing:ArcticMacTests test

# In another terminal, enable the local network extraction check:
python3 MacTests/replay-server.py

# Requires an unlocked Mac with Xcode UI automation available:
xcodebuild -project ArcticMac.xcodeproj -scheme ArcticMac \
  -destination 'platform=macOS,arch=arm64' \
  -derivedDataPath /tmp/arctic-mac-build \
  -only-testing:ArcticMacUITests test
```

Core tests use temporary metadata/HTML folders. The optional replay listens only
on loopback and serves invented article text; it sends no publisher or Jev
requests. UI tests use separate test links, annotations and reading-session files.
No test resets the user's real library.

## Evidence and limits — 24 September 2026

- Debug and optimized Release Mac builds and the iOS Simulator regression build passed.
- The shared WebView suite passed all 22 tests. Repository lint and strict
  formatting checks for the Mac Swift sources passed.
- Six native core checks passed: pool bounds/reuse and deallocation; immutable
  link identity and saved HTML; background preparation with no visits/time;
  archived favourites; drafts across eviction; cold versus warm preparation.
- In one Debug host run, three saved documents reached Reader readiness in
  **65.31 / 64.92 / 65.64 ms**. Thirty warm WebKit text queries had a median of
  **0.13 ms**, p95 **0.63 ms**, with no second HTML loads. This measures document
  readiness and WebKit access, **not visible tab-switch latency or frame rate**.
- The initial UI test runner timed out enabling automation. A later computer-use
  attempt confirmed that the Mac was locked. A light-mode empty-library screenshot
  was inspected; article interactions, dark-mode layout and high-refresh frame
  delivery still need the unlocked desktop check. A subsequent core-test launch
  also waited in XCTest’s IDE-session handshake (confirmed with a process sample),
  so the newly added loopback extraction check has not yet completed. The six
  core results above are from the preceding successful run.

The Article menu's **Reader diagnostics** shows retained readers, pool hits and
misses, last readiness time and load count. Readiness also goes to unified logs.
Use Instruments for compositor hitches and physical high-refresh performance;
these counters cannot establish sustained 120 fps. Compare cold extraction,
cold saved HTML and warm tab switches separately, using the replay server rather
than live publisher timing.

## Design reference

The sidebar proportions and restrained hierarchy reference [Search by Office
Commun](https://github.com/driceroland/Search/tree/245a26145cf7a7e7bd5bf47744a334bcaeea5096).
Its `Design.swift` and `Side.swift` use a neutral canvas, soft selection, compact
rows, and a small motion vocabulary. Arctic uses its own native components and
system colours. The reference's sidebar tab layout becomes library navigation
here; articles remain across the top and notes remain on the right. No Search
source or assets are bundled.

Keep frequent keyboard navigation immediate. Apply hover motion to small
backgrounds, not to the document, table, or a whole view hierarchy. Preserve the
bounded reader pool and native reusable library rows when changing this chrome.

### Chrome validation — 24 September 2026

Release Mac build, iOS Simulator regression build, strict Swift formatting, and
code-signature verification passed. Direct computer-use checks on the Mac
confirmed saved-article opening, five top tabs with overflow reveal, keyboard
cycling, close/reopen, sidebar toggling, right-side notes, per-article draft
retention, and shortcut help. The temporary draft was cleared without saving.
The Command-? Help-menu conflict found during these checks was corrected and
rechecked on the packaged Release build.

Screenshots were checked in the Mac's dark appearance. Light appearance and
Reduce Motion use semantic colours and motion guards but were not visually
checked in this pass. XCTest UI startup failed before executing a test with
“Timed out while enabling automation mode” (`/tmp/arctic-chrome-ui.xcresult`).
This pass does not establish a frame-rate or hitch improvement.

## Desktop refinement — 24 September 2026

The 46 pt title row contains the native window controls, sidebar toggle, article
tabs and icon actions. Reader has no permanent bottom toolbar. Selection opens
an AppKit popover with colours and a quote action; existing highlights also offer
an eraser. Native selection and Copy remain intact, while a CSS Highlight paints
only the selected text, avoiding WebKit's full-width selection wash.

[Cursor's article](https://cursor.com/blog/git-at-any-scale) informed the quiet,
narrow text column and restrained heading; [Meta's article](https://research.meta.ai/blog/bringing-your-muse-to-life)
informed the wider media. Arctic uses its own system fonts: 18 px body, 1.6 line
height, a 640 px text measure, and up to 120 px media extension on each side.
The desktop CSS is included before loading cached HTML. Fonts and restored scroll
position settle before the first reveal; network images do not block readiness.

Reading statistics is a workspace page. Its projection warms at launch and stays
in memory; opening the page displays that result while refreshing off the main
actor. The Mac app icon is generated from the existing Arctic iOS artwork.

Validation: Release Mac and iOS Simulator builds, 23 WebView tests, Swift formatting
and JS lint passed. Native computer-use checks covered grid card activation,
sidebar shortcuts, the stats page, bounded text selection and the contextual
popover. Light-mode geometry has browser coverage; the native visual check used
dark mode. Frame-rate and end-to-end tab-switch latency were not measured. The
previous Mac XCTest host signing mismatch remains a separate test-runner issue.

## Images, intent and reading controls — 25 September 2026

The Mac retains native collection-cell reuse, background ImageIO decode, deduplicated
requests, cancellation and viewport-first scheduling. The 640 px longest-edge
JPEG/PNG files have a 64 MiB disk budget. Decoded images have a **48 MiB cache
cost limit**, roughly 50 landscape 640×390 images or 30 square 640×640 images.
This is not a process-memory ceiling: visible layers, in-flight jobs and WebKit
use additional memory. The inspected local cache contained 141 files / 9.45 MiB,
with a 43.6 KiB median file size; those figures describe that snapshot only.

Four neighboring items on each side join the visible image range. A 160 ms card
hover starts article preparation in the same three-reader pool. It does not open
a tab, record a visit or credit reading time. Uncached articles can contact their
publisher, and saved articles can acquire an offline copy. Leaving cancels an
unfinished speculative reader that is neither selected nor already an open tab.
Background documents wait for fonts, but not offscreen animation frames. A visible
cold image fades for 180 ms only after a load longer than 100 ms. Memory hits and
offscreen completions do not fade.

Missing or failed OG images use original, deterministic colour fields inspired by
[OpenAI News](https://openai.com/news/). The reference serves raster cover images;
Arctic recreates the soft colour transitions and grain locally, without copying
those files. Sixteen 320×200 variants cost about 4 MiB. They are generated on an
actor and reused. No continuous gradient rendering runs during scrolling.

The library header overlays scrolling cards with an AppKit material whose opacity
fades toward its lower edge. This uses public APIs; it is a graduated backdrop,
not a private variable-radius blur filter. Sidebar clicks animate only the rail's
translation and opacity for 240 ms. Document width changes once, avoiding repeated
WebKit reflow during motion. Keyboard sidebar changes and Reduce Motion are immediate.
Reader images have 12 px corners and the 38 px headline does not depend on viewport
width. The interface uses SF Pro, with rounded library headings; Reader defaults
to system sans-serif at 18 px / 1.6 leading.

Reading appearance now retains palette (System, Light, Paper, Ink), typeface
(System, DM Sans, EB Garamond), size, line spacing and column width. The same recipe
is injected before initial paint and updated in all retained readers. The native
highlight tooltip is reused, moves to a new selection and does not take keyboard
focus. Outside clicks, Escape, scroll and tab changes dismiss it. The fixed-height
note editor keeps a small send-button slot reserved: Return sends, Shift-Return
inserts a line, and IME composition retains Return. Control-Tab and Control-Shift-Tab
cycle articles even when WebKit has focus.

### High refresh experiment

WebKit defaults `PreferPageRenderingUpdatesNear60FPSEnabled` to true. Arctic's
**High refresh · experimental** preference disables it for both Reader and Website
views and reads back the result. The runtime feature is present on the tested Mac,
whose main display reports a 120 Hz maximum. This uses guarded **private WebKit
SPI**, isolated in `MacWebRefresh`; an App Store build must omit that SPI or replace
it with a public API. Safari's own preference does not configure these webviews.
Sources: [WebKit preference definition](https://github.com/WebKit/WebKit/blob/main/Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml)
and [WKPreferencesPrivate.h](https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/API/Cocoa/WKPreferencesPrivate.h).

Article options → **Reader diagnostics** enables the live Web/UI counter.
**Record 30s** records bounded frame intervals; **Stop** ends it early and
**Save trace…** exports JSON. The overlay shows callback cadence, p95 interval
and Web intervals above 1.5 display-frame budgets. Sampling is off by default,
updates the UI once per second, and stops when the reader or window is inactive.
The native display link requests the current screen's maximum refresh rate.
Traces contain timing only, without article text, URLs or credentials. Web gaps
also emit `FrameTiming` signposts for Instruments.

Web measures `requestAnimationFrame`; UI measures `CADisplayLink` callbacks.
Neither measures final compositor frame delivery. Use Instruments to confirm
scroll hitches. Display mode, power settings and workload affect both counters.

### Validation limits

The 24 WebView browser checks pass, including stable heading size across sidebar
widths and rounded media. Release Mac and iOS Simulator builds pass. Native reader
integration tests run with `ENABLE_HARDENED_RUNTIME=NO` **only on the temporary
Debug test host**, avoiding the prior ad-hoc test-library signing mismatch. The
installed/package Release build keeps hardened runtime enabled. The network replay
and opt-in timing tests remain skipped unless explicitly enabled.

The Mac locked during this pass. Native visual checks of the new material,
selection tooltip, hover intent and note composer, plus an on-screen refresh-rate
measurement, remain open. Do not treat the builds or headless tests as that evidence.


## Recovery and interaction fixes — 25 September 2026

Saved articles now keep a preview completion date, including successful results
without an OG image. Launch and foreground recovery rebuild unfinished metadata
work independently of Jev and the import sheet. Older no-image entries receive
one fresh metadata check; failed checks retry on the next activation. Existing
viewport priority, bounded workers and source reading-list dates are preserved.

An uncached tab displays its publisher page as the navigation commits while
Reader extraction runs. It switches to Reader when ready only if the user has
not started interacting with the website. Cached HTML still opens directly.
This removes an application-imposed wait; it cannot remove publisher latency.

The highlight tooltip anchors to the selected text range, tries above, then
below, and clamps to the viewport. Position changes are immediate, with one
reused nonactivating panel. Its placement follows the rules described in
[Chrome's CSS anchor-positioning guide](https://developer.chrome.com/docs/css-ui/anchor-positioning-api),
implemented with AppKit screen coordinates. Selected text remains uncovered
when either side has enough room; a viewport-filling selection uses the top edge.

Search uses a fixed-size pill with a quiet focus border. The library title
compacts after crossing a scroll threshold; only threshold changes update
SwiftUI. A 136 pt backdrop fades below the header using the public
`NSVisualEffectView.maskImage` API. This is a graded material contribution,
not a variable-radius blur. The native split-item scroll-edge experiment did
not compose correctly inside this workspace, so it is not shipped.

Validation: Release Mac and shared iOS Simulator builds passed. The 25 WebView
checks passed, including text-anchor bounds and opt-in frame recording. Eight
native tests completed with no failures and one opt-in benchmark skipped; the
loopback extraction and post-relaunch metadata recovery checks both ran.
Swift formatting, Web lint and the Release code signature passed.

Native computer-use checks covered light-mode library scrolling, compact header,
search/filter/clear, a local uncached article, repeated text selections, tooltip
above/below placement, and the FPS/record controls. The Save panel opened; export
completion was not verified. During the local replay, observed readings included
Web 108–114 and UI 116–119 callbacks/s. These are spot samples, not a controlled
before/after benchmark or a sustained 120 fps claim. Dark-mode and Reduce Motion
visual checks remain open. The replay tab and search query were cleared.


## Command palette and library return — 25 September 2026

Command-K uses one native panel and table prepared with the workspace. It opens
without a sheet or animation, focuses the existing field, and displays prepared
local results. Typed searches use cancellable background snapshots; Return waits
for the current query rather than opening a stale row. Up/Down selects, Return
opens, and Escape clears the query, then dismisses. Clicking outside dismisses.
The fixed-size palette uses system materials, compact rows and keyboard hints,
with keyboard behavior informed by [Raycast's search bar](https://manual.raycast.com/search-bar).

The library grid stays mounted underneath the Reader, notebook and statistics.
Its completed projection, native cells and scroll position survive article close.
Hidden grid updates and viewport prefetch pause; returning applies any pending
metadata revision. This retains the visible grid's bounded working set, not all
article views or additional WebViews.

Right-click or Control-click a card for Open, Open in background tab, Favourite,
Archive/Move to Saved, Save/Remove from Saved, Copy link or Open in browser.
Menus read current saved state and archive uses the existing Undo action. A
subtle outline identifies the card for the duration of the menu.

Release computer-use checks covered first/repeated palette opening, focus,
keyboard selection/filtering, Return, Escape, context-menu background opening,
and returning from an article to the unchanged scroll position (0.02442545 in
that check). The final result row received extra clearance after visual review.
Native integration checks cover rapid query-and-Return and menu persistence with
archive Undo. No claim of measured hotkey-to-photon latency is made.
