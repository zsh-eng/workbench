# Arctic browser

A local web reading library with a two-column editorial layout, search, topic
filters, hover/focus actions, and a reading page with margin annotations.

From the repository root:

```sh
bun install
bun run --cwd apps/arctic/Browser browser:install
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
machine. Counts depend on the input files. Opening or saving a link without a
body starts a background download. Library startup does not fetch the whole
reading list. Article images still require the network.

## Data and routing

`src/store.ts` owns an IndexedDB library snapshot. It seeds an empty browser
profile once. Later runs do not overwrite edits. Article actions and annotations
read the latest snapshot in a read/write transaction and update the UI only after
commit. Cross-tab notifications reload the current snapshot. Large article bodies
stay in separate seed files or the IndexedDB `bodies` store and load only when
opened. The version 2 upgrade preserves the existing library and annotations.
Delete removes the associated downloaded body in the same transaction; Undo
restores it. A download finishing after deletion cannot recreate the article.

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

Library and article loading copy appears only after 400ms. Fast local reads show
no loading message. Errors still appear immediately, and local note saves keep
a stable button label while preventing duplicate submissions.

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
metadata is available. Save starts the download without waiting for the publisher;
Open joins that download and displays the result. Failed downloads retain the
bookmark and can be retried in the reader.

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

## Background downloads

`bun run dev:arctic-browser` starts Vite on 5186 and the Bun extraction service
on 5187. Vite proxies `/api` to the service. Stop the runner to stop both. For a
built preview, run `bun run --cwd apps/arctic/Browser service` separately from
`bun run --cwd apps/arctic/Browser preview`. This is a local service; static
hosting alone cannot fetch publisher pages through browser CORS restrictions.

The service uses the same Defuddle 0.19.4 as native Arctic:

1. Fetch HTML with an 8-second deadline and extract using LinkeDOM. No browser
   process starts when this provides readable text.
2. If extraction is insufficient, use a shared headless Chromium process.
   It loads scripts but blocks images, media, fonts, stylesheets, service workers,
   WebSockets, and non-GET requests. It polls for readable text after
   DOMContentLoaded instead of waiting for network idle or every asset.
3. Close each isolated browser context after extraction. Close Chromium after
   30 seconds idle. Allow three downloads and one rendered page concurrently;
   duplicate URLs share work. Rendered pages have a 15-second deadline, a maximum
   of 80 requests, and a 4 MiB limit per response.
4. Cache extraction results for seven days under
   `~/.cache/arctic-browser/articles` (override with `ARCTIC_CACHE_DIR`). Limit
   this cache to 128 entries / 128 MiB. The web app sanitizes the result with
   DOMPurify before storing a separate durable IndexedDB copy. That copy remains
   readable when the publisher or extraction service is offline. This does not
   provide a service worker to load the entire app while the local server is off.

The service accepts only local host/origin requests with the app's JSON header.
Every HTTP request, redirect, and rendered subrequest uses a validated, pinned
public IP address. The test publisher exemption is injected only by tests.
Publisher content is returned as JSON, never served as an executable document.
No browser profile, login cookies, or native app data is shared. Login-only,
POST-driven, blocked, and non-HTML pages can still fail; the reader keeps an
Open original action. There is no visible WebView and no sync.

Run `bun run --cwd apps/arctic/Browser test:service` for real HTTP extraction,
script-rendered fallback, cache reuse, request deduplication, and destination
checks. The browser download tests use the real Bun service and an isolated HTTP
publisher to verify Save, storage migration, offline reopening, Delete/Undo,
and deletion during an in-flight download. See [download measurements](docs/DOWNLOAD_VALIDATION.md).
