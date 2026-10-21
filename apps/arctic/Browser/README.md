# Arctic for the web

The Arctic reading library in a browser, at `https://arctic.zsheng.app`. It
syncs with Arctic on iPhone through the shared API (`apps/sync-server`) and the
same Google account. It shows Saved, Favourites, Archive and History, with the
phone's topics, and it reads the text of an article when the account has a
copy of it.

## Run and check

From the repository root:

```sh
SHARED_APPS=arctic/Browser bun run dev:shared
```

This starts the local shared API on `localhost:8792` and the app on
`http://localhost:5186`. A development build also offers a local email account
on the sign-in page; the local API creates it. To design with real titles and
images, copy the Workbench Backup mirror's Arctic records into a local account:

```sh
bun run --cwd apps/arctic/Browser scripts/local-library.ts <email> <password>
```

This writes only to the local API. Checks:

- `bun run build:arctic-browser` type-checks and builds.
- `bun run test:arctic-browser` runs the Playwright tests in `tests/` against
  the real app and a local API with a fresh database. A test acts as the phone
  through the API and checks the records that the phone receives.
- `bun run --cwd apps/arctic/Browser test:service` checks the extractor that
  `scripts/copies.ts` uses.

Deploy only with the owner's approval: `bun run deploy:arctic-browser`. It
publishes `dist/` as the static Worker `arctic-web` (see `wrangler.jsonc`).
`public/_headers` sets the content security policy.

## Data

The app keeps one IndexedDB database per account (`arctic:<userId>`) and syncs
two namespaces with `@zsh-eng/local-sync`:

| Namespace | Records | Written here |
| --- | --- | --- |
| `arctic` | `article/<id>`, `library/<id>`, `tags/<id>` from the phone | `library/<id>` only, and tombstones on Remove |
| `arctic-content` | `content/<id>`: the file, word count, byline and source of a text copy | all |

`<id>` is the SHA-256 of the article's canonical URL, as the phone computes it.
The phone validates every `arctic` record and stops a pull at one it cannot
read, so this app never adds a record family there, never changes a URL, and
never writes `article/` or `tags/` values.

A library edit is a field edit (`src/sync/storage.ts`). It applies to the
latest record when it uploads, so the phone's change to another field
survives. When a later record from another device changed the same field, that
field keeps the other device's value. Values use sorted keys and Swift
reference dates, so the phone decodes them to the same bytes. The app follows
the phone's rules: an unsaved article is neither archived nor favourite, and
opening an article marks it read with a visit time. Edits commit to IndexedDB
first and upload about a second later; a closed tab keeps them for the next
visit.

Reading time and highlights have their own namespaces, in the phone's formats
(approved 21 October 2026, the web first; the phone does not upload them yet):

| Namespace | Records |
| --- | --- |
| `arctic-reading` | `session/<UUID>`: one visit's active seconds (`src/reading.ts`) |
| `arctic-annotations` | `annotation/<UUID>`: a highlight or note (`src/annotations.ts`) |

Reading time counts as on the phone: time between two of the reader's own
actions (scroll, keys, pointer) counts when the gap is two minutes or less,
and a hidden tab pauses. A visit saves every five seconds and uploads within a
minute. **Reading** (`/reading`) shows the last seven days, today, articles
read for a minute or more, all time, and this week's articles.

Text copies are cleaned HTML files in `arctic-content`: no scripts, at most
2 MiB, named by XXH64 (`src/sync/xxh64.ts`; the server checks every hash). The
reader cleans a copy again with DOMPurify before it shows it. A copy under 120
words is refused as a preview or sign-in page; a new copy replaces one only
when it is 30% longer. Opened copies stay in IndexedDB, and a service worker
keeps the app shell, so the library and opened articles work offline.
**Settings → Offline** downloads the text of every saved article into this
browser (`src/offline.ts`, four at a time, and asks the browser to keep the
storage), and can download new text after each sync. Images still load from
each publisher.

## Article text

The phone does not upload its offline copies yet. The **Article text** page
(`/copies`) adds copies in two ways:

- **From files.** Arctic's own offline copies (`Downloads/<id>.html`), pages
  saved with Save Page As, and files from the copies script. Files match
  articles by URL, then by host and path when one article alone has that path.
- **From this browser.** The app opens articles without text in one tab. The
  **Send to Arctic** bookmarklet, run in that tab, posts the page to the app,
  which extracts it with Defuddle (loaded on demand) and keeps the text. A page
  behind a login or paywall is kept as this browser sees it. The bookmarklet
  also works alone: it opens a small Arctic window that saves the page when it
  belongs to the library.

