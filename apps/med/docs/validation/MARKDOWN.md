# Markdown preview validation

Run `bun run build`, then `node scripts/validate-markdown.mjs` from `apps/med`.
The script starts a disposable production host and Chromium, uses real Vim input,
and removes its host, browser and fixture files on exit.

Verified on 2026-09-27:

- GFM tables, tasks, footnotes, code colors and paragraph boundaries. Soft newlines do not create paragraphs or hard breaks.
- KaTeX inline/display math and Mermaid diagrams. Unsaved diagram edits and Vim undo update the SVG.
- Cursor following in editor and viewer, including editor auto-scroll. Manual scroll follows the source viewport.
- Unsaved text updates the preview without writing the file; the Preview preference survives reload.
- Wide-screen table of contents and a narrow stacked layout.
- Same-folder images and images from the displayed Git commit. Unauthenticated, unopened-file, traversal and symlink image requests are refused.
- Raw HTML and unsafe links stay inert; malformed math and diagrams leave readable content.

A 400-section document parsed and serialized in **47.6 ms** in the worker
on the final run. This includes GFM parsing and HTML generation. It excludes
host file reading, worker startup, React commit, browser layout and painting.
It is a single validation measurement, not a cross-device latency guarantee.
Source movement never triggers Markdown parsing. Typing is debounced by 100 ms.

Build/typecheck and lint passed. The existing file/navigation browser suite passed
81 tests. `validate-local-files.mjs` also passed, including Vim saves, conflict
handling, drops, gutter markers and equal toolbar heights.

Review the [raw results](markdown-results.json), then the screenshots:

- [Light preview](markdown-preview-light.png)
- [Dark preview](markdown-preview-dark.png)
- [Mermaid and code](markdown-diagram-light.png)
- [Math and table](markdown-math-light.png)
