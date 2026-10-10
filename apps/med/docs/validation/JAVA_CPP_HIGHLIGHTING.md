# Java and C++ highlighting: parity and speed

med now has local Java and C++ language modules built on Twinkleplop core 0.2.1.
They load through the normal language registry and syntax worker. Shiki remains
a development reference; the production build rejects Shiki engines and language
grammars in its output.

## What is tested

The integration test runs the production language loader, adapter, and Pierre
1.4.3 file/diff renderers against Shiki 4.4.3 with its JavaScript regex engine.
This is the engine used by med's earlier Shiki build, not an Oniguruma benchmark.
The reference version is pinned. Upgrades require a new comparison.

Six original fixtures cover declarations, generics, annotations, Javadoc,
text blocks, macros, continued lines, numeric prefixes/suffixes, and C++ raw
strings with custom delimiters. The checks use GitHub Light, GitHub Dark, and
a diagnostic theme, with LF, CRLF, and CR input. Both diff sides are checked.
Additional cases verify that incomplete code, Unicode, and long lines retain
their source text. Browser tests exercise the real syntax worker and file UI.

The comparator checks source text and line boundaries, then merges adjacent
runs with identical visible styles. Different HTML span boundaries do not cause
a failure. Foreground ink and bold/italic on whitespace without decoration are
not visible and are normalized; whitespace text, backgrounds, and decorations
remain part of the comparison. The browser check retains the original markup
and uses med's Geist Mono font. It allows a channel difference of 12 and at most
0.05% differing pixels for rasterization and span-boundary rounding. **Every
non-whitespace style difference still fails, regardless of the pixel score.**

Each comparison writes Shiki/Twinkleplop screenshots, a pixel difference image,
and exact mismatched ranges with source lines and columns. The HTML report has
side-by-side previews. Large-file previews show the first 80 lines; their JSON
comparison covers the complete source. Timings run after comparison work ends.

## Reproduce

Run from `apps/med`:

```sh
bun run test:highlighting
bun run compare:highlighting --fixtures-only

# Optional: download the two pinned upstream files into an ignored directory.
bun scripts/fetch-highlighter-corpus.ts
bun run compare:highlighting --benchmark

# Diagnostic run: retain reports and timings even when parity fails.
bun run compare:highlighting --benchmark --report-only

# Separate production builds and hosts; the user's running host is not changed.
bun run build
node scripts/benchmark-language-ui.mjs
```

The normal comparison exits unsuccessfully on any mismatch. `--report-only`
only changes the exit code; failing comparisons remain marked as failures.
There is no automatically accepted baseline and no mismatch allowlist.

Reports are written to `.benchmarks/language-parity/results/comparison.html`
and `results.json`. Production UI results and screenshots are under
`.benchmarks/language-ui`. Each browser, worker, and temporary host is closed
after the run. The temporary Git repository for UI measurement is removed.

The corpus manifest records exact upstream commits and SHA-256 hashes. The
fetch command rejects a hash mismatch. Bun's source retains its upstream license;
OpenJDK's source retains its GPLv2 with Classpath exception header. These files
stay in the ignored benchmark directory and are not shipped with med. No source
from their language grammars was copied into the production implementation.

## Scope and current limits

**This is useful Java/C++ highlighting, not complete Shiki parity.** The six
focused fixtures pass. Whole-file comparisons against Bun `BunObject.cpp` and
OpenJDK `ArrayList.java` still fail and remain visible in the report.

The lexical scanner uses native Twinkleplop states. Context passes classify
names, type parameters, and declarations with bounded lookahead. They do not
build a complete syntax tree or expand macros. Remaining differences include
ambiguous C++ type/value contexts, pointer and attribute scopes, Java contextual
keywords, nested documentation constructs, and detailed TextMate parent scopes.
Java Unicode escapes are not preprocessed as a compiler would preprocess them.
An exact match under three themes does not establish equivalence under every
theme. Changes to the adapter's scope mapping can affect other languages; the
existing adapter checks are also run.

These limits matter for the performance comparison: Twinkleplop currently does
less detailed classification than Shiki. The measurements do not establish an
equivalent-quality replacement for every Java or C++ file.

## Performance method

- **Tokens:** warm tokenization of the full source, with no result cache.
- **Pierre file/diff:** warm production renderer output, including tokenization,
  styles, line metadata, and word-change markers. The diagnostic comparison uses
  no long-line cutoff. Diff parsing is outside the timed region. This stage does
  not include DOM layout or paint.
- **File opening:** fresh browser contexts and production app/worker builds.
  The timer starts when an already-fetched file response is released. It ends
  after a file worker reply, visible coloured text, and two animation frames.
  App startup and Git read are excluded. Language loading, worker transfer,
  virtualized rendering, and observation overhead are included. These runs use
  the app's normal long-line policy.

Worker benchmarks use three alternating engine rounds, two warmups and seven
samples per stage per round. Each round uses a fresh worker. File opening uses
three alternating rounds per engine/file. OS caches are warm. Results are
machine-specific; a speedup in tokenization is not an equal speedup on screen.

See the recorded results below and the raw JSON beside this document.

## Recorded results

Recorded 2026-09-25T15:04:32.943Z on Apple M1 Pro.

| Source / stage                     | Shiki median | Twinkleplop median | Speedup |
| ---------------------------------- | -----------: | -----------------: | ------: |
| Bun C++: tokens                    |     257.8 ms |             1.7 ms |  151.6× |
| Bun C++: Pierre file               |     260.9 ms |             8.4 ms |   31.1× |
| Bun C++: Pierre diff               |     525.9 ms |            18.1 ms |   29.1× |
| Bun C++: visible file opening      |    1044.3 ms |           114.5 ms |    9.1× |
| OpenJDK Java: tokens               |      44.1 ms |             1.3 ms |   33.9× |
| OpenJDK Java: Pierre file          |      49.0 ms |             9.0 ms |    5.4× |
| OpenJDK Java: Pierre diff          |      95.8 ms |            17.5 ms |    5.5× |
| OpenJDK Java: visible file opening |     185.8 ms |           125.0 ms |    1.5× |

All 18 focused fixture/theme comparisons pass. The six whole-file/theme comparisons remain failures:

| Source          | GitHub Light/Dark mismatch ranges | Diagnostic mismatch ranges |
| --------------- | --------------------------------: | -------------------------: |
| bun-object.cpp  |                         125 / 125 |                        593 |
| array-list.java |                         370 / 370 |                        409 |

There is no claim of complete visual parity on these two real files. The C++
tokenizer exceeds 100× on this sample; the complete visible operation improves
by about 9×. Java does not reach an order-of-magnitude gain in the renderer or
UI. Further performance work must preserve these correctness checks.

Raw samples: [renderer results](java-cpp-renderer-results.json) and
[production UI results](java-cpp-ui-results.json). Renderer results include
implementation file hashes, reference versions, input hashes, and every sample.
The UI screenshots and full mismatch reports remain in the ignored output
directories listed above.

The next renderer optimization pass is recorded separately in
[file-opening measurements](FILE_OPENING_SECOND_PASS.md). The numbers above retain the original
language-support baseline.
