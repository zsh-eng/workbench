# Arctic browser

A local web reading library with a two-column editorial layout, search, topic
filters, hover/focus actions, and a reading page with margin annotations.

From the repository root:

```sh
bun install
bun run seed:arctic-browser
bun run dev:arctic-browser
```

Open `http://127.0.0.1:5186`. Build with `bun run build:arctic-browser` and run
browser interaction checks with `bun run test:arctic-browser`.

## Seed and privacy boundary

The seed command reads `~/Downloads/Takeout/Chrome/Reading List.html` and the
native Mac library at
`~/Library/Containers/com.zsheng.ArcticMac/Data/Library/Application Support/ArticleReader`.
Pass a different Chrome HTML path after the command. Set `ARCTIC_NATIVE_DATA`
for another native cache directory. Neither source is modified.

The output lives in gitignored `public/seed/`. It includes personal URLs,
titles, and downloaded article HTML. Vite copies this directory to `dist`:
keep this local build private. There is no deployed service or active sync.

Chrome dates and URLs are preserved. The native cache supplies descriptions,
bylines, and full text where available. Missing authors are shown as a source,
never an invented byline. Initial topic tags use simple local keyword rules;
users can change them. Cached articles come first in the default reading order.
The Newest first option uses the original Chrome saved date.

The initial snapshot has 460 links and 31 full article bodies on the development
machine. Counts depend on the input files. Links without a body show their saved
description and an Open original action. The browser does not fetch or extract
uncached publisher pages. Some article images still require the network.

## Data and routing

`src/store.ts` owns an IndexedDB library snapshot. It seeds an empty browser
profile once. Later runs do not overwrite edits. Article actions and annotations
read the latest snapshot in a read/write transaction and update the UI only after
commit. Cross-tab notifications reload the current snapshot. Large article bodies
stay in separate seed files and load only when opened.

Article URLs use `/read/<encodeURIComponent(source URL)>`. Encoding preserves
protocol, query, fragment, and percent escapes without treating them as app
parameters. Browser back/forward and direct reload work through Vite's SPA
fallback. Any future static host must provide the same fallback.

`src/content.ts` removes active content and normalizes relative links before
DOMPurify sanitization. Original links open in a separate tab. Quotes use the
shared text-highlighter package, with text offsets and surrounding context.
Notes and highlights are local and survive reloads. Unsaving retains annotations;
adding an annotation saves the associated article. Archiving keeps favourites.
Card Delete removes the local article and its annotations together. The toast
offers Undo for ten seconds. Seed files and the native library are unchanged.

## UI and validation

React 19, Vite 8, and Base UI follow Med's library choices. React Router owns
navigation. Lucide supplies control icons. The header and favicon use the native
Arctic app icon from `Resources/Assets.xcassets/AppIcon.appiconset`.

Typography is defined in [typography.css](src/typography.css). The reading view
directly follows [Med's Markdown typography](../../med/src/web/components/MarkdownPreview.css):
17.5px Geist text (Med at 125%), 1.625 line height, a 38em measure, 1.5em paragraph spacing,
400-weight headings with 1.22 line height, and 600-weight strong text. Its heading
scale and margins also follow Med at 125%. Images can exceed the text measure.

Library card sizes were measured from the live
[Works in Progress](https://worksinprogress.co/) article cards on 3 October 2026
at 1440, 1100, 768, and 390px viewport widths: titles 20px/26px, summaries
12px/18px, bylines 12px/15px, and tags 11px/15px. We keep Arctic's EB Garamond
and monospace fonts. The reference uses a dedicated Editor-Bold face registered
at CSS weight 400. Arctic now scales these sizes to 125% and uses a lighter
EB Garamond 500 title weight.

EB Garamond and DM Sans come from Arctic's existing assets; see
[font notices](../THIRD_PARTY_NOTICES.txt). Geist and Geist Mono are copied from
Med's existing assets with their [SIL license](public/fonts/GEIST-OFL.txt).

The app follows the system light/dark theme, including menus, notes, and the
highlight toolbar. Card descriptions show at most three lines with an ellipsis.

Desktop uses two article columns plus the tag rail. Narrow screens move tags
above the library. The notes sidebar starts closed and remembers its visibility.
Use ⌘⇧B (Ctrl⇧B) or the top-right button to toggle it. Article actions live in
this sidebar. It uses an overlay on narrow screens and retains drafts when hidden.
The reader has a back arrow in place of the library header. Hover and keyboard focus expose
card actions; touch layouts keep them visible. Reduced motion is respected.

Press `/` to focus search outside text fields. Add article opens an inline link
preview modeled on the native ClipboardBanner. Paste a link into the library or
use the Paste link button. Save bookmarks it and stays in the library; Open
creates an unsaved entry when needed and opens Reader. Existing saved links offer
Open only. Dismiss does not write an article. URL queries and fragments remain
intact. Previews reuse existing library metadata; new URLs show their host until
metadata is available. This local app still does not fetch new publisher text.

The selection toolbar appears immediately and fades out over 150ms on dismissal;
Reduce Motion disables the fade. Exiting controls cannot receive input.

The selection toolbar adapts `~/papers/src/components/highlight-toolbar.tsx`:
a floating pill with four color swatches, a current-color ring, and copy feedback.
Arctic adds a note button that opens the sidebar. Click a highlight to recolor it;
click its current color to remove the highlight while retaining its note. Escape,
scroll, and outside clicks dismiss the toolbar. ⌘⇧C (Ctrl⇧C) copies the selection.

The Playwright suite uses a small seed through network fixtures while exercising
the production app, IndexedDB, navigation, sanitization, and highlighting. It
covers filters, save/favourite/archive/restore, tags, adding a URL, encoded direct
links, quote-note persistence/edit/delete, and mobile overflow/actions. Native
Swift and extraction code are unchanged.
