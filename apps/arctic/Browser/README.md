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

## UI and validation

React 19, Vite 8, and Base UI follow Med's library choices. React Router owns
navigation. Lucide supplies control icons. The local EB Garamond and DM Sans
fonts are copied from Arctic's existing assets; see
[font notices](../THIRD_PARTY_NOTICES.txt).

Desktop uses two article columns plus the tag rail. Narrow screens move tags
above the library and notes below the article. Hover and keyboard focus expose
card actions; touch layouts keep them visible. Reduced motion is respected.

The Playwright suite uses a small seed through network fixtures while exercising
the production app, IndexedDB, navigation, sanitization, and highlighting. It
covers filters, save/favourite/archive/restore, tags, adding a URL, encoded direct
links, quote-note persistence/edit/delete, and mobile overflow/actions. Native
Swift and extraction code are unchanged.
