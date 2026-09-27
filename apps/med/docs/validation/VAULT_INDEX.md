# Vault CLI indexing benchmark

Measured 27 September 2026 on an Apple M1 Pro with 16 GiB RAM, macOS arm64,
Bun 1.3.5. This is an index-engine
benchmark and CLI packaging proof, not a browser Obsidian-mode benchmark.
[Aggregate samples](vault-index-benchmark.json) contain no note text or filenames.

## Corpus and protection

The user's vault was copied to a private temporary directory outside Git. The
copy contains 6,638 files, including 4,040 Markdown notes (12,362,626 bytes), and
500,834,875 bytes overall. Hidden files/folders, dependency folders and symlinks
were excluded. No Obsidian plugins or settings were copied or executed.

After benchmarking, SHA-256 checks compared all 6,638 copied files with their
originals: zero content differences. The benchmark added and removed only its
own two-note fixture in the copy. The original vault was only read. Vault files,
SQLite indexes, binaries, and detailed traces remain outside source control.

## Measurements

Three independent Bun processes used three fresh SQLite databases. Filesystem
caches were not flushed. The table gives medians; backlink figures are the
median of each run's percentile, from 1,000 queries per run over the 100 most
linked destinations. Each query includes result materialization, capped at
1,001 rows. These are local function calls, not HTTP/browser timings.

| Operation | Time |
| --- | ---: |
| Enumerate/stat 6,638 files | 51.8 ms |
| Fresh full index | 4,591.7 ms |
| Warm full reconciliation, zero notes reparsed | 56.4 ms |
| Reopen database plus full reconciliation | 56.2 ms |
| One-note edit plus full reconciliation | 53.6 ms |
| Backlink query, p50 | 0.0196 ms |
| Backlink query, p95 | 0.0380 ms |

The index contains 10,662 link occurrences and 2,876 embed occurrences. Embeds
include note embeds as well as images; this is not an image-only count. No notes
failed parsing. There are 407 unresolved destinations under the implemented
resolver. This is not a claim that those notes have broken links in Obsidian:
resolution parity, aliases and unsupported conventions require further work.

The final database is 5,750,784 bytes. End-of-run process RSS was 257–276 MiB,
including the runtime, parser allocations, and retained trace events. This is
not steady-state host memory or peak memory. Index commands exit after use.

## What improved

The first implementation used the full GFM metadata parser and asynchronous
file-handle reads. Fresh indexing took 9,800.7 ms median, including roughly
8.4 seconds of parsing. Removing GFM rendering-related parsing and skipping
AST creation when a note contains no `[` reduced this to about 5.1 seconds.

All 10,662 extracted link records matched the original parser: source positions,
destination strings, embed type and syntax. This checks the optimization on
this corpus; it is not an Obsidian conformance test.

One later traced run stalled in Bun's asynchronous file-read path and was
terminated. Bounded synchronous reads in the dedicated indexing process avoided
that path in subsequent runs and reduced read overhead. The final median was
4.59 seconds, about 2.13 times faster than the first implementation. No claim is
made that synchronous I/O is suitable for a host request handler; host integration
must use a separate worker/process.

A resolver correction also permits dotted note names without an explicit `.md`
extension. It resolves 102 additional occurrences without changing extraction.
The three final runs passed edit/deletion checks. Warm passes reparsed zero
notes; an edit reparsed exactly one. Filesystem events and targeted watcher
updates are not implemented or included in these numbers.

## Executable proof

`bun build src/cli/index.ts --compile` produced a 61,288,944-byte executable.
It registered and indexed the external vault copy and queried the warm cache
from a directory outside the checkout, with Node/Bun removed from `PATH`.
Embedded CLI guides also worked in the compiled build and matched the built
Node CLI's output. The executable carries its own runtime.

One unminified executable run took 8.00 seconds end-to-end for fresh registration
and indexing, and 142.7 ms for a new process's warm index command. A minified
build took 9.49 seconds and 131.2 ms respectively. These are one-off packaging
checks, not three-sample medians. **Compiled cold performance is slower than
the source-run engine benchmark and needs profiling before release.**

This proves CLI/index/docs packaging only. Browser assets are not embedded in
this proof, and Git/search helper distribution is not solved. It is not a
complete standalone application release.

## Verification and reproduction

The production CLI integration suite checks persistent registrations, source
types and directory identity, Markdown/code exclusions, image metadata,
backlinks, warm reuse, dotted names, additions/renames/edits, ambiguous names,
revocation, embedded docs, and a real host launched with saved repositories.
Three integration scenarios passed. Typecheck/build and lint passed.

Use the copy and benchmark commands in [VAULTS.md](../VAULTS.md). Use a new
external output directory. Each sample emits a `trace-N.json` with anonymous
read/parse/enumeration phases in Chrome trace format. The source files and
private paths are not included in those traces. Detailed artifacts are kept
with the private benchmark copy, not this repository.
