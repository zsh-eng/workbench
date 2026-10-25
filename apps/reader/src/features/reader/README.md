# Reader

This reader has a small reader-side content pipeline before content reaches `pagination-v2`.

## Why the pipeline exists

- We load EPUB chapter files from IndexedDB-backed storage and normalize embedded resources before pagination sees the content.
- We keep `canonicalText` derived from the base chapter HTML, before highlight markup is injected.
- We inject highlights into the HTML before parsing it into pagination blocks so the rendered DOM, the parsed block structure, and the user's selection/highlight interactions all flow through the same representation.

That split gives us stable text offsets for highlight storage while still letting the rendered page include highlight markup.

## Pagination model

The reader uses real pagination rather than approximate locations. Every loaded chapter is parsed into blocks, converted into prepared text segments, and laid out against the current font, viewport, and spacing settings. This gives us precise page and spread counts, fast page-number jumps, and stable navigation once pagination is complete.

That precision has a cost. The engine has to translate between rendered selections, highlight offsets, fragment targets, content anchors, chapter-local pages, and global pages. Readers that use approximate locations can treat navigation as a lighter-weight scroll/location problem; this reader pays more up front so later movement through the book can be exact.

The tradeoff is usually worth it on modern devices, but it shapes the rest of the architecture: pagination is isolated in a web worker, source data is cached aggressively, and the worker is scheduled so navigation stays responsive while expensive relayout work continues in the background.

## Worker scheduling

`pagination-v2` runs inside a dedicated web worker so expensive pagination work does not block React or the browser's main UI thread. The worker is still a single JavaScript event loop, though, so long synchronous jobs cannot be interrupted in the middle. To keep latency low, the engine exposes pagination work as resumable jobs that can be stepped by the worker scheduler.

The scheduler treats work as different priorities:

- navigation commands (`nextSpread`, `prevSpread`, `goToPage`, `goToChapter`, `goToTarget`) are user-priority work and should feel immediate;
- layout commands (`init`, `updateChapter`, `updatePaginationConfig`) can produce new page geometry and may take longer;
- background chapter additions are useful for completing the book, but should not delay interaction.

This job scheduling bears a passing similarity to React Fiber: split expensive work into units that can yield, resume, and be superseded. After each step, the worker can process newer commands, discard stale queued work, and run higher-priority navigation before returning to lower-priority relayout. Relayout jobs process chapters incrementally, usually in a middle-out order around the current anchor, so the visible area becomes correct before distant chapters finish.

Epochs keep events from old layout work from overwriting newer results on the main thread. Coalescing prevents repeated config changes or repeated navigation commands from forcing the worker to finish work that no longer matters.

## Reading fonts

`src/lib/reading-fonts.ts` lists the fonts in Appearance → Type. Each has one CSS font-family list that the worker measures and the page renders, so the two lay text out alike. Name every family and end with a generic family. Pretext cannot measure `system-ui` reliably in Chrome or Firefox, so System is San Francisco only in Apple's WebKit, where widths match exactly, and Source Sans elsewhere.

A bundled family (`@fontsource`) is imported twice with the same subsets and weights: in `main.tsx` for the page and in `pagination-v2/worker/fonts.ts` for the worker. The worker loads only the families the reading font names: the Library warms it with the saved font, and each `init` or `updatePaginationConfig` waits for its font before layout. Workbox precaches the font files, so every font works offline.

Design ideas → Reading fonts opens the book you read last in each sans font through the Debug-only `?font=<id>` parameter, which lays the book out without saving the font.

## Paper and the page curl (Debug)

With Debug mode on, Appearance → Layout → Page turn chooses Slide or Curl, and Paper chooses Plain, Fine or Laid grain (`paper/`). Design ideas → Paper opens the book you read last in each through `?turn=`, `?paper=` and `?showThrough=`, without saving them. The curl runs only on a touch screen, one page at a time, with page animations on and reduced motion off; otherwise the slide stays.

