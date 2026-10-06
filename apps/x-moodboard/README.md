# Cuttings — X bookmark moodboard

Cuttings is a local, private visual library for your saved X posts. It shows
1,553 X bookmarks as a masonry moodboard with search, combinable filters, a
card-to-detail view, favourites and topic edits. It does not use the network.

## Run it

All commands run in `apps/x-moodboard`. Install dependencies once from the
workspace root with `bun install`.

1. Import the archive once. This validates the source folder, builds a
   snapshot, and makes thumbnails and video frames (about 90 s the first time):

   ```bash
   bun run import --source ../../saved-links-2026-10-05.local/x-app-ready.local
   ```

2. Build the UI and start the server:

   ```bash
   bun run build && bun run start
   ```

3. Open <http://127.0.0.1:5296>.

From the workspace root, `bun run start:moodboard` and `bun run build:moodboard`
do the same. For UI work, `bun run dev` starts the data server with Vite at
<http://127.0.0.1:5295>.

### Refresh the archive

Run `bun run import` again. The importer remembers the source folder. It adopts
a new snapshot only after validation, and it skips adoption when nothing
changed. Open windows check for a new snapshot every 30 s and on focus. They
update in place and keep scroll position, favourites and topic edits. You do not
need to rebuild the app.

Use `bun run import --deep` to also verify the SHA-256 of every video
(6 GB, slower). Without it, the importer hashes images and captions and checks
video sizes.

### Checks

| Command | What it does |
| --- | --- |
| `bun run build` | Type check and production build |
| `bun run test` | Build, then 13 browser tests on a synthetic fixture through the real importer, server and UI |
| `bun run lint` | oxlint |
| `node scripts/perf.mjs` | Performance pass against the running server; see [PERFORMANCE.md](PERFORMANCE.md) |

The tests make their own fixture with ImageMagick and ffmpeg in
`tests/.fixture.local/` and use port 5297.

## How it works

```
source archive (read-only)          library.local/ (private, ignored)
  dataset.json ─┐                     current.json ──► snapshots/<version>/
  assets-manifest.json ─┼─ import ──►                    library.json  projection for grid + search
  unresolved-cases.json ┤  validate                      details.json  evidence for the detail view
  signed-in-evidence.json┘  project                      media.json    allowlist of source paths
  assets/ videos/ captions/ ◄──┐                         report.json   counts
                               │      derived/  320/640/960 px WebP and video frames, by asset hash
                               │      user-state.json  favourites and topic edits
                               │
                  server/ (127.0.0.1:5296) ──► browser UI (React)
```

- **Importer** (`scripts/import.ts`). It reads the source twice and stops if
  the files change during the read or changed less than 5 s ago. It keeps only
  items whose `source_types` include `x-bookmarks`. It drops Telegram
  provenance, message IDs and saved dates. It checks every referenced file
  against the manifest. A missing or mismatched file becomes an honest
  "not saved" slot; the post stays. Snapshots are written to a temporary
  folder, renamed, and then `current.json` is replaced atomically. The last three
  snapshots are kept.
- **Derived media** are keyed by the asset hash, so a changed file gets new
  thumbnails and new URLs. Originals stay in the source folder at their
  manifest-relative paths. 364 videos had no X poster, so the importer takes a
  local frame. The UI labels these frames as such.
- **Server** (`server/app.ts`) binds to 127.0.0.1. It serves only allowlisted
  media paths, supports HTTP byte ranges for video, and refuses other host names
  and cross-origin writes. Media URLs carry the asset revision and are cached as
  immutable.
- **UI** (`src/`). One in-memory index per snapshot holds folded search text
  and bit masks for topics, formats and states. Search and filters scan 1,553
  items without a sort; the three sort orders are precomputed. The grid is a
  shortest-column masonry with precomputed heights, so only cards near the
  viewport are mounted (about 40). Text-card heights come from canvas text
  measurement.

## Information design

- **Topics** are the seven approved categories. A post can have several, plus
  subtags. Selected topics combine as a union. Subtags refine a selected topic.
- **Format** (photos, several media, videos, video previews, link previews,
  text only) and **archive status** (text cut short, possibly incomplete, X
  article previews, missing media, topics to review) are separate groups. Groups
  combine as an intersection. Counts show what each option would give.
- Filters, search and sort live in the URL. A post opens at `/post/<post id>`;
  Back closes it and a reload restores it.

### Honesty rules in the UI

- A poster without a saved video says "Video preview — open original".
- Text that the bookmarks timeline cut short says so on the card and in the
  detail view, with a link to X. Long text that was not checked is marked
  "possibly incomplete". X articles are labelled as previews.
- Snippet and article summaries written during the archive review are shown in
  a labelled box, never as post text.
- Quoted media is labelled with the quoted author. Link-preview images are not
  called post photos.
- Topics suggested with low confidence say "suggested, needs review". Your
  edits say "edited by you" and show what the archive suggested.
- Search covers post text, author, topics, subtags, quoted text and alt text.
  It does not read text inside images or videos.

## Keyboard

`/` or `⌘K` search · arrows move in the grid · `Enter` open · `F` favourite ·
`Esc` close · `←` `→` previous/next post · `[` `]` or `↑` `↓` images in a set ·
`Z` actual size · `O` open on X · `?` all shortcuts.

## Design direction

A quiet editorial studio: warm paper, dark ink, one cinnabar accent. Images
supply the colour. Post text is set in a book face (Iowan Old Style, Charter
fallback); interface text uses the system face. Text-only posts are designed as
cards of their own, and read as a page in the detail view. Motion is spatial:
the card image travels into the detail view and back to its card. Filtering
animates only the visible cards. With reduced motion, the app uses a short fade.
Video cards preview silently on hover, one at a time; no video loads until you
ask for it in the detail view. Light and dark themes follow the system or a
manual choice.

## Privacy

Everything runs on 127.0.0.1. The archive, snapshots, thumbnails, video frames,
user state, test fixtures and performance traces are in folders that Git
ignores (`*.local`, `dist`). `library.local` is created with mode 0700. The
reference images from the design brief are not part of the app. The page sends
no referrer and loads no remote fonts or scripts.

## Coverage of the current snapshot (6 October 2026)

From `library.local/snapshots/*/report.json`. The app derives all counts from
the adopted snapshot at run time.

| | Posts |
| --- | ---: |
| X bookmarks imported | 1,553 (9 Telegram-only posts excluded) |
| With playable local video | 658 |
| With photos | 466 |
| With several media | 230 |
| Text only | 421 |
| Link previews | 50 |
| Video preview only | 1 |
| Text cut short by the timeline | 197 |
| Possibly incomplete long text | 119 |
| X article previews | 30 |
| Topics flagged for review | 137 |
| No topic | 112 |
| Missing media | 0 |

The archive recorded 160 early "photo not saved" placeholders. All belong to
posts where a later signed-in review saved the observed photo set, and the
unresolved list has no open photo cases. The importer treats them as resolved
and notes this in the post's evidence.

## Limitations

- Bookmark save dates are not in the archive. "Bookmark order" uses the export
  position; the app shows no saved date.
- Quoted-post text exists for 9 posts only. Other quoted posts show their
  media and a link.
- Images keep the resolution X served (often 1,200 px). Small posters can look
  soft in the detail view; upscaling is capped at 2×.
- t.co links are not expanded. Local OCR text in the archive is noisy, so search
  does not use it.
- Refresh is a command, not an in-app button. Saved searches, colour search and
  free tags outside the seven topics are not built.
- Performance was measured in headless Chromium on one Mac. Safari, Firefox and
  screen readers were not tested.
