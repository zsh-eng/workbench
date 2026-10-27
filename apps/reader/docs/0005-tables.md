# Tables in Reader

Status: shipping. Auto reads a chapter's tables as grids when the chapter
holds up to `GRID_TABLE_CELL_LIMIT` table cells (see [The cap](#the-cap)),
and as paragraphs above it. Debug → Appearance → Layout → Tables chooses
Auto, Grid or Paragraph for every chapter (`?tables=auto|grid|flat` with
Debug on). This document is the proposal, its critique, the benchmark
evidence, the recommendation and what shipped.

## What happens today

`parseChapterHtml` turns a `<table>` into one `<p>` whose text is the table's
`textContent` (`shared/parse-html.ts`). The result:

- every cell runs into one paragraph, separated only by the source
  whitespace (minified markup joins cells: `<td>A</td><td>B</td>` reads
  `AB`);
- bold, code, links and highlight marks inside cells are lost, because the
  paragraph is rebuilt from text alone;
- canonical offsets still count the table's text, so a selection in the
  paragraph saves a correct highlight, but the highlight does not show again
  after the chapter is decorated (the marks are dropped with the markup);
- the paragraph breaks across pages like prose, so page counts are stable.

Nothing overflows and nothing is clipped; the content is unreadable rather
than broken. The sanitiser (`epub-resource-utils.ts`) keeps table markup, so
the body cache already holds everything a real table needs.

## The tables that matter

Catalogue of the user's copy of *Systems Performance* (2nd ed.), shapes only:

| Measure | Value |
| --- | --- |
| Tables | 93 in 21 of 55 files; 3.8% of the book's text |
| Density | one per ~20,000 characters on average; one per ~5,800 in the heaviest chapter (14% of its text) |
| Rows | median 10, p90 21, max 49 |
| Columns | 2 (26 tables), 3 (56), 4 (7), 5 (3), 9 (1) |
| Cells | median 30, max 196; cell text median 10 characters, p90 42, max 435 |
| Header | `<thead>` in 92 of 93 |
| Caption | none as `<caption>`; all 93 are `<figure class="table">` with a `<figcaption>` above |
| Spans, nesting | no `colspan`, no `rowspan`, no nested tables |
| Cell content | every cell wraps its text in `<p>`, some cells hold two; code in 20 tables, links in 41 |
| Tables as images | none (the image-only files are figure galleries) |

Typical technical EPUBs add what this book lacks: `colspan` in grouped
headers, an occasional `rowspan`, `<caption>`, and wide reference tables
(option, default, description). Shapes in order of importance:

1. 2–4 columns of short text, 5–25 rows, one header row. Most tables.
2. A tall table (30–50 rows): must break across pages.
3. A wide table (5–9 columns): must stay legible on a 390 px phone.
4. Spanning header cells. Nested tables are rare enough to flatten.

## Constraints from the architecture

- Pagination is measured in a worker with Pretext; the worker has no DOM.
  A table's height must be computed there, not measured in the page, or
  every font or viewport change would need a main-thread round trip.
- Anchors, highlights, search and notes address text by block id and a
  cursor inside a prepared text block, and by canonical offsets per block
  (`blockStarts`).
- Rendered text is native lines (`nowrap` spans and `<br>`) whose breaks the
  worker chose; the page must draw exactly what the worker measured.

## Options

| Option | Reading | Pagination cost | Highlights, search | Risk |
| --- | --- | --- | --- | --- |
| A. Measure real `<table>` HTML in the page | exact browser layout | main-thread layout per table per config; breaks worker-only relayout | needs a DOM-to-offset map | high |
| B. Worker table layout, rows split across pages, header repeated | real grid, legible, prose keeps flowing | Pretext per cell plus a small width pass | each cell is a text block: all existing paths work | medium |
| C. Placeholder that opens the table in a sheet | one tap away; no inline reading | none | in-table highlights and search hits cannot show in the page | low |
| D. Stacked cards on phones (`header: value`) | good for 2-column tables, loses comparison across rows | as prose | synthetic header text is not in canonical text | medium |

Wide tables are the hard case for every option. With B the choices are
horizontal scroll inside the page (conflicts with the swipe that turns the
page), smaller type, or C as a fallback for that table only.

## Proposal

Option B, built first behind Debug → Appearance → Layout → Tables (and
`?tables=grid` for Design ideas and benchmarks):

- **Parse.** A table becomes a `table` block followed by one text block per
  non-empty cell (`td`/`th` tags), in row-major order, so cells are ordinary
  text blocks for anchors, highlights, search and copy. The table takes one
  block number, as the flattened paragraph did, so ids after it do not move.
  Block children of a cell (`<p>`, `<div>`) become line breaks.
- **Layout (worker).** Column widths follow CSS auto layout: min-content (the
  widest word) and max-content (the cell on one line) per column; the table
  fills the page; columns shrink towards min-content when it does not fit.
  Each cell lays out with the existing line breaker at its column width. All
  cells share one line height, so a row is `max(lines) × lineHeight` plus
  padding.
- **Pages.** Rows are the unit. A table moves to the next page when its
  header and first row do not fit. On each continuation page the header rows
  repeat; repeated headers carry no anchors and cannot be selected. A row
  splits at a line boundary (every cell's lines share the grid) when it is
  taller than a page, or when keeping it whole would leave a quarter of the
  page or more empty; a split leaves at least two lines before the break.
  Rows joined by a `rowspan` stay together unless the group is taller than a
  page. A preceding `figcaption` is kept with the table.
- **Too wide.** When min-content widths exceed the page, the table first
  tries narrower cell padding, down to 2 px, and takes the widest that fits.
  If none fits, it keeps min-content widths at full padding and scrolls
  sideways inside its slice; a swipe that starts in such a table scrolls it
  instead of turning the page.
- **Render.** A real `<table>` with `table-layout: fixed`, `<col>` widths
  and row heights from the worker; cells render their lines as paragraphs do.
  Rules use theme variables, so dark mode and paper need nothing new.
- **Cache.** Table mode is part of the chapter artifact key. The body cache
  keeps each chapter's canonical text for Auto's choice (cell starts exist
  only where a chapter reads grids) and its cell count. Paragraph parses
  exactly as before, so books without tables are unaffected.

## Critique

- **Width algorithm drift.** The worker's widths decide line breaks; the
  browser must not re-decide them. Fixed layout plus explicit widths removes
  the browser's choice. The remaining risk is a cell line wider than its
  column by font-measurement error; cells keep 3 px free, the prose line
  breaker's safety plus rounding, and column widths are whole pixels.
- **Repeated headers duplicate text.** Without care they would duplicate
  anchors (a page anchor could point back to the first page of the table) and
  copy text. They are rendered without anchor attributes and are skipped
  when a page picks its anchor.
- **Swipe conflict.** Horizontal scroll inside a paged reader always fights
  the page turn. Limiting it to tables that cannot fit keeps the conflict
  rare; the catalogue decides whether it is rare enough.
- **Scroll mode.** The column reuses page slices, so a long table keeps its
  page splits in the column; repeated header rows are dropped there, so the
  header shows once. The reading place inside a table is its row's first
  cell, so a relayout or a reopen returns to that row, not to the table's
  start.
- **Search, selection and marks.** Cells are text blocks, so search hits,
  selection and highlights map through the same character alignment as
  paragraphs; the DOM side reads each cell's text element.
- **Copy.** Two or more cells copy as tab-separated rows, as a spreadsheet
  takes them; text in one cell, and text around the table, copies as
  paragraphs.
- **Cache rebuild.** Shipping bumps the body cache version once (6 → 7), so
  each book's body cache rebuilds once, on its first open.
- **Mode changes.** Grid and Paragraph give a table the same block id, but
  a cell has an id only in Grid. A reading place saved in one mode maps to
  the other through the table's text (`readTableAnchor`), so a change of
  mode, or of the cap, keeps the place.
- **Rowspan.** Placed correctly; rows joined by a span are kept on one page
  unless the group is taller than a page. No book in hand has one, so this
  path has only synthetic tests.

## Benchmark plan

"Significant delay" is defined before measuring:

- more than **16 ms** added to any page turn's main-thread frame;
- more than **10%** added to chapter preparation or layout on a book without
  tables (target: zero);
- more than **25%** added to the first page of a table-heavy chapter at
  4× CPU, or more than **10%** to a table-free first page;
- memory growth beyond the size of the table text itself.

Measured on the private copy of the book (table-heavy chapters) and on
synthetic chapters at 1×, 5× and 20× the book's average table density, at
390 px (CPU 4×) and iPad sizes, in Chromium and WebKit.

## Results

Production build on one shared 8-core Mac, Chromium at 390 × 844 with the
CPU 4× slower unless noted. Medians of 3–5 timed runs after a warm-up.
Other agents shared the machine (1-minute load average 2–15), so runs were
repeated in alternating Paragraph/Grid rounds. The reopen rows marked
*final* are two such rounds on the final build at a load of 2.3–3.5, the
quietest the machine got. Other rows ran on an earlier build of the
prototype, and a range there covers pairs whose two sides ran at a similar
load of about 4. Paragraph in the prototype build
matched the build before it within noise (same pages and lines; first page
in the table chapter 349 → 346 ms, at 5× density 387 → 382 ms), so Paragraph
is the baseline below.

Books: the user's copy of *Systems Performance* (catalogue above; its
Chapter 15 is the densest for its size, 9 tables and 395 cells in a 105 KB
file),
and the sample book's first chapter run 20 times over (about 227,000
characters) with synthetic tables at 0, 1, 5 and 20 times the book's
average density (0, 11, 55 and 220 tables).

| Measure | Paragraph | Grid | Change |
| --- | --- | --- | --- |
| **No tables** (synthetic, 0×): whole-book decoration / worker prepare / layout | 12.4 / 101.5 / 122.5 ms | 12.6 / 105.4 / 126.6 ms | within noise; same 340 pages |
| No tables: first page on reopen, *final* | 311 ms | 299 ms | none (−4%, noise) |
| No tables, WebKit (no throttle): prepare / layout | 93 / 134 ms | 95 / 130 ms | within noise |
| **Book, Chapter 15**: first page on reopen, *final* | 353 ms | 366 ms | +4% (earlier build: +9% to +21%) |
| Book, Chapter 15: main-thread chapter decoration, *final* | 29 ms | 37 ms | +8 ms (earlier build: +14 ms) |
| Book, Chapter 15: worker prepare + layout, opening chapter, *final* | 85 ms | 93 ms | +8 ms |
| **Book, page turns** (40 turns through Chapter 15): main-thread task that renders the new page, median / p90 / max | 18.0–18.6 / 22.9–23.9 / 27 ms | 18.8–19.9 / 26.4–27.4 / 30 ms | +1 / +3.5 / +3 ms |
| Book, page turns: longest garbage collection in the run | 20 ms | 31–32 ms | +11 ms |
| **Book, whole**: decoration / body-cache build / worker prepare / layout | 177 / 294 / 758 / 845 ms | 198 / 312 / 809 / 876 ms | +12% / +6% / +7% / +4% |
| Book, whole: pages (phone / iPad 820 × 1180) | 2983 / 1954 | 3043 / 1980 | +2% / +1%; 16 of 54 chapters gain 1–8 pages |
| Book, whole: JavaScript heap, main / worker | 12.5 / 106 MB | 13.6 / 112 MB | +1.1 / +6 MB |
| Book, whole, iPad: decoration / prepare / layout | 182 / 764 / 820 ms | 209 / 831 / 876 ms | +15% / +9% / +7% |
| Book, whole, WebKit: decoration / prepare / layout | 237 / 879 / 862 ms | 252 / 868 / 838 ms | +6% / within noise |
| **Synthetic 1×**: first page on reopen | 318 ms | 380 ms | +20% |
| Synthetic 5×: first page on reopen, *final* | 382 ms | 492 ms | +29% (earlier pairs +25% to +42%) |
| Synthetic 5×: chapter decoration / worker prepare + layout, *final* | 46 / 142 ms | 96 / 189 ms | ×2.1 / +33% |
| Synthetic 5×, iPad: first page on reopen | 372 ms | 549 ms | +48% |
| Synthetic 5×, WebKit (no throttle): first page on reopen | 286 ms | 357 ms | +25% |
| Synthetic 5×: page render task median / max | 18.4 / 26.8 ms | 22.6 / 24.9 ms | +4 ms median |
| Synthetic 5×: table chapter pages / worker heap | 260 / 18.3 MB | 381 / 27.0 MB | +47% / +8.7 MB |
| **Synthetic 20×**: first page on reopen | 578 ms | 1117 ms | +93% |
| Synthetic 20×: chapter decoration / worker heap | 117 ms / 29 MB | 388 ms / 62 MB | ×3.3 / ×2.1 |

Two turn runs had load spikes and are left out of the pairs above: a
Paragraph run at a load of 15 (render task median 28 ms, max 42 ms, a 56 ms
task) and a Grid run at 11 (median 28 ms, max 45 ms, an 89 ms task holding an
86 ms collection). Each mode's other runs at a load of about 4 did not
reproduce them.

Where the time goes in Grid: decoration (parsing a chapter's highlighted
HTML into blocks, on the main thread) and the worker's per-cell preparation
grow with the number of cells, and both sit before the first page. A page
turn's cost is React building the new page's DOM, and each cell adds a
`td`, a text element, a line `span` and fragment `span`s where prose adds a
line and its fragments.

### Against the thresholds

- Page turns, at most +16 ms: met on the book (+1 ms median, +3.5 ms p90,
  +3 ms max at 4×) and at 5× (+4 ms median).
- Books without tables, at most +10%, and a table-free first page at most
  +10%: met (no measurable change; Paragraph is unchanged byte for byte).
- First page of a table-heavy chapter, at most +25% at 4×: met on the
  book (+4% on the final build, at most +21% under load) and at 1× (+20%);
  missed at 5× (+29%, iPad +48%) and 20× (+93%).
- Memory no larger than the table text: missed. The book's 93 tables hold
  about 70,000 characters of text, and the worker heap grows by about 6 MB
  (about 85 bytes per character, 65 KB per table) for per-cell blocks, lines
  and fragments.

## Recommendation

Ship with limits. The book in hand reads well and turns pages as before;
books without tables are untouched. The costs that miss the bar grow with
cell count: the first page of a very table-dense chapter and the worker's
memory.

1. Turn Grid on by default for chapters up to a cell cap, and keep
   Paragraph above that until decoration and preparation are cheaper.
   The book's largest chapter holds 530 cells. Cells are a proxy: the
   first-page cost also depends on the chapter's length. Measured further
   in [The cap](#the-cap), which sets it at 1,500.
2. Before that, replace the cache-row flag with one cache version bump, and
   drop repeated headers from scroll mode.
3. Next optimisations, in order of payoff: parse table cells off the main
   thread or lazily per page; share font objects across a cell's fragments
   to cut worker memory and structured-clone work; render a single-line cell
   without its line `span`.

Alternatives considered and not built: measuring real tables in the page
(A) breaks worker-only relayout; a tap-to-open sheet (C) avoids every cost
but loses in-page highlights and search marks; stacked cards (D) need text
that is not in canonical text. C remains the fallback for tables too wide
to scroll comfortably.

## The cap

Auto reads grids in a chapter of up to **1,500** table cells
(`GRID_TABLE_CELL_LIMIT`), measured against the same bar: the first page of
a table-heavy chapter at most 25% slower, page turns at most 16 ms slower.

Method: two production builds of this branch, with the cell limit set to
0 (every chapter reads Paragraph) and to a million (every chapter reads
Grid), each served on its own port, so that neither parses canonical text
again on open. The sample book's first
chapter run 20 times over (about 227,000 characters) with 11 to 55
synthetic tables (`test/e2e/kit/table-book.ts`, `KIT_TABLE_COUNT`). First
page on reopen (`test/e2e/kit/reader-reopen-trace.ts`), Chromium at
390 × 844 with the CPU 4× slower, in Paragraph/Grid pairs that alternate
which goes first; 4 rounds of a warm-up and 5 timed runs, 24 samples a side.
Other agents loaded the machine (1-minute load average 2–21, once 31), so
the table gives the median and the 25th percentile, which is less
disturbed by load.

| Cells (tables) | Paragraph, median / p25 | Grid, median / p25 | First page | Decoration + worker, opening chapter |
| --- | --- | --- | --- | --- |
| 717 (11) | 353 / 341 ms | 428 / 418 ms | +21% / +22% | +20 + 26 = +46 ms |
| 1,114 (17) | 418 / 396 ms | 451 / 407 ms | +8% / +3% | +24 + 18 = +42 ms |
| 1,511 (24) | 405 / 342 ms | 475 / 408 ms | +17% / +19% | +32 + 33 = +65 ms |
| 2,515 (38) | 489 / 378 ms | 605 / 476 ms | +24% / +26% | +59 + 41 = +100 ms |
| 3,634 (55) | 498 / 416 ms | 604 / 537 ms | +21% / +29% | +67 + 42 = +109 ms |

iPad (820 × 1180, 4×, 2 rounds, 12 samples a side, load 13–19): 717 cells
+17% / +11%, 1,511 cells +5% / +8%, 2,515 cells +26% / +35%.

Page turns at 1,511 cells (40 turns from the chapter's start, 2 runs a side
at load 17–31, `kit frames`): the main-thread task that renders the new page
had a median of 26 ms in Paragraph and 20–26 ms in Grid, and Grid's longest
task in any turn was 34 ms. Paragraph runs held 77–983 ms tasks from load
that Grid runs did not, so no page-turn cost is measurable: within +16 ms.

The first-page time is noisy at this load (1,114 cells measured cheaper than
717), but its two parts grow steadily with cells: about +65 ms at 1,500
cells and +100 ms at 2,500, on a first page of 340–420 ms. 1,511 cells
passes on the phone and the iPad; 2,515 reaches the limit on the phone and
misses it on the iPad. The cap sits at 1,500, the largest round count
measured to pass. The book in hand stays well inside it (its largest
chapter holds 530 cells).

## What ships

- Parse (`shared/parse-html.ts`): in a chapter that reads grids, a
  `<table>` becomes a `table` block (rows, cells, spans, header rows, simple
  `align`/`valign` and inline alignment) and one `td`/`th` text block per
  non-empty cell. A `<caption>` becomes a `figcaption` block kept with the
  table. Canonical text is the same in both modes, so highlights, notes and
  search offsets do not move. The table block also keeps the paragraph that
  Paragraph mode would read (one more copy of the table's text), and that
  paragraph keeps where each cell starts; both map a reading place between
  modes.
- Layout (`shared/layout-table.ts`): column widths in whole pixels from
  min- and max-content, narrower padding for a table that misses the page
  by a little, cells laid out with the prose line breaker, rows broken
  across pages as above. Each page gets one `TableSlice` with its
  rows and cells; `textSlicesOf` gives the cells to every path that reads
  page text (anchors, selection, notes, page-break selection, search).
- Render (`PageSliceView.tsx`): a fixed-layout `<table>` per part with
  `<colgroup>` widths and row heights, named by its caption (`<caption>`, or
  the `figcaption` of its `<figure>`). A too-wide part scrolls sideways
  (`data-reader-table-scroll`): taps and swipes there do not turn the page,
  and it is a focusable, named region whose arrow keys scroll it to its edge
  before they turn the page. Scroll mode uses the same slices and shows a
  header once.
- Choice (`data/chapter-tables.ts`, `tables-preference.ts`,
  `TablesRow.tsx`): Auto by chapter cell count; Debug can choose Grid or
  Paragraph for every chapter. The body cache stores each chapter's
  canonical text as Auto parsed it, and which way that was; a choice that
  differs parses again only the chapters it changes. So a new
  `GRID_TABLE_CELL_LIMIT` stays correct, and a body cache version bump with
  it saves the chapters it moves from parsing again on each open.
- Copy and selection: copying two or more cells gives tab-separated rows
  (`resolveCanonicalRangeText`); a triple-click in a cell selects the cell.

## Not covered

- Nested tables (none in the book) lay out as text inside the outer cell.
- Images inside cells are dropped, as the flattened paragraph did.
- Publisher table styles: rules, backgrounds, widths and alignment from
  class rules are ignored. Cell alignment comes only from `align`,
  `valign` and inline `text-align`/`vertical-align` on the cell, its row or
  its row group; `justify` reads as left.
- The caption is a block before the table, not part of the `<table>`
  element; the table takes its text as its accessible name instead.
- A reading place in a grid cell maps to the start of that cell's text in
  Paragraph mode, not to the exact character.
- The tap-to-open sheet (option C) is not built; a very wide table only
  scrolls in place.
- Not measured: a real iPad or iPhone (WebKit ran unthrottled on the Mac),
  and books with `colspan`/`rowspan` beyond the synthetic ones.

## Decisions

1. Default: Grid for everyone, with a cell cap per chapter. Decided.
2. The cap: 1,500 cells, from [The cap](#the-cap). Decided.
3. Very wide tables: sideways scrolling for now. The tap-to-open sheet
   (option C) for tables that overflow is still open.
4. Copy from a table: tab-separated rows. Done.
5. One body-cache rebuild per book on the next release (version 6 → 7).
   Accepted.
