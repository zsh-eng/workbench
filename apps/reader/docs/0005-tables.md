# Tables in Reader

Status: prototype behind a Debug switch. This document is the proposal, its
critique, and the benchmark evidence for the decision.

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

Option B, behind Debug → Appearance → Layout → Tables (and `?tables=grid` for
Design ideas and benchmarks):

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
  taller than a page splits at a line boundary (every cell's lines share the
  grid). A preceding `figcaption` is kept with the table.
- **Too wide.** When min-content widths exceed the page, the table keeps
  min-content widths and scrolls sideways inside its slice; a swipe that
  starts in such a table scrolls it instead of turning the page.
- **Render.** A real `<table>` with `table-layout: fixed`, `<col>` widths
  and row heights from the worker; cells render their lines as paragraphs do.
  Rules use theme variables, so dark mode and paper need nothing new.
- **Cache.** Table mode is part of the chapter artifact key and of the body
  cache (cell starts exist only in table mode). Flat mode is unchanged byte
  for byte, so books without tables, and the default, are unaffected.

## Critique

- **Width algorithm drift.** The worker's widths decide line breaks; the
  browser must not re-decide them. Fixed layout plus explicit widths removes
  the browser's choice. The remaining risk is a cell line wider than its
  column by font-measurement error; lines are measured with the same 2 px
  safety the prose uses.
- **Repeated headers duplicate text.** Without care they would duplicate
  anchors (a page anchor could point back to the first page of the table) and
  copy text. They are rendered without anchor attributes and are skipped
  when a page picks its anchor.
- **Swipe conflict.** Horizontal scroll inside a paged reader always fights
  the page turn. Limiting it to tables that cannot fit keeps the conflict
  rare; the catalogue decides whether it is rare enough.
- **Scroll mode.** The column reuses page slices, so a long table keeps its
  page splits and repeated headers in the column. Acceptable for a
  prototype; a shipped version should drop repeats in scroll mode.
- **Copy.** Cells are blocks, so copied text separates cells with blank
  lines, not tabs. Acceptable for a prototype.
- **Cache rebuild.** Turning the switch rebuilds the body cache once per
  book (cell offsets). A shipped version would bump the cache version once.
- **Rowspan.** Placed correctly; rows joined by a span are kept on one page.
  No book in hand has one, so this path has only synthetic tests.

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
