# Card Markdown in a worker, Mermaid with Pele — 9 November 2026

## Changes

- Card Markdown renders in a Web Worker (`src/lib/markdown`), not on the
  main thread during React's render. The first load no longer includes
  remark, KaTeX or a highlighter.
- KaTeX and the highlighter load in the worker only for cards that need them.
  KaTeX's CSS loads with the first card that has maths, before that card
  shows.
- `@pierre/highlights` 0.4.0 replaces `rehype-highlight` (highlight.js) and
  `@highlightjs/cdn-assets`. Code has Rosé Pine Dawn colors in the light
  theme and Rosé Pine Moon, the earlier colors, in the dark theme.
- `pele` 1.6.0, as in Med, draws ```` ```mermaid ```` blocks on review, in
  the card form's Preview and in Elements.
- The card form has a Preview toggle: both sides as review shows them. A tap
  on a side, outside its links and buttons, returns to its text.
- Small fixes: display maths and other text outside `p` and `li` use the
  foreground color in the dark theme; a wide table scrolls in the card; web
  links open in a new tab; a link with another scheme (`javascript:`,
  `data:`) or a relative path is inert text, where it was a live link
  before.

`decode-named-character-reference` and `hast-util-from-html-isomorphic` are
direct dependencies only so that `vite.config.ts` can alias their non-DOM
builds for the worker, as Med does. Both were already in the tree.

## Parity

The old pipeline and the new renderer gave the same text and element
structure for 237 distinct card sides: the 160-card benchmark set (8 kinds),
the Elements samples and 19 edge cases (footnotes, task lists, autolinks,
entities, raw HTML, `\(…\)`, unclosed `$`, ```` ```math ````, cloze markers,
relative and data images). Highlight spans, the table wrapper and link
attributes were excluded. Two differences found on the way were fixed:
`$$` blocks and ```` ```math ```` fences.

## Measurements

Production builds of `020f62b2` (before) and this branch (after), served by
`vite preview`. Apple silicon Mac, Chromium from Playwright, service
workers blocked. The machine ran other sessions' work; the load average is
given with each pair.

Bundle (`dist/index.html`'s scripts and styles):

| | Before | After |
|---|---:|---:|
| First load, minified | 1,724 kB | 1,092 kB |
| First load, gzip | 510 kB | 323 kB |
| Vendor chunk | 1,368 kB | 749 kB |
| All JS and CSS (lazy included) | 2,242 kB | 3,446 kB |
| Precache | 2,139 KiB | 3,315 KiB |

The lazy total grows: the worker (192 kB), KaTeX in the worker (431 kB),
the highlighter with its WebAssembly (475 kB) and Pele's diagram types. A
device downloads them once, at install.

Timings with `bun run kit time`, the 160-card set from
`tests/kit/markdown-cards.ts` (fixed card IDs, so both builds show the same
cards), CPU 4× slower:

| Measure (median of runs) | Before | After | Load |
|---|---:|---:|---:|
| Phone, navigation to first card painted (10 runs) | 340 ms | 221 ms | 6 |
| Same, second pair | 523 ms | 404 ms | 13–20 |
| Main-thread blocking in the first 3 s (6 runs) | 61 ms | 0 ms | 11–15 |
| Same, second pair | 35 ms | 0 ms | 6–8 |
| Desktop, Good to next card painted (30 runs) | 34 ms | 37 ms | 31–38 |
| Same, second pair | 25 ms | 34 ms | 31–34 |

Grade to next card did not change measurably. The machine load during that
pair was high, and both builds paint the next card from a cache.

```sh
cd apps/spaced2 && bun run build && vite preview --port 5265
E2E_PORT=5265 bun run kit time / --before apps/spaced2/tests/kit/markdown-cards.ts \
  --steps apps/spaced2/tests/kit/review-first-card.ts --throttle 4 --runs 10 --warmup 2
```

Other steps: `review-next-card.ts` (with `--desktop`) and
`review-long-tasks.ts`.

## Limits

- A card shows empty for the worker's first render, a few milliseconds,
  when it was not preloaded: the first card on open, and a card just edited.
- Pele fits a diagram to the card's width. A tall diagram scrolls in the
  card; Full screen shows it larger.
- Without a worker, or when a render fails, a card shows its source text.
  A failed render is not cached; the card's next request tries again.
