# Twinkleplop in med

Implemented and recorded on 2026-09-24. **Twinkleplop is now the default highlighting engine.** Pierre still supplies the file and diff UI, worker scheduling, caching, selection, and comments. There is no automatic Shiki fallback.

## Recorded production comparison

| File                       |   Source size |    Shiki | Twinkleplop | Ratio |
| -------------------------- | ------------: | -------: | ----------: | ----: |
| Bun `src/js/node/http2.ts` | 266,040 bytes | 2,287 ms |      258 ms | 8.85× |
| med `src/web/App.tsx`      |  87,824 bytes |   858 ms |      153 ms | 5.61× |

These are individual recorded runs, not averages. The ratio is Shiki elapsed time divided by Twinkleplop elapsed time. It is not a claim about every file or device.

- [Bun HTTP/2 comparison video](videos/bun-http2-highlighters.mp4)
- [med App comparison video](videos/med-app-highlighters.mp4)
- [Measurements, source hashes, and capture timestamps](videos/highlighter-comparison-results.json)

Both timers start at zero. Playback runs at **3× slow motion**, while the timers show real elapsed time. Each side freezes its screen and timer when it completes. Both final screens then stay visible for three seconds. Bun is 296 frames / 9.867 seconds; med is 168 frames / 5.600 seconds. Both videos are 2240 × 900 at 30 fps. Initial, intermediate, and final frames were checked visually.

### What the timer measures

Each side uses a separate production build and a fresh Chromium context. The script opens the same file through med's file picker. It holds the already-fetched file response until the main file tab is open and existing worker jobs have finished. The timer starts when that response is released.

Completion requires a new successful file-highlight worker response, at least 20 styled token spans with three distinct computed colours in the main file pane, and two animation frames. This confirms a coloured view rather than the initial plain-text render. The timer includes response delivery, highlighting, layout, paint scheduling, and recording/observer overhead. It excludes app startup and the Git read. Chromium may deliver screencast frames sparsely; the 60 fps source encoding does not create additional captured frames.

Both sides use Tokyo Night, a 1120 × 800 viewport, Chromium 153.0.8010.12, and an Apple M1 Pro on macOS/arm64. Runs were sequential with the test suites stopped. OS caches were warm. The worker pool was initialized before timing; language modules may already be loaded by the initial review. The target file result was uncached. Bun used commit `26e7a4b3690dce60d4dcd7f47a12b531deb00837`. med's source file was unchanged from `5eb273655e4f13b66bb411a12342218c5f768a83`; its initial review included this integration's working changes. Matching SHA-256 hashes confirm identical target source on each side. All four captures had zero browser errors.

The Shiki baseline uses Pierre's original JavaScript regex engine, not its Oniguruma/WASM option. Tokenizer-only timings are in [Java and C++ highlighting](JAVA_CPP_HIGHLIGHTING.md).

## Integration

Review these files in this order:

1. [`tools/pierre-highlighter.ts`](../../tools/pierre-highlighter.ts): the version-checked build patch. It replaces initialization and language resolution in both Pierre highlighting paths. It retains the existing worker messages and render utilities. Normal builds reject emitted Shiki engine or grammar modules. Pierre upgrades stop with an error until this boundary is reviewed.
2. [`src/web/highlighting/languages.ts`](../../src/web/highlighting/languages.ts): lazy language factories, aliases, concurrent-load sharing, and Markdown fence offsets. Workers prepare the current file's fence languages. The synchronous main-thread path preloads installed embedded languages when Markdown is requested.
3. [`src/web/highlighting/adapter.ts`](../../src/web/highlighting/adapter.ts) and [`runtime.ts`](../../src/web/highlighting/runtime.ts): token ranges become HAST spans with theme colours, UTF-16 columns, line boundaries, and Pierre word-change decorations. The runtime supplies only the API that this pinned Pierre integration uses.
4. [`tests/data/highlighter-adapter.test.ts`](../../tests/data/highlighter-adapter.test.ts) and [`highlighter-languages.test.ts`](../../tests/data/highlighter-languages.test.ts): source preservation and real Pierre file/diff output, including Markdown fences.

There is one engine per build, so cached render results cannot cross engines. The default browser bundles have no Shiki tokenizer engines or TextMate grammar modules. The installed dependency graph still contains Shiki through Pierre. Theme data, theme normalization, and Pierre's transformer utility remain in the browser output; removing the engine does not require rewriting those parts.

### Coverage and limits

This record describes the first integration. Med has since added its own grammars for Java, C++, XML, and JSON/JSONC; [usage](../USAGE.md#limits-and-evidence) lists the current languages. JSX maps to TSX. Markdown fences use installed language factories; HTML and Svelte supply embedded script/style tokens.

C, Zig, and other missing grammars use plain text. Their files and diffs remain usable, including navigation and comments. A full-file view identifies a known unsupported syntax language. This is reduced syntax coverage compared with Shiki.

Twinkleplop emits semantic token kinds, not full TextMate scope stacks. The adapter maps these to the existing theme palette. Parent/context scope selectors cannot be reproduced exactly, so some colours differ. The adapter implements Pierre's current transform contract, not every Shiki API or arbitrary third-party transformer.

Validation passed: **462 unit tests, 131 browser tests, typecheck, lint, formatting, and production build**. Six existing unit tests were skipped. The adapter checks include every bundled factory with LF/CRLF, Unicode, empty/trailing lines, long-line grammar state, embedded Markdown, light/dark styles, diff line identity, and word decorations. Browser tests cover comments, file navigation, Vim, themes, and worker rendering. This is not an exhaustive grammar accuracy test.

## Reproduce

With project dependencies, Playwright Chromium, FFmpeg, and FFprobe installed:

```sh
# Set up this corpus once if it is not already present.
git clone --filter=blob:none https://github.com/oven-sh/bun.git .benchmarks/bun
git -C .benchmarks/bun checkout 26e7a4b3690dce60d4dcd7f47a12b531deb00837
npm run build
node scripts/record-highlighter-comparison.mjs
```

The script builds both engines into `.benchmarks/highlighter-comparison`, starts separate temporary local hosts, captures the runs, checks source hashes, and writes the videos and results under `docs/validation/videos`. It does not change the user's running med host. It overwrites its own output files. Stop unrelated CPU-intensive work before recording. The med source and initial working diff will reflect the checkout used for the new run; consult the recorded hashes before comparing different runs.

For a manual Shiki baseline build, use `MED_HIGHLIGHTER=shiki npm run build:web`. A normal `npm run build` restores Twinkleplop. This is a build-time comparison option, not a runtime fallback.

The reusable primitives are documented in [`helpers/README.md`](../../helpers/README.md): `recordTimedOperation` records an arbitrary prepared page operation; `compareVideos` combines independently recorded operations with synchronized timers, slow motion, and final holds. The med-specific completion rule stays in the recording script.
