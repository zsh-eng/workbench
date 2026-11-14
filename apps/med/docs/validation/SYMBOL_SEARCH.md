# Symbol search validation

Universal Ctags 6.2.1 and the pinned Zoekt helper were measured on an Apple M1 Pro (macOS arm64), using Bun commit `26e7a4b3690dce60d4dcd7f47a12b531deb00837`. The repository was read as code only. Its HEAD, refs, and status were unchanged afterward.

Raw observations: [symbol-benchmark.json](symbol-benchmark.json). Reproduce with `node scripts/benchmark-symbols.mjs .benchmarks/bun <directory-containing-new-helper-and-indexer>`.

| Operation                                                                     |            Result |
| ----------------------------------------------------------------------------- | ----------------: |
| Text-only index, same private bare repository                                 |            4.68 s |
| Symbol-enabled index, same private bare repository                            |           14.45 s |
| Complete first startup with symbols (private clone, indexing, helper startup) |           17.26 s |
| Text-only index size                                                          |         410.61 MB |
| Symbol-enabled index size                                                     | 420.84 MB (+2.5%) |

Index construction has one observation per configuration, with filesystem caches warm and the text-only run first. This is not a cold-storage benchmark. The Ctags-enabled index took about three times as long to build in this sample; it does not run on each project search.

Project queries cover the exact indexed commit. These measurements include the TypeScript service, schema validation, Unix socket, Zoekt query and response parsing. They exclude browser rendering and HTTP. A live-worktree project query additionally resolves HEAD.

| Query        |     Results |  Median |      p95 |
| ------------ | ----------: | ------: | -------: |
| `setTimeout` |          80 | 2.57 ms |  3.74 ms |
| `parse`      | 200, capped | 5.01 ms |  6.84 ms |
| `Bun`        | 200, capped | 9.17 ms | 10.70 ms |
| No match     |           0 | 0.27 ms |  0.45 ms |

Each query has 20 recorded warm samples after one warmup. Broad queries explicitly report truncation at 200 declarations.

File symbols parse a private copy of the exact displayed snapshot. Each warm request still reads and validates that snapshot through Git, then uses cached extraction. These numbers include those Git reads, Ctags startup on the cold request, temporary file I/O, and JSON parsing. They exclude browser rendering and HTTP.

| Largest eligible source per language |   Size | Symbols |     Cold | Warm median / p95 |
| ------------------------------------ | -----: | ------: | -------: | ----------------: |
| `src/js/node/http2.ts`               | 266 KB |     632 | 61.61 ms |  18.20 / 20.21 ms |
| `src/jsc/bindings/bindings.cpp`      | 291 KB |     421 | 45.17 ms |  15.73 / 21.13 ms |
| `src/js_parser/p.rs`                 | 456 KB |     429 | 38.24 ms |  19.05 / 21.45 ms |

Smaller 3–7 KB files took 25–30 ms cold and 15–16 ms warm. Ten warm samples follow each cold extraction. File parsing is bounded by the existing text-file limits, a 10-second timeout, 8 MiB output limit, and 10,000 symbols. The cache keeps at most 32 extraction results.

## Coverage and setup

Install Universal Ctags with `brew install universal-ctags` on macOS, or `sudo pacman -S ctags` on Omarchy. The macOS system `/usr/bin/ctags` is not accepted. `MED_CTAGS_BIN` can select a custom binary; it must identify as Universal Ctags and support JSON output. Run `npm run build && npm start -- --setup-search` after upgrading the helper, then restart the viewer. Go is only required to build search tools during setup. Normal startup does not download or install tools.

The `v3` tool directory and symbol-aware cache identity prevent reuse of old text-only indexes as symbol indexes. Installing or changing the Ctags version takes effect after host restart and selects a new index cache. Without Ctags, existing content search still works and symbol search gives an explicit setup message.

Ctags parser coverage varies by language. This Ctags release supports the tested TypeScript, C/C++, and Rust files, but does not include a Zig parser. File symbol search reports unsupported languages; project symbols include only declarations from available parsers. These are declaration searches, not semantic reference or definition resolution. Unsupported languages require a future parser extension.

Project symbols at a commit, and in a checkout of more than 20,000 files, use committed, indexed branches; dirty worktree content is excluded from those results. A smaller checkout's project symbols come from Ctags over its working files ([measurements](../perf/SYMBOLS.md)). File symbols use the displayed file source and reject a stale worktree identity instead of substituting newer or historical content. Unindexed historical commits retain file symbols, but project symbols report unavailable. Binary, missing, and oversized files never reach Ctags.
