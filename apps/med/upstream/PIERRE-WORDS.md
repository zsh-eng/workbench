# Pierre Words

Source: https://github.com/pierrecomputer/pierre, `packages/words`
(`@pierre/words` 0.2.2), at commit 3e96f6263e222aa08e9381c207f58508f90e5f2c.
Apache License 2.0; see PIERRE-WORDS-LICENSE, and PIERRE-WORDS-NOTICE.md for
the data that Words' WebAssembly carries and its licenses.

`src/web/markdown/words/words-wasm.ts` holds Words' WebAssembly, built from
its `src/` with [pierre-words.patch](pierre-words.patch) applied, as base64.
`scripts/pierre-words.ts` builds it from a clone of that commit; the same
commit and patch give the same bytes (SHA-256
3a384f387b5a0a36334e31f55163ea1dfd0006f10c17f5dc9fbb790297b838c9).
`src/web/markdown/words/words.ts` calls the module through the bytes at the
start of its memory, as Words' own `lib/core.ts` does. Med uses none of Words'
TypeScript: not its highlighting, element hooks, or streaming sessions.

## Changes

The patch adds three options to Words' HTML renderer, each off unless set,
with their TypeScript options (`lib/types.ts`) and tests
(`test/source_test.ts`). Words' own tests pass with it.

- **Source lines** (extension bit 4, `sourceLines`). Each top-level block ends
  with a NUL, its first and last source lines as `first,last`, and a NUL.
  Headings, code blocks, and tables name their lines in `data-source-line`
  and `data-source-end`. Raw HTML, a block or a tag among a paragraph's
  words, is its escaped text in a `<template data-html>`, which the browser
  does not render. For this, the block parser keeps a source position at
  byte 20 of each record that its line ranges do not place: a container's
  first line, a thematic break, an empty heading, a setext underline, a
  table's delimiter row, and a closing fence.
- **Only `$$` starts inline math** (extension bit 8, `doubleDollarMath`), so
  `$HOME` and `$3` stay text, as in Med's replies.
- **TeX for KaTeX** (extension bit 16, `mathSource`). Math is its TeX source
  in the markup that remark-math writes and rehype-katex reads, in place of
  Words' own SVG.

## Updating

Check out the new commit, update `COMMIT` and the tool versions in
`scripts/pierre-words.ts`, apply the patch and resolve what conflicts, then
write the patch again with
`git diff <commit> -- packages/words > upstream/pierre-words.patch`. Run the
script, Words' tests in the clone (`node --test test/*_test.ts` in
`packages/words`, after `tsdown` builds its `dist`), and Med's:
`tests/data/words-markdown.test.ts`, `tests/data/details.test.ts`,
`tests/data/raw-html.test.ts`, and `tests/browser/markdown-worker.test.ts`.
