# File opening: compact worker output and earlier dispatch

The second pass improves the first opening of a file. It does not change the
Java/C++ token classifications or claim full Shiki parity.

## Results

Five alternating rounds, retained production builds, Apple M1 Pro, Chromium
153.0.8010.12, Tokyo Night. Each first opening uses a fresh browser context.
The baseline is the previous optimization (`cba593c`), not Shiki. Sources are the
same pinned Bun C++ and OpenJDK Java files used in the first pass.

| Source       | Before: colored view | After: colored view | Before: plus two frames | After: plus two frames | Before: reopen | After: reopen |
| ------------ | -------------------: | ------------------: | ----------------------: | ---------------------: | -------------: | ------------: |
| Bun C++      |              98.0 ms |             52.0 ms |                130.2 ms |                84.9 ms |        29.3 ms |       31.1 ms |
| OpenJDK Java |              97.5 ms |             56.2 ms |                130.8 ms |                89.5 ms |        31.4 ms |       32.7 ms |

All values are medians. Colored-view latency fell by 47% for C++ and 42% for
Java. The measurement with two extra frames fell by 35% and 32%. Reopening
showed no improvement; the small increases need more samples to distinguish
noise from a regression. This is a local five-sample comparison, not a general
latency guarantee. All 20 first openings and 20 reopens completed without page
errors. No trace recording ran during these timing samples.

The first-open timer starts when an already fetched file response is released.
It excludes app startup and Git reading, so it is not full click-to-open latency.
Language descriptor loading can overlap that read. The end condition and two
extra frames are unchanged from the first pass. Cold results from different
runs should not be compared directly; the table uses paired builds in one run.

Reopen timing starts immediately before a programmatic click on an existing
file tab, after returning to Changes. It includes a fresh host read and waits
for colored tokens in the main pane. It accepts a cached syntax result and
does not require another worker reply. Reopen and first-open timers have
different starting points; compare each only with its own baseline.

## What changed

1. The adapter exposes styled tokens without first building HAST. File workers
   send compact text runs with style indices. Diff rendering keeps its existing
   transforms and transport.
2. The pool decodes only current results. It exposes a normal line array with
   lazy entries, so only requested lines create render nodes. Accessed lines are
   cached. Tokenization still reads the entire file, preserving multiline state.
3. Language descriptors load during file I/O. Highlighting starts when file
   bytes arrive, before the React view mounts. Pierre joins requests for the
   same file identity. Worker dispatch moved from median 26 ms to 4–5 ms after
   response release. The main thread no longer loads a second copy of a worker's
   grammar unless fallback rendering needs it.
4. The active file flushes its render when highlighting completes, avoiding an
   extra queued frame. Completion for a replaced or unmounted file is ignored.
   Initial target positioning and normal cache/freshness rules remain intact.

For the pinned files, JSON payloads changed as follows with token selection off:

| Source       |  Full HAST JSON |  Compact JSON |     Reduction |
| ------------ | --------------: | ------------: | ------------: |
| Bun C++      | 1,356,467 bytes | 114,242 bytes | 11.9× smaller |
| OpenJDK Java | 1,629,641 bytes | 124,361 bytes | 13.1× smaller |

With token selection on, reductions are 13.3× and 14.7×. These are transfer-size
ratios, not UI speedups. The compact result expands to exactly the same complete
HAST for both corpus files with token selection on and off. Diagnostic Chrome
traces were collected separately; the performance marks show early dispatch
and worker completion while preserving the original visible-view end condition.

## Validation

- 18 integration cases cover Shiki fixture parity and compact-output equivalence,
  including dual themes, three line endings, blank lines, token offsets, diff
  decorations, and out-of-order line access.
- 80 browser cases cover full-file navigation, distant multiline state with a
  real worker, file switching, live file/diff themes, and application navigation.
  A production-wired App test changes file contents between tab openings and
  checks that the new text is highlighted. Only the host boundary is mocked.
- 59 existing adapter, language, prefetch, and file-workspace checks pass.
- Both complete corpus files produce identical expanded HAST in both token
  selection modes. Build, typecheck, lint, and changed-file formatting pass.

The [raw results](file-opening-second-pass-results.json) contain every sample,
phase, source hash, build asset hash, and payload comparison. See the
[Java/C++ report](JAVA_CPP_HIGHLIGHTING.md) for known Shiki classification gaps.

## Reproduce

From `apps/med`, retain each production web build under
`.benchmarks/language-ui/<label>/web`, then run:

```sh
node scripts/benchmark-language-ui.mjs --skip-build --builds=previous,twinkleplop --rounds=5
bun scripts/measure-file-payload.ts
```

The runner always measures reopening after the first opening. It alternates
build order and cleans up its private host, repository, and browser. Use
`--profile --rounds=1` for a separate diagnostic trace run. Preserve
`results.json` before another ordinary timing run. Traces are local artifacts
under `.benchmarks/language-ui`; do not use profiled timings as benchmark results.
