# Highlights rendering performance

This document records the Highlights performance model, measured results,
implemented optimizations, and possible follow-up work. Most of it is about the
mosaic. In October 2026 a list replaced the mosaic; see
[The list that replaced the mosaic](#the-list-that-replaced-the-mosaic).

## The list that replaced the mosaic

The Highlights page is now a list of books (or days), each beside its passages.
`HighlightSections.tsx` virtualizes it as Med's session thread does:

- Rows render only within 1200 px of the view. Spacers hold the space of the
  other rows.
- A row takes its height from when it last rendered. Before that, Pretext
  estimates the height of its text from sizes read from a hidden sample entry.
  Entries without an estimate get a rough one from their length, and Pretext
  measures them in idle time.
- Browser scroll anchoring is off. The first row in view keeps its place when
  heights above it change.
- Heights and the last annotations outlive the page. When you come back from
  a book, the page has its full height at once, so the window scroll returns
  to the same row.

Medians of five runs of the harness in `scripts/highlights-performance`, on one
machine, with 900 highlights: the mosaic at the commit before the change, and
the list after it. Both harnesses mount the app's settings and sync providers,
which the page header needs. The mosaic's settled time includes its entrance
animation.

| Fixture  | Page   | First highlight | Settled | Longest task | Rendered highlights | DOM elements |
| -------- | ------ | --------------: | ------: | -----------: | ------------------: | -----------: |
| 20 books | Mosaic |          309 ms |  726 ms |        92 ms |                  10 |          552 |
| 20 books | List   |          268 ms |  286 ms |         none |                  14 |          289 |
| 1 book   | Mosaic |          373 ms |  787 ms |       165 ms |                  10 |          284 |
| 1 book   | List   |          264 ms |  285 ms |         none |                  18 |          337 |

"None" means no task of 50 ms or more before the page settled.

## User-visible problem

The production Highlights page has a noticeable delay with about 450
highlights. A standalone benchmark harness reproduces the delay with 900
deterministic highlights. It is not mounted in the production application.

The entrance animation is still active at high counts. The browser does not
show most of its intermediate frames because long main-thread work blocks
painting. With five highlights, the browser shows the animation normally.

The quality target is not only a lower load time. The first viewport must feel
settled:

- Visible tiles must not move after they appear.
- Scroll position must not jump when more tiles mount.
- The first visible content must appear promptly.
- The entrance animation must receive real paint frames.
- Fast scrolling must not expose empty gaps.

## Current test fixture

`scripts/highlights-performance/fixture.ts` creates 900 unique highlights. It
uses 20 books with 45 highlights per book by default. The single-book benchmark
puts all 900 highlights in one book. The fixture seeds the standalone harness's
isolated IndexedDB. It does not add data to the production application.

The fixture repeats sentence structures but appends one unique word to every
highlight. This exercises Pretext's unique-segment path while keeping the input
deterministic.

Run the production build and both distributions with:

```sh
bun run benchmark:highlights
```

The benchmark now covers:

1. 900 unique highlights split across several books.
2. 900 unique highlights in one book.

A future fixture should match the approximate text-length and book distribution
of the current 450-highlight production collection.

The single-book case is important. Virtualizing complete book sections can
improve the first case without improving one very large mosaic.

## Original measured production-build result

These historical measurements were collected before the benchmark moved to its
standalone folder. The now-removed application route used the same fixture and
production component.

Test scope:

- Former route: `/debug/highlights-performance`
- Fixture: 900 highlights, 20 books
- Viewport: 1280 x 720
- Build: Vite production preview
- Browser: headless Chromium
- CPU throttling: none

The animation trace found:

- At about 48 ms, all 900 highlight `<article>` elements existed.
- Eight initial-viewport tiles had Motion wrappers at opacity `0`.
- A main-thread task then ran for about 497 ms, followed by another task of
  about 123 ms.
- The next useful animation sample arrived at about 689 ms. Opacity was already
  about `0.953`.

A later CPU and browser trace gave this approximate breakdown:

| Work                                                            | Approximate time |
| --------------------------------------------------------------- | ---------------: |
| JavaScript function calls, including React and application work |           514 ms |
| Browser style calculation                                       |           107 ms |
| Browser layout                                                  |           110 ms |
| Pretext `prepare()` call stack                                  |            63 ms |
| Pretext `layout()` call stack                                   |           3.5 ms |
| Relative-date formatting                                        |            44 ms |

These durations overlap. Do not add them to calculate total load time. CPU
sampling is also approximate.

The trace showed that Pretext was measurable but was not the dominant cost in
the original repeated-text fixture. React card construction and the browser's
DOM, style, and layout pipeline became the first optimization target.

## Implemented five-run comparison

Each row is the median of five fresh Chromium contexts against a production
build at 1280 x 720 with no CPU throttling. Each stage includes the previous
stage.

Correctness note: the original section, tile, and entrance-stage runs used
stale 520 px virtual-section estimates after exact geometry became available.
The mosaic children overflowed those estimates, so adjacent books could
overlap. Those rows remain useful as historical CPU comparisons, but they are
not valid settled-layout results. The corrected final result appears below.

### Time to first highlight DOM

| Stage                                           | 20 books x 45 | Contribution | 1 book x 900 | Contribution |
| ----------------------------------------------- | ------------: | -----------: | -----------: | -----------: |
| Baseline                                        |      643.7 ms |            - |     684.4 ms |            - |
| Separate geometry model                         |      592.2 ms |     -51.5 ms |     688.1 ms |      +3.7 ms |
| Virtualize book sections                        |      301.7 ms |    -290.5 ms |     694.3 ms |      +6.2 ms |
| Virtualize mosaic tiles                         |      266.5 ms |     -35.2 ms |     341.5 ms |    -352.8 ms |
| Remove forced viewport read and settle entrance |      266.1 ms |      -0.4 ms |     329.3 ms |     -12.2 ms |

The small regressions in the single-book geometry and section stages are within
run-to-run noise. Those stages do not reduce the single book's card count.

### Longest main-thread task

| Stage                                           | 20 books x 45 | Contribution | 1 book x 900 | Contribution |
| ----------------------------------------------- | ------------: | -----------: | -----------: | -----------: |
| Baseline                                        |        483 ms |            - |       531 ms |            - |
| Separate geometry model                         |        439 ms |       -44 ms |       531 ms |         0 ms |
| Virtualize book sections                        |        142 ms |      -297 ms |       541 ms |       +10 ms |
| Virtualize mosaic tiles                         |        109 ms |       -33 ms |       190 ms |      -351 ms |
| Remove forced viewport read and settle entrance |        103 ms |        -6 ms |       178 ms |       -12 ms |

### Final visible behavior

| Metric                           | 20 books x 45 | 1 book x 900 |
| -------------------------------- | ------------: | -----------: |
| First highlight DOM              |      250.1 ms |     320.0 ms |
| First visible animation progress |      271.8 ms |     347.2 ms |
| Visible animation frames sampled |            30 |           30 |
| First viewport fully settled     |      654.7 ms |     730.0 ms |
| Mounted highlight cards          |            10 |           10 |
| Total DOM elements               |           613 |          345 |
| Long-task total                  |        100 ms |       227 ms |
| Longest task                     |        100 ms |       177 ms |

The baseline sampled zero intermediate entrance frames. Its visible viewport
jumped to the end state at about 796.6 ms for the multi-book case and 833.2 ms
for the single-book case. The corrected final version begins visible motion at
271.8 ms and 347.2 ms respectively.

The final settled time includes the complete intentional 240 ms entrance plus
up to 175 ms of deterministic stagger. The tile-virtualization stage settled at
290.0 ms and 366.9 ms only because the blocked entrance remained invisible.

Compared with baseline, the corrected final version reduces time to first
highlight DOM by 61.1% for the multi-book case and 53.2% for the single-book
case. It reduces the longest task by 79.3% and 66.7%, respectively.

All ten corrected validation runs kept visible cards mounted and found no
overlap between mounted book sections at the initial and midpoint positions.
Direct book navigation landed at the intended 112 px desktop offset.

### Debounced search input

The search field keeps its draft value local and applies the query after 100 ms
without input. This prevents every keystroke from rebuilding the filtered
geometry while keeping the input itself immediate. Clearing the query still
applies immediately.

A separate three-run production-build diagnostic typed a ten-character query
with 35 ms between keystrokes. It measured the delay from each input event to
the next animation frame:

| Viewport and distribution |   Before |  After | Improvement |
| ------------------------- | -------: | -----: | ----------: |
| 390 px, 20 books x 45     |  69.6 ms | 6.8 ms |       90.2% |
| 390 px, 1 book x 900      | 124.5 ms | 7.3 ms |       94.1% |
| 740 px, 20 books x 45     |  71.5 ms | 7.6 ms |       89.4% |

This change improves typing responsiveness. It does not change the initial page
load path. The final filtered layout still runs once after the debounce.

## Original forced layout in the entrance path

Before this work, `useInitialMosaicViewportRange()` ran after the complete
mosaic DOM was committed. It called `getBoundingClientRect()` and then updated
React state in a layout effect.

This sequence has two costs:

1. `getBoundingClientRect()` forces the browser to calculate layout for the
   large mounted page. The profiled call used about 100 ms.
2. The state update causes another synchronous React render before the browser
   can paint.

The read is not the root problem by itself. It is expensive because the page
has already mounted every highlight. Moving the same read to another hook does
not remove the work.

## Implemented optimization direction

The implementation bounds the React tree and rendered DOM. The existing
deterministic bento geometry remains the source of truth.

### 1. Separate geometry from rendered cards

The layout model contains each book section's exact height and each
tile's existing `top`, `left`, `width`, and `height`. Calculating geometry must
not require mounting every `HighlightQuoteCard`.

This keeps the final scrollbar and tile positions stable while React renders
only the required cards.

### 2. Virtualize book sections

TanStack Virtual is the window range and scroll-observation layer. It uses
stable book IDs and exact section heights from the layout model. Render the
viewport plus a small measured overscan.

The virtualizer can cache the temporary 520 px estimates used before fonts and
text geometry are ready. The implementation resets that cache once for each
new set of exact section sizes. The benchmark rejects overlap between mounted
book sections.

Do not use TanStack Virtual's masonry lanes. They do not model the current
one-column and two-column spans, fixed book tiles, and filler placements.

Book-section virtualization produces the largest multi-book gain. It does not
improve one book with hundreds of highlights by itself.

### 3. Virtualize tiles inside large mosaics

The full mosaic container keeps its exact calculated height. React renders only
placements that intersect the visible local range plus overscan. A tile that
spans a range boundary must remain mounted.

This stage bounds the DOM even when one book contains all 900 highlights.

### 4. Remove the pre-paint viewport state update

The virtualizer now owns the visible range. The implementation removed
`useInitialMosaicViewportRange()` and derives the initial entrance range from
the virtualizer's scroll offset and item positions.

Only the first mounted viewport set animates. Tiles mounted later during scroll
appear in their settled state. A CSS animation starts after one committed paint
and remains compositor-driven.

## Work not selected in this pass

The current evidence does not justify these changes yet:

- Do not move Highlights Pretext work to a worker yet. The Reader worker proves
  that worker-based Pretext is possible, but it would not improve the React and
  DOM work already addressed here.
- Do not replace the bento packer with TanStack Virtual masonry lanes.
- Do not add an arbitrary animation delay. It moves the animation after the
  blocking task but increases visible latency and can fail on slower devices.
- Do not treat `content-visibility` as the main solution. It can reduce browser
  layout work, but it does not bound React card construction.
- Do not start with small card-level memoization changes. Measure them only if
  structural virtualization leaves material React work.
- Keep a dedicated single-column renderer as a later experiment. Narrow phone
  widths do not need bento packing, but the current mobile interaction breakpoint
  also includes wider multi-column layouts. Compare a linear virtual list against
  the current renderer before changing the product layout.

## Worker decision

Profile the remaining unique-text work before adding a worker. Consider a
Highlights layout worker only if Pretext is a material part of the remaining
critical path.

The Reader's worker font-loading and Pretext setup is the reference
implementation. A Highlights worker must return deterministic geometry that
matches the displayed fonts. It must not cause a later height correction or a
visible layout shift.

Worker work and virtualization solve different problems:

- A worker keeps text measurement off the UI thread.
- Virtualization reduces React, DOM, style, and layout work.

They can be combined if measurements justify both.

## Acceptance measurements

For each fixture, record:

- Time to first visible highlight.
- Time until the first viewport is settled.
- Long-task durations before settled content.
- React render and commit duration.
- Pretext prepare and layout duration.
- Browser style, layout, and paint duration.
- Mounted highlight and total DOM element counts.
- Number and timing of visible entrance-animation frames.
- Scroll-position error during initial load, filtering, resize, and direct book
  navigation.

Compare a baseline against these isolated experiments:

1. Main-thread Pretext with virtualized React and DOM.
2. Worker Pretext with the current complete React and DOM tree.
3. Worker Pretext with virtualized React and DOM, only if both earlier results
   show independent gains.
