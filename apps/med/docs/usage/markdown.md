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
  KaTeX; Mermaid diagrams; [charts](#charts); colored code; and images. A
  single newline stays in
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
- A code block's **Copy** button sits on its first line while the pointer or
  the focus is on it, as in a session's replies. It copies the code as its
  fence holds it.
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

## Charts

A `chart` fence draws a chart in Med's colors: a line chart over time, or a
bar a row. Its first lines are keys, `key: value`; its data comes from one of
three places.

- `grafana:` a Grafana panel's link, as Grafana's **View** gives it. Med's
  server reads the panel with the token in [Settings → Grafana](settings.md#grafana),
  once the chart nears the view; the chart shows a waiting line until then.
  Med runs the panel's queries with the link's variables, or the dashboard's
  own, and takes the panel's unit, log axis, threshold line, and the
  dashboard's annotations as marks. It does not apply the panel's
  transformations, and says so under the chart.
- `file:` a CSV or JSON file in the checkout, such as one a script wrote. In
  a reply the path starts where the agent worked; in a Markdown file, at the
  file's folder.
- CSV rows after the keys and a blank line. A first column of times (dates,
  date-times, or seconds or milliseconds since 1970) draws a line for each
  other column; a label and a number in each row draw bars.

```chart
grafana: https://grafana.example.com/d/abc/checkout?viewPanel=4&from=now-3h&to=now
title: p99 went past 2 s after the deploy, and recovered after the rollback
mark: 10:42 Deploy v412
threshold: 500 SLO
```

Other keys: `title` (the finding, in a sentence) and `subtitle`; `unit`
(`ms`, `s`, `%`, `B`, or a word such as `req/s`); `scale: log`; `type: bars`
or `line`; `mark:` a time, as `10:42` or `2026-11-16 10:42`, and a label,
once for each mark; `threshold:` a value and a label; `highlight:` the bar
the chart is about. A Grafana link's range relative to now, such as
`now-3h`, counts from when the reply was written, so the chart keeps showing
what the agent looked at; `live: yes` keeps it moving, and reads Grafana
again each minute while it shows. `from:` and `to:` replace the link's range.

Med keeps what it read from Grafana, so a chart draws the same each time.
At rest a chart shows its data and where it came from. Hover it to read each
line at a time; the time sits on the axis. Drag across to zoom, and
double-click or **Reset zoom** to zoom out. The key hides and shows a line.
While the pointer or the focus is on the chart, two buttons show at its
corner, as on a diagram. **Full screen** shows the chart over the page.
**Chart options** (`⋯`) holds the rest: **Log scale**, **Refresh**, **Open
in Grafana**, and **Copy as image** (with its title, key, and source), **as
CSV**, or the **link**. The menu also says when Med read the data.

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