- The swipe hook still owns the gesture, the commit threshold, the spring and the mid-turn page promotion. The curl only presents its offset, so saved places, history and checkpoints are the same as for a slide.
- `curl-geometry.ts` bends the page round a cylinder whose axis can tilt (after Hong et al., "Turning pages of 3D electronic books"). The page is held by its right edge at the height of the touch; the crease keeps pace with the finger, a grab low on the page lifts the bottom corner first, and vertical travel tilts the fold.
- The page beneath and the turning page up to the crease stay live DOM; `clip-path` cuts the turning page at the crease. Text never bends while it can be read.
- `curl-renderer.ts` draws only the bent part with WebGL, from a raster of the page: front shaded by the curve, back as paper with the front's ink blurred and mirrored through it, a soft highlight along the fold, and analytic shadows on the page beneath and under the flipped part.
- `page-raster.ts` paints the laid-out page into a canvas from `Range.getClientRects()` and computed styles, so it needs no second layout. Rasters for the current and previous pages are made while the reader rests and are keyed by content, so a page promoted mid-turn reuses its own.
- `paper-grain.ts` builds each grain as an SVG `feTurbulence` tile, used as a CSS mask over a theme colour from App.css.
- `use-page-feel.ts` adds a haptic tick when a turned page lets go (Android's vibration, or iOS 18's native switch) and an optional rustle from shaped noise in Web Audio.

## Scroll mode prototype (Debug)

With Debug mode on, a Pages/Scroll switch sits under the mobile header. Scroll mode shows one chapter as a vertical column (`scroll/`).

- The engine builds the column from the chapter's paged layout (`shared/layout-column.ts`), so lines break exactly as on the pages. Each page's start is a column offset, and its anchor comes from `pickAnchorForPage`.
- `ScrollStage` positions rows at exact offsets and mounts only the rows near the view. Long blocks split into chunks of 8 lines. The rows of a text selection stay mounted.
- Pages → Scroll opens at the current page's offset. Scroll → Pages snaps to the page of the first fully visible line, or to the next page when it starts within two lines of the top.
- The settled scroll position goes to pagination as a linear move, so checkpoints and reading sessions follow it. Highlights resolve against a one-page spread of the whole column and save the same offsets as on a page.
- `?scrollWindow=off` mounts every row, for comparing frame times.

## High-level stages

1. `Book -> ChapterEntry[]`
   We derive spine-aligned chapter metadata used by navigation and chapter loading.

2. `Chapter file -> base chapter content`
   We load a chapter file, process embedded resources, extract the body HTML, and derive canonical text.

3. `Base content + highlights -> decorated chapter artifact`
   We inject highlight markup into the HTML, then parse that highlighted HTML into pagination blocks.

4. `Decorated artifacts -> pagination feed`
   We initialize pagination with the first available chapter, stream the remaining chapters as they load, and send targeted chapter updates when highlight decoration changes a chapter's blocks.

5. `Pagination commands -> scheduled worker jobs`
   We enqueue init, chapter updates, config updates, background chapter additions, and navigation commands into the worker scheduler. The scheduler steps the highest-priority available job and yields back to the event loop between chunks of work.

## Cache ownership

The Reader cache has four owners under `data/reader-cache/`:

- `cache.ts` loads normalized content and builds decorated artifacts.
- `queries.ts` defines cache keys, reads, and retention settings shared by prefetch and active reading.
- `hooks.ts` connects those queries to React and schedules chapter artifact loading.
- `prefetch.ts` warms the same queries from Library interactions.

## Invalidation rules

- `bookId` or `book` change:
  Reload base chapter content and reinitialize pagination.
- highlight data change:
  Re-run only the decoration stage for already loaded chapters, then update pagination for chapters whose highlighted HTML changed.
- pagination config or spread config change:
  Pagination handles relayout itself. Reader-side chapter content does not reload.

## Search

Search runs over canonical chapter text, the same coordinates highlights and
notes use, so a result stays correct when the type changes and pages move.

- `search/search.worker.ts` holds the book's text and searches it chapter by
  chapter, yielding every 8ms. It starts at the reader's page and wraps round
  the book, so when it stops at 1,000 matches it keeps those nearest the
  reader. It sends the first match at once, then progress. A newer query or a
  cancel stops the old search.
- The worker starts once the book has settled and the page is idle. The text
  goes over a chapter at a time in idle moments, and the worker folds the
  whole book in the background (about 25ms for 2.6 million characters on a
  laptop), so the first search only has to match. Nothing is searched until
  search opens.
- Every keystroke searches. Matching is `String#indexOf` over the folded
  text, which covers a 2.6-million-character book in 0.1–5ms, so there is no
  index: a trigram index answers three or more letters in microseconds but
  takes 60–200ms and about 10MB to build and does nothing for the first two
  letters, and a suffix array takes seconds. The list keeps the last query's
  results until the new query's first arrive, so typing never blanks it.
- `search/search-text.ts` folds case, accents, curly quotes and invisible
  characters, and maps folded matches back to canonical offsets. Most text
  folds one to one, so the map keeps only the places where it does not.
- `goToTextOffset` and `locateTextOffsets` in `pagination-v2` turn an offset
  into a page. Locating covers only the results shown and the first few from
  the reader's page, so a long result list does not hold up page turns. A
  step from the reader compares pages within a chapter, because book page
  numbers move while earlier chapters are still being laid out.
