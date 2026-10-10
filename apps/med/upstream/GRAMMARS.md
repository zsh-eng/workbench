# Syntax grammar provenance

Med colors Go, Rust, and Swift with its own scanners in `src/web/highlighting/languages/`. Each scanner follows the TextMate grammar that Shiki bundles for its language, so Med and Shiki give the same scopes. No grammar file is loaded at run time.

| Scanner | Grammar | Source |
| --- | --- | --- |
| `go.ts` | go-syntax by Furkan Ozalp | https://github.com/worlpaker/go-syntax |
| `rust.ts` | rust-syntax by Dustin Pomerleau | https://github.com/dustypomerleau/rust-syntax |
| `swift.ts`, `swift-builtins.ts` | swift-tmlanguage by Jacob Bandes-Storch | https://github.com/jtbandes/swift-tmlanguage |

Reference copy: the grammars in `@shikijs/langs` 4.4.3.

License: MIT for each grammar; the original notices are in [GRAMMARS-LICENSE](GRAMMARS-LICENSE).

## Retained material

- Scope names, and the order in which each grammar tries its patterns.
- Regular expressions transcribed from the grammars' line-bounded patterns, mainly in `go.ts`, and adapted to sticky JavaScript expressions.
- `swift-builtins.ts`: the Swift standard library names in the grammar's `builtin-*` patterns, expanded from its alternations into word lists.

The scanners themselves, the region engine in `swift.ts`, and the caches that keep long lines linear are local code.
