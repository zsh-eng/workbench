# Read and edit Markdown

A `.md`, `.markdown`, `.mdown`, or `.mkd` file opens rendered, to read. To edit
it, select **Edit source** (the pencil, at the page's top corner) or press
`⌘⇧V`: the source opens in the
Vim editor in the same place, at the first line that was in view. **Read** or
`⌘⇧V` renders it again, at the source's cursor. A file with unsaved changes
opens as source, and Med keeps each file's view until you reload. A file you
come back to, as by its tab, shows its page at once. The rendered view shows
unsaved edits; it does not save them.

A document with three or more headings below its title lists them on the left
when its pane is 760 pixels wide or more; select one to go to it. The heading
you are reading is in the text's color and the ones above it are fainter. The
text stays centered in the pane while there is room beside the list. Previews,
vault notes, and review notes share one type scale, which a theme can scale
for its fonts.

- GFM tables, task lists, strikethrough, autolinks, and footnotes; LaTeX with
  KaTeX; Mermaid diagrams; colored code; and images. A single newline stays in
  the paragraph, and a blank line starts a new one. Raw HTML is left out.
- `<details>` and `<summary>` fold Markdown, as on GitHub: the summary shows,
  and a click opens the fold. `<details open>` starts open. Put a blank line
  after `</summary>` and before `</details>`, so that the Markdown between
  renders; text in the same HTML block as the tags stays plain text. A fold
  stays open or closed while you edit. Going to a heading in a fold, from the
  list on the left or a link, opens it, and so does the source's cursor in it.
- Relative images resolve in the same repository or commit. A standalone
  file's images must be in its folder or below it. PNG, JPEG, GIF, WebP, AVIF,
  and SVG load up to 8 MiB each. Remote images load directly, with no referrer.
- A relative link opens its file in a tab, from the Markdown file's folder, in
  the same worktree, commit, file workspace, or vault. `#L42` selects a line.
  Heading, web, and mail links work as usual. A dropped file has no folder, so
  its relative links do not work.
- The preview takes up to 512 KiB of Markdown. A diagram takes up to 20,000
  characters and 500 edges. An invalid diagram keeps its source with a notice,
  and invalid math stays visible.

## Copy

- **Copy page**, at the page's top corner beside **Edit source**, copies the
  file's Markdown as written, with unsaved edits. The rendered page has no bar
  above it, and while the file loads it stays empty.
- A table's **Copy** button shows while the pointer or the focus is on it.
  It copies the table's Markdown, and the table itself for editors and
  spreadsheets that paste one, without a quote's or a list's `>` or indent.
- Right-click an image for **Copy image** (as PNG), its address or path, and
  **Open image in new tab**. A remote image that does not allow reading copies
  as its address.
- **Copy** and **Full screen** sit at a diagram's corner while the pointer or
  the focus is on it. **Full screen** shows the diagram over the page, up to
  three times its size, with zoom and drag. Escape or × closes it.
- Right-click a diagram, or open its **Copy** menu, for **Copy as image**: a
  PNG at twice its size, on its background. **Copy as SVG** keeps its colors
  and fonts, so it draws the same elsewhere; **Copy text** copies its Mermaid
  code. In the **Copy** menu, `I`, `S`, or `T` chooses one. Full screen has
  the same menu in its header and on right-click.
- The tables and diagrams in an agent's replies, the Guide, Notes, and a pull
  request's description copy the same way.
- Text keeps the browser's own right-click menu.

Try [the reading queue design note](../examples/reading-queue.md).

## Images and videos

Image diffs show **Before** and **After** in compact cards that load near the
visible area. Click a card's header to fold it, or its filename to open the
viewer. The viewer fits images to the pane; **1:1** shows actual size. The
browser decodes the images: SVG, PNG, JPEG, WebP, AVIF, GIF, APNG, BMP, and
ICO, and TIFF, HEIC/HEIF, and JPEG XL where the browser supports them.

Videos use the browser's controls. MP4/M4V, WebM, MOV, OGV, and MKV play when
the browser has the codec; Med does not transcode. Images are limited to 32
MiB and videos to 4 GiB. Saved reviews keep image bytes within each target's 24
MiB capture budget, and do not capture videos.