- `search/search-marks.ts` marks the matches on the pages in view with the
  CSS Custom Highlight API, without changing the page's DOM.
- Searching never moves the page or the reading checkpoint. Opening a result
  is a `search` jump, so the history strip leads back.

## Reader diagnostics CLI

Use the reader diagnostics CLI when investigating pagination or rendered-layout
drift against an EPUB file without importing it into the library:

```bash
bun run diagnostics:reader -- \
  --epub "/absolute/path/to/book.epub" \
  --from 1 \
  --to 50 \
  --out diagnostics/book-pages-1-50.json
```

The command starts the local dev server, opens `/diagnostics/reader` in
Playwright, loads the EPUB as an in-memory diagnostic EPUB, waits for pagination
to finish, and scans the requested pages with the default mobile Iowan
diagnostic profile. It exits with code `0` when all scanned pages pass and code
`1` when any reader invariant fails, so the command can be used in automated
checks.

Useful options:

- `--from <page>` / `--to <page>`: scan a global page range.
- `--chapter <index>`: scan a zero-based chapter index instead of a page range.
- `--stop-on-first-failure`: stop after the first failing page.
- `--out <path>`: write the compact JSON report.
- `--dump-out <path>`: write the first failing Reader Page Debug Dump.
- `--dumps-dir <path>`: write one full Reader Page Debug Dump per failing page.
- `--pages-from-report <path>`: rescan the failed page numbers from a previous report.
- `--headed`: run the browser visibly when inspecting behaviour.

### Diagnostics startup notes

For large EPUBs or while debugging startup, it is often more reliable to start
the dev server yourself and tell the CLI to reuse it:

```bash
bun run dev -- --host 127.0.0.1
```

```bash
bun run diagnostics:reader -- \
  --epub "/absolute/path/to/book.epub" \
  --no-start-server \
  --timeout-ms 120000 \
  --out diagnostics/book.json
```

Use this path when the wrapper times out waiting for
`http://127.0.0.1:5173/diagnostics/reader`, when Vite chooses an unexpected
port, or when you want to run several scans against the same server.

On macOS, Playwright Chromium may fail inside the filesystem sandbox with a
`MachPortRendezvousServer ... Permission denied (1100)` error. Run the
diagnostics command with the normal escalation path when that happens; the
failure is a browser launch permission issue, not an EPUB parsing failure.

The CLI prints its JSON report at the end of the scan. For large books, a quiet
terminal usually means the EPUB is still being transferred, loaded, paginated,
or scanned. `--out` and `--dumps-dir` are written after the scan returns, so use
a larger `--timeout-ms` such as `120000` before assuming the command is stuck.

The diagnostics payload should send EPUB bytes as a `Uint8Array`. Avoid
converting large EPUBs with `Array.from(epubBytes)`, which materializes one
JavaScript number per byte and can make large-book scans appear to hang before
the reader receives the file.

### Failure snapshot workflow

First, scan the suspicious range and snapshot every failing page:

```bash
bun run diagnostics:reader -- \
  --epub "/absolute/path/to/book.epub" \
  --from 1 \
  --to 50 \
  --out diagnostics/book-before.json \
  --dumps-dir diagnostics/book-before-dumps
```

The compact report tells you which pages failed and why. The dump files in
`diagnostics/book-before-dumps/page-0002.json` and similar paths are full Reader
Page Debug Dumps for the failing rendered pages. Use those dumps as the concrete
evidence while changing pagination or rendering code.

After making a fix, rescan the same failed page numbers from the previous report:

```bash
bun run diagnostics:reader -- \
  --epub "/absolute/path/to/book.epub" \
  --pages-from-report diagnostics/book-before.json \
  --out diagnostics/book-after.json \
  --dumps-dir diagnostics/book-after-dumps
```

If the fix worked, `diagnostics/book-after.json` should report zero failures.
If failures remain, compare the before/after reports and the before/after Reader
Page Debug Dumps for the affected pages.

## Performance Optimization

See [Reader performance](PERFORMANCE.md) for the current startup metrics,
controlled normal/4x results, critical-path findings, and benchmark procedure.

Reader startup used to be dominated by materializing the source HTML. On slower Chrome on Android (Poco F3), opening a large EPUB spent most of the source time inside `Blob.text()`. This is less visible on faster devices like the iPhone 15 Pro Max or MacBook Pro M1 Pro.

The fix is to split reader startup into two caches.

