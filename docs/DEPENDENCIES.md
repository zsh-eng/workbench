# Dependencies: build or take

Take a maintained dependency by default. Build a narrow subset only when
measurements show a clear gain. This guide applies to every app.

## Build our own when

- We use a small, stable part of a large library, and the subset is a few
  hundred lines or less.
- The code is on a hot path, and a profile shows that the library is the cost.
- The format is small, stable, and well specified: for example a JSON or XML
  lexer, an SSE parser, or a byte-bounded LRU.
- The library brings a large transitive tree or a second runtime for a small
  feature.
- We need behavior that the library cannot give through options or a small,
  version-checked patch.

## Take a dependency when

- The code parses untrusted input, and an error is a security bug: HTML
  sanitizing, Markdown to HTML, archives, URLs and paths, auth, crypto.
- The specification is large or changes often: CommonMark and GFM, Unicode,
  time zones, LaTeX, grammars for many languages.
- It is an engine: diagrams, math layout, a code editor, a virtualized diff
  view, or accessible widgets with focus and keyboard rules.
- Its cost stays in lazy chunks and does not reach the first load.

## Measure before you decide

Record these numbers in the change description or in the owning app's docs:

1. Bundle bytes for the first load and for lazy chunks, minified and gzip.
2. Install size, with transitive packages.
3. Speed on real files from this repository: medians, runtime, and machine.
4. Behavior parity against the library or a pinned reference.
5. Ownership: lines to maintain, edge cases, and upgrades we no longer get.

## Rules for an in-house subset

- Keep it behind the existing boundary. Do not build a general framework.
- Keep an integration or parity test against the reference, so that the
  subset cannot drift silently.
- Support only the cases that the app uses, and write down the limits.
- Remove the dependency in the same change as its last call site.

## Rules for a new dependency

- Check its transitive packages, install size, and bundle bytes first.
- Prefer few dependencies and the smallest entry point, for example `zod/mini`.
- Load a large package lazily, outside the first-load bundle.
- Pin the exact version in the owning `package.json`. Keep one root `bun.lock`.

## Examples from Med

| Decision                                    | Evidence                                                                                                                                   |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Twinkleplop replaces Shiki inside Pierre    | Tokenizing is 8–155× faster on repository files; the build has 9 MiB less lazy JavaScript.                                                 |
| In-house Java, C++, and XML grammars        | 0.3–2.6% of visible characters differ from Shiki ([method](../apps/med/docs/validation/JAVA_CPP_HIGHLIGHTING.md)); Twinkleplop has no XML. |
| In-house JSON and JSONC scanner             | No differences from Shiki in 4,149 random and repository files; 1.5–5.2× faster than the Twinkleplop grammar.                              |
| Keep Mermaid, KaTeX, CodeMirror, and remark | Engines and large specifications. They load lazily.                                                                                        |
| Keep Base UI in the first load              | Accessible menus, dialogs, and comboboxes need focus and keyboard rules that are expensive to own.                                         |
