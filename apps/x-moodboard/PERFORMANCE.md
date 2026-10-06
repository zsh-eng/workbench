# Performance record

Measured on 6 October 2026 with `node scripts/perf.mjs` against the production
build (`bun run build && bun run start`) and the real library.

| Item | Value |
| --- | --- |
| Machine | Apple M1 Pro, 8 cores, 16 GB, macOS 27.0.1 |
| Machine load during the run | 4.5–6.7 (other work was running) |
| Browser | Chromium 147 through Playwright, new headless mode |
| Viewport | 1440 × 900, device scale 1 |
| Library | 1,553 posts, snapshot `20261006T003951Z-ea1f363893` |
| Cache | Cold load: empty browser context. Other runs: warm |

Raw summary and a Chrome trace of the scroll run are written to
`perf.local/` (ignored by Git; the trace contains private post text).

## Results

| Target from the brief | Measured | Result |
| --- | --- | --- |
| Usable library within 2 s, cold | First cards in the DOM 210 ms after navigation; library JSON 413 KB gzip, fetched in 5 ms | Met |
| Initial image requests scale with the viewport | 18 image requests for 1,553 posts | Met |
| Search p95 under 100 ms, input to visible result | Keystrokes: p50 13.2 ms, p95 19.8 ms, max 44.7 ms (n = 71) | Met |
| Filter p95 under 100 ms | Facet toggles: p50 14.4 ms, p95 20.6 ms, max 22.3 ms (n = 48) | Met |
| No recurring tasks over 50 ms during rapid scroll | 0 long tasks; 0 of 1,307 frames over 50 ms; frame interval p50 8.3 ms, p95 9.5 ms | Met |
| Bounded DOM during scroll | At most 41 cards and 758 elements mounted over 110,000 px of scrolling | Met |
| No growth over repeated open/close | 40 cycles: DOM nodes 821 → 845 → 845, listeners 292 → 292 → 292, heap 7.2 → 7.7 → 7.8 MB (after forced GC at 0, 20, 40) | Met |
| — | Card click to sharp detail image: p50 142 ms, p95 191 ms | Recorded |

## Method

- **Search and filters.** Real key and mouse events through Playwright, 110 ms
  between keys. A page script records the event timestamp, the moment the
  rendered query changes (MutationObserver on `main[data-rendered-query]`),
  and the next frame after it. Keystrokes whose result was superseded by the
  next key are not counted; stale work is skipped by design (`useDeferredValue`).
- **Scroll.** `scrollBy` 180, 260 and 400 px per animation frame: down the whole
  library, up, and down again. A `longtask` PerformanceObserver and frame
  intervals are recorded in the page.
- **Open/close.** Click a card, wait for the sharp image, step to the next post,
  press Escape, repeat. DOM counters come from the Chrome DevTools Protocol
  after a forced garbage collection. The harness uses locator waits: an earlier
  version used `waitForSelector`, whose element handles kept closed views alive
  and looked like a leak.

## Limits of this evidence

- Headless Chromium frame callbacks are not display frames. These numbers do not
  prove 60 or 120 frames per second on a screen.
- One machine and one browser engine. Safari and Firefox were not measured.
- The first measurement method dispatched synthetic input events and polled with
  `requestAnimationFrame`; headless Chromium delayed frames for up to 470 ms
  with no long tasks. The browser's Event Timing API agreed with the real-input
  method (p95 32 ms input to next paint, handler work at most 3.6 ms), so the
  synthetic method was replaced.
