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


## Contents navigation and scroll motion follow-up

The final contents link reproduced the gap on the previous build: both columns
moved up by 272 px inside the overflow-hidden split container, although the
window itself stayed at scroll position zero. Preview-local offsets now leave
the split container at zero and both columns fill the window. The target remains
visible after lazy diagrams resize. Excess `45vh` end padding is now 48 px.

The production browser check covers Cmd+Shift+V / Ctrl+Shift+V, the last heading,
column bounds, fractional source scrolling, monotonic animated movement, and
reduced motion. A 5 px source scroll advanced the mapping by 0.25 of a line.
The captured scroll had 15 distinct positions across 25 sampled frames.
This verifies intermediate motion rather than claiming a fixed frame rate.

[Results and frame samples](markdown-scroll-results.json) ·
[Last contents link without the gap](markdown-last-heading.png).


## Typography follow-up

The [Vercel article](https://vercel.com/blog/ai-gateway-jev-model-launch) uses
a 684 px article column at a 1440 px viewport, 18 px body text, 28 px line height,
and 24 px paragraph gaps. Its first two full lines contain 78 and 74 characters.
The title uses weight 450 and the section heading uses weight 400.

The initial adaptation used 16 px body text, 26 px line
height, 24 px paragraph gaps, and a maximum 608 px text column. Page padding
is outside that limit. The sample paragraph fits 84 and 81 characters on its
first two full lines; the count varies with the text and available pane width.
H1–H3 use regular weight 400; explicit Markdown emphasis uses weight 600.
Section headings have more space above than below. SF Pro headings and Geist
body text remain in use.

Build/typecheck and the production Markdown browser check passed. The check
includes live editing, diagrams, contents navigation, smooth scroll following,
reduced motion, saved preview preference, and the narrow layout. The light,
dark, diagram, math and last-heading screenshots above show the updated style.

### 14 px body text trial

The body now uses 14 px text with the same spacing ratios: 22.75 px line
height, 21 px paragraph gaps, and a maximum 532 px text column. Headings now
scale with the body: H1 is 26.25–38.5 px, H2 is 22.75 px, H3 is 19.25 px,
and H4–H6 are 14 px. Heading gaps scale down as well; font weights are unchanged. Build/typecheck passed. Chromium checks confirmed the sizing
in light and dark themes and no horizontal overflow at a 650 px viewport.
The screenshots above retain the previous 16 px version for comparison.