`scripts/copies.ts <folder>` collects the copies that this Mac already has from
the Mac app's container, or from a copy of the iPhone app's folder:

```sh
xcrun devicectl device copy from --device <udid> --domain-type appDataContainer \
  --domain-identifier com.zsheng.ArticleReader \
  --source "Library/Application Support/ArticleReader" --destination <folder>
bun scripts/copies.ts <out> --native <folder>
```

With `--extract`, it also downloads saved articles that have no copy with
`server/extractor.ts` (Defuddle on the fetched HTML, then a headless Chromium
page; see [download measurements](docs/DOWNLOAD_VALIDATION.md)). With
`--unwall`, it reads saved articles on the phone's Unwall list
(`../Resources/unwall-domains.json`) through `unwall.app` in a headless browser,
as the phone opens them, and keeps copies of 400 words or more: Unwall shows
the publisher's teaser when it cannot open a page. On 21 October 2026 it read
38 of 51 such articles (NYT, FT, The Atlantic, Bloomberg, WSJ, The Economist);
most of The Economist stayed a teaser. Every pass skips pages that already have
text in the account (from the Workbench Backup mirror). The output
holds personal article text: keep it private, and delete it after the import.

`scripts/upload.ts <folder>` imports such a folder without a browser. It uses
the Workbench Backup credential (`wb auth login`), which may upload Arctic
article text and nothing else, and it follows the rules of the Article text
page: files match articles the same way, and the minimum length, size limit
and 30% rule apply. `--dry-run` reports what it would upload. Run it again
safely: copies that are already there are kept.

## Design

One system with the phone app: the platform sans-serif for interface and
reading, a neutral palette, hairline rules, and untreated publisher images.
Glacier blue marks only small details, such as the favourite star. Folders are
large text tabs; a card is a 16:10 cover, the source line and the title. An
article without an image shows its standfirst as a text cover. The List layout
shows a row per article (source line, two lines of title, a small image), about
eight on a phone screen. The reader sets
20 px text on a 640 px measure and hides its bar while you read down. It shows
the cover image once: when the text starts with the same picture (through an
image proxy or at another size, `src/text.ts`), or with any picture under a
Substack quote card, the text's own image and caption take the cover's place.
Opening an article waits up to 100 ms for its text, so the text arrives with
the page.

**Settings** (`/settings`, and the **Aa** panel in the reader) follow Reader's:
they belong to the browser (`src/settings.ts`, localStorage). Appearance is
System, Light or Dark; a theme is a pair of palettes: Arctic (neutral), Flexoki
(warm paper and ink) and Night (Arctic by day, black by night).
`public/appearance.js` applies the theme before the first paint. Reading
settings are the font (system sans, `ui-serif`, or Iowan Old Style), size,
line spacing, width and alignment; `-` and `=` change the size in the reader. The forward page change
is a view transition of the cover and title.

Shortcuts: `/` searches. In the reader, `F` favourites, `E` archives and
returns, `O` opens the original, and `Escape` returns.

A library of 600 or more articles stays quick:

- A returning visit opens this browser's copy at once, as Reader does, and
  checks the account in the background. The first cards paint about 55 ms
  after the page starts (140 ms with a 4× CPU slowdown and 150 ms latency),
  where the account check first made it 300 ms. The performance marks
  `arctic:script`, `arctic:open` and `arctic:cards` time each step.
- A long folder renders 36 cards first, then 72 more each frame. Back and
  Forward render all cards at once, so the scroll position returns.
- The library stays mounted, hidden with React `Activity`, while an article
  or another page is open. Back shows it again without a new render.
- One menu serves every card; a card has a plain button.
- A sync keeps the object of each article whose records did not change, so
  its card does not render again. A status change alone renders no cards.

On a production build with 607 saved articles (M-series Mac, Chromium), the
first cards of any folder paint 14–36 ms after the click, all cards follow
within 130 ms, and no task blocks for 50 ms or more. Back from the reader
takes 56 ms. Before these changes, the Saved folder took 125 ms and Back
133 ms.

The first load is 604 kB of JavaScript (195 kB gzip): React, React Router,
Base UI menus and tooltips, DOMPurify, zod (through local-sync) and the app.
Defuddle (309 kB, 87 kB gzip) loads only to extract a page.