Idea 1: A durable cache stores normalized chapter body HTML and canonical text. It is local-only, versioned, and rebuildable from the EPUB files. This removes repeated blob reads, embedded-resource normalization, image-dimension injection, body extraction, and canonical-text parsing from the steady-state open path. Work that depends only on the EPUB contents should happen when the EPUB is processed, not every time the reader opens.

Idea 2: Use React Query for a "hot cache". Reader startup data is expensive, and body cache rows, current checkpoint, highlights, and derived chapter artifacts all benefit from `QueryClient` deduping and reusing memory. When the queries are warm, the reader avoids the Dexie/IndexedDB hop entirely.

Idea 3: The `<Library>` prewarms the path users are likely to take next. "Continue-reading" books are fetched into memory, and hovered/pressed/focused book cards warm themselves before navigation. Even long books often have only 1-6 MB of chapter HTML, so the memory tradeoff is reasonable. In the best path, the reader opens with the body, checkpoint, highlights, and derived artifacts already in memory, so the source wall time falls effectively to zero and the remaining work is the pagination worker itself.

Idea 4: Precompute cautiously. Some derived artifacts can be prepared before the reader route opens, including highlighted chapter HTML and parsed pagination blocks. This can make the open path very fast, but background CPU still competes with active reading and library interaction. Background preparation should therefore be limited to likely-next books or likely-next chapters, and it should back off when the user is interacting.

The larger goal is to hide latency in layers: cache EPUB-derived HTML durably, keep likely reader inputs hot in memory, feed the worker as soon as the first chapter is available, and let the scheduler prioritize visible navigation over full-book completion.

## Firefox Pagination Performance Notes

Firefox has a specific slow path in full-book pagination that is much more visible with web fonts than with system fonts. The clearest example so far is _The Way of Kings_ with EB Garamond enabled. Chrome completed the prepare stage in about 940ms, while Firefox took about 13.9s on the same book. The source load, visible-first-page time, cache behavior, and layout time were not the bottleneck.

Representative measurements:

| Browser/font       | Prepare total | Pretext time | Other prepare time | Prepare calls | Cache misses | Layout total | Pagination total |
| ------------------ | ------------: | -----------: | -----------------: | ------------: | -----------: | -----------: | ---------------: |
| Chrome / Garamond  |       940.1ms |      847.6ms |             81.7ms |        16,873 |       15,492 |      565.9ms |         1506.0ms |
| Firefox / Garamond |    13,916.0ms |   13,776.0ms |            134.0ms |        16,873 |       15,484 |       55.0ms |       13,971.0ms |
| Firefox / Iowan    |      1909.0ms |     1769.0ms |            133.0ms |        16,873 |       15,484 |       72.0ms |         1981.0ms |

The cache numbers are nearly identical between Chrome and Firefox, so this is not primarily a prepared-text cache hit/miss problem. The workload is also not dominated by one bad paragraph: the slowest individual `prepareWithSegments` run was only tens of milliseconds, and many slow runs were short strings. The cost is distributed across thousands of ordinary prepare calls.

Deep primitive profiling pointed at canvas text measurement rather than segmentation. In the slow Firefox/Garamond run, almost all pretext time was inside `measureText`; `Intl.Segmenter` word and grapheme work was small by comparison. Switching Firefox to Iowan or a monospace/system font brought prepare time back near the low-single-second range, which suggests the expensive path is tied to worker canvas measurement with loaded web fonts.

A stripped-down Playwright repro narrowed the browser behavior further. Measuring many strings with a single stable canvas font is fast in Firefox. The slowdown appears when the worker has multiple `FontFace` rules registered, especially @fontsource unicode-range slices, and the measurement loop repeatedly assigns `ctx.font` before short batches of `measureText` calls. That resembles pretext's internal pattern: each `prepareWithSegments(text, font, ...)` call sets the shared measurement context's font before measuring that text's segments.

On one local run, the default repro measured 1000 calls with the app-like font set:

| Case                                            |   Time |
| ----------------------------------------------- | -----: |
| Chromium worker `OffscreenCanvas` + EB Garamond |  7.0ms |
| Firefox worker `OffscreenCanvas` + EB Garamond  | 49.0ms |
| Firefox page canvas + EB Garamond               |  2.0ms |

The practical takeaway is that Firefox is paying an unusually high per-prepare measurement cost for web fonts in the pagination worker. Registering fewer worker font faces changes the repro cost, but that is only an observation so far, not a chosen product fix. Any mitigation has to preserve measurement/rendering agreement; measuring with one font and rendering with another would make page counts and line breaks drift.

## Notes

See [Reader notes](../../../docs/features/notes.md) for capture, draft, storage,
and location rules.
