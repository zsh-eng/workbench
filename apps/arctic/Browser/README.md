# Arctic for the web

The Arctic reading library in a browser, at `https://arctic.zsheng.app`. It
syncs with Arctic on iPhone through the shared API (`apps/sync-server`) and the
same Google account. It shows Saved, Favourites, Archive and History, with the
phone's topics, reads the text of an article when the account has a copy of
it, and saves new links.

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

- Tests: `bun run test:arctic-browser`.
- `bun run build:arctic-browser` type-checks and builds;
  `bun run --cwd apps/arctic/Browser lint` lints.
- The Playwright tests in `tests/` run in parallel against the real app and a
  local API with a fresh database; each test signs up its own account. A test
  acts as the phone through the API and checks the records that the phone
  receives. `tests/offline.spec.ts` and `tests/releases.spec.ts` run against
  a production build, because only that registers the service worker.
  `E2E_PORT`, `E2E_PREVIEW_PORT`, `E2E_API_PORT` and `E2E_INSPECTOR_PORT` move
  the app, the production build, the API and its inspector, and
  `E2E_RELEASE_PORT` the releases test's own server, so two worktrees can run
  the tests at once.
- `bun run --cwd apps/arctic/Browser test:service` checks the extractor that
  `scripts/copies.ts` uses, and `scripts/text.ts`, which reads a page for
  `wb arctic`.

Deploy only with the owner's approval: `bun run deploy:arctic-browser`. It
publishes `dist/` as the static Worker `arctic-web` (see `wrangler.jsonc`).
`public/_headers` sets the content security policy.

## Data

The app keeps one IndexedDB database per account (`arctic:<userId>`) and syncs
two namespaces with `@zsh-eng/local-sync`:

| Namespace        | Records                                                                | Written here                                                     |
| ---------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `arctic`         | `article/<id>`, `library/<id>`, `tags/<id>` from the phone             | `library/<id>`; all three for a saved link; tombstones on Remove |
| `arctic-content` | `content/<id>`: the file, word count, byline and source of a text copy | all                                                              |

`<id>` is the SHA-256 of the article's canonical URL, as the phone computes it.
The phone validates every `arctic` record and stops a pull at one it cannot
read, so this app never adds a record family there and never changes a URL. It
writes `article/` and `tags/` values only for a link it saves, exactly as the
phone writes a new article (see Saving links).

A library edit is a field edit (`src/sync/storage.ts`). It applies to the
latest record when it uploads, so the phone's change to another field
survives. When a later record from another device changed the same field, that
field keeps the other device's value. Values use sorted keys and Swift
reference dates, so the phone decodes them to the same bytes. The app follows
the phone's rules: an unsaved article is neither archived nor favourite, and
opening an article marks it read with a visit time. Edits commit to IndexedDB
first and upload about a second later; a closed tab keeps them for the next
visit.

Sync runs on open, when the network returns, on return to the tab and every
five minutes, and backs off after a failure. Its state comes from local-sync's
sync controller, as in Reader ([states and rules](../../../packages/local-sync/docs/SYNC_STATES.md)).
The remembered account opens the library offline; only the server ends it.
When the session ends, the library stays open, its edits stay queued, and the
account menu asks to sign in again. The bar names a state that needs the
reader (offline, sign in again, a server that keeps failing); the account menu
always shows it.

Reading time and highlights have their own namespaces, in the phone's formats
(approved 21 October 2026). The phone syncs them as well, so a passage
highlighted on either shows on both:

| Namespace            | Records                                                         |
| -------------------- | --------------------------------------------------------------- |
| `arctic-reading`     | `session/<UUID>`: one visit's active seconds (`src/reading.ts`) |
| `arctic-annotations` | `annotation/<UUID>`: a highlight or note (`src/annotations.ts`) |

Reading time counts as on the phone, with the shared rule of
[activity-time](../../../packages/activity-time/README.md): time between two of
the reader's own actions (keys, pointer, touch, wheel, and a scroll just after
one) counts when the gap is two minutes or less. A hidden tab, or another
window in focus, pauses. A scroll that restores the position is not an action.
A visit saves every five seconds and uploads within a minute; a visit under a
second is not kept. **Reading** (`/reading`) shows the last seven days, today, articles
read for a minute or more, all time, and this week's articles.

Highlights follow the phone too (`Resources/annotations.js`): a quote keeps
its exact text and 48 characters on each side, and finds its place by text, so
a passage from another copy of the article still shows. Selecting text offers
four colours, a note and Copy (`H` highlights); selecting a highlight changes
its colour or note, or removes it, with Undo. The CSS Custom Highlight API
paints them without changing the article's HTML. **Notes** in the reader bar
lists the passages in reading order and holds a note on the whole article;
**Highlights** (`/highlights`) lists every passage by article. A removed
passage keeps its record with `deletedAt`, as on the phone.

Text copies are cleaned HTML files in `arctic-content`: no scripts, at most
2 MiB, named by XXH64 (`src/sync/xxh64.ts`; the server checks every hash). The
reader cleans a copy again with DOMPurify before it shows it. A copy under 120
words is refused as a preview or sign-in page; a new copy replaces one only
when it is 30% longer. Opened copies stay in IndexedDB, and a service worker
keeps the app shell, so the library and opened articles work offline.
**Settings → Offline** downloads the text of every saved article into this
browser (`src/offline.ts`, and asks the browser to keep the storage), and can
download new text after each sync. It asks for up to 32 texts in one request,
six requests at once, and keeps each text as it arrives
([bulk file downloads](../../../docs/FILE_BATCH.md)); against a server without
that route it asks for one text at a time. Images still load from
each publisher.

Neither store grows with time alone. The service worker (`public/sw.js`)
keeps the files of two versions, the newest and the one before, which an
open tab may still run; a page of a new version replaces the older one.
After the first sync of a visit, a copy that no text record names any more
(one a longer copy replaced, or the text of a removed article) leaves
IndexedDB, unless it was saved in the last day. A copy that a record names
stays, whether its article is saved or not. `tests/releases.spec.ts` and
`tests/storage.spec.ts` check both.

## Saving links

**Save a link** (the **+** button, or `⌘V` with a link anywhere in the
library) writes the phone's three records for a new article
(`ArticleSyncCodec.values`): `article/<id>` with the title and an empty
description, `library/<id>` saved now, and `tags/<id>` with empty lists and the
phone's generation for the id (`src/links.ts`, with the codec in
`packages/arctic-links`). The URL is the phone's
canonical URL: http or https, a lowercase host, no default port and no
fragment, with the query kept. The browser's URL parser normalizes first; then
every character that Swift's parser would escape (`|`, `^`, `[`, a lone `%`, and
others) is escaped, so both apps hash the same string. Records for 18 awkward
addresses passed the phone's `canonicalURL`, `identity` and decoders on Swift
Foundation (21 October 2026), and `tests/links.spec.ts` checks the records. A
host with characters other than letters, digits, `-`, `_` and `.`, or a path
whose escapes are not UTF-8 (Latin-1 `caf%E9`), is not a web address here:
Swift's URL decoder refuses it, and the phone would stop its pull at it.

The web cannot fetch another site, so the link is saved at once with a title
from its address ("how-sea-ice-keeps-time" becomes "How sea ice keeps time"),
and its preview follows: the shared API's preview route
(`apps/sync-server`, `POST /api/arctic/preview`) fetches the page and reads
its title, description, og:image and icon by the phone's rules (`readPreview`
in `packages/arctic-links`). The app syncs, so a preview the phone wrote
meanwhile counts, and then writes them into the article's record as a field
edit: `subtitle`, `imageURL` and `faviconURL` only where the record has none,
and the page's title only in place of the one from the address. (A phone
preview that reaches the account in the second between that sync and the
upload is still replaced; the phone fetches its own again, because the record
then has no `taggingText`.) A slow site never holds the save; without an answer nothing changes.
Arctic on iPhone still fetches its own preview and topics when it next opens.
A link already in Saved is pointed out; one from History is saved again. Undo
removes a new link with tombstones.

While its preview loads, a new link without a picture keeps a picture's
place, as the phone's cards do while metadata is pending: an empty cover in
Cards and List, and a lead or a tile in Magazine. The picture is decoded
before the record changes, so it fills that place in one change and nothing
below moves for it (`tests/preview.spec.ts`, and the iPad check in
`tests/magazine.spec.ts`); a page without a picture gives the place up with
the list's motion. A new title or description can still change a card's
height by a line.

**From the terminal**, `bun run wb arctic save <url…>` (Workbench Backup,
`apps/sync-backup`) writes the same records from the same package, and then
fetches each link's text (see Article text) and fills its preview from the
same HTML. Its title is the page's own, or its host when the page has none,
as the phone's own add writes. `wb arctic backfill-previews` fills the
previews of saved links that have none. The shared API
checks every record that its credential writes (`apps/sync-server`,
`src/cli-links.ts`). `tests/cli.spec.ts` saves the same links here and with
`wb`, and compares what the phone receives: the same bytes, but for the title
and the saved time.

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
article text and save links, and it follows the rules of the Article text
page (`copyProblem` in `src/copy.ts`): files match articles the same way, and
the minimum length, size limit and 30% rule apply. `--dry-run` reports what it
would upload. Run it again safely: copies that are already there are kept.

`bun run wb arctic save` and `bun run wb arctic text` read one page at a time
with `scripts/text.ts`: the same extractor, the same cleaning as upload.ts,
and the same rules. They report why a page gave no text: a PDF, an HTTP
error, or a paywall preview, which is under 400 words on a site from the Unwall
list or on a page marked `isAccessibleForFree: false`. With `--unwall`, they
read listed sites through Unwall, as `--unwall` above does.

## Design

One system with the phone app: the platform sans-serif for interface and
reading, a neutral palette, hairline rules, and untreated publisher images.
Glacier blue marks only small details, such as the favourite star and the
reading progress. Each width gets the layout that suits its hands:

- **Phone** (720 px and narrower). The top holds the folders on one line, the
  current one on a capsule that slides, and the account. Search and **+** sit
  at the bottom, in thumb reach; search turns the top line into the field.
  **+** saves a link the way Safari edits its address: the search capsule
  becomes a link field above the keyboard, with Paste while it is empty and
  Save once it is not; the **+** turns to × and the list waits under a light
  scrim (`LinkDock` in `src/AddLink.tsx`). On iPhone, Safari shows its own
  Paste button above ours, and the link saves when you tap it. The dock's
  controls keep the field focused on mousedown, because Safari on iOS sends a
  mousedown for each tap, even when pointerdown is cancelled. Chromium does
  not, so check changes to the dock in the iOS Simulator.
  The library is a list by default. The reader has no top bar: one toolbar at
  the bottom holds Back, Notes, Text, Favourite, Archive and More, and steps
  down while you read on. A selection turns that toolbar into the highlight
  bar, clear of the system's selection menu.
- **Wide** (1100 px and wider). A sidebar holds Save a link, the folders and
  topics with counts, Highlights, Reading time and the account; the search,
  title and cards share one left edge.
- Between the two, the large folder tabs and the top bar remain.

A card is a 2:1 cover, the source line and the title. An article without a
usable image (none, a blank spacer, or a site icon under 300 px) is a text
card: its title and the start of its description. A description that the text
repeats in its opening shows once.

**Layouts.** The library is Magazine, Cards or List (the switch beside the
title, and Settings). Magazine is the default on a touch screen wider than a
phone, such as an iPad; Cards on a screen without touch; List on a phone. A choice this
browser saved stays. Magazine gives each link's og:image the card: 1.91:1
pictures in two columns on every iPad (one below 600 px of list, three from
1,240 px), a lead when the first link has a picture, and links without one as
site covers (the title on the site's colour) or, in longer runs, a band of
headlines in whole rows. Its pictures show how far this browser has read
each article. [docs/MAGAZINE.md](docs/MAGAZINE.md) has the design, its
references and its sizes.

**Sheets.** On a phone, Notes, Text and theme, More and the account are
React Aria sheets (`src/sheet.tsx`, after the EPUB Reader's). The
browser's own scrolling moves them, so a drag follows the finger, keeps its
momentum and rests on detents. Text and theme rests at half height without
dimming, so each change shows on the page; Notes rests at 55% of the screen.
A single field gets no sheet: it would cover the list to hold one line above
the keyboard. Wider windows use Base UI popovers and menus with the same
content (`src/surface.tsx` chooses).

React Aria brings a sheet in by scrolling one screen height, however tall the
sheet is, so a half-height sheet spent the first part of that scroll below the
screen. Arctic starts the scroll with the sheet's top at the bottom edge, so it
moves from the first frame. On a production build in a phone-sized window with
a 4× CPU slowdown, a sheet now shows 53–67 ms after the tap (82–211 ms before),
and More comes to rest in 293 ms (503 ms). The sheet code (81 kB, 27 kB gzip)
is a separate chunk that a phone loads just after the first page appears; the
service worker keeps it, so a sheet opens offline. When the code cannot load,
a toast says so, and the next tap tries again.

**Toasts** say what just happened, centred above the bottom bar and the home
indicator. A change that can be taken back offers Undo for eight seconds, with
a ring and a number that count down: Workbench's toast
(`@workbench/elements/toast`), which Reader shows too. Pointing at the toast,
focus in it, or a hidden tab holds the count. Screen readers hear each toast
from a status region, and Undo is a button in it.

**Motion** is short and shows where things go. Opening an article moves its
cover and title into the page (a view transition), and Back reverses it into
the card. When a change adds or removes a card, the cards on screen move to
their places and the card fades (`src/motion.ts`); only on-screen cards take
part. Bars slide away while reading down. With reduced motion, changes are
instant.

The reader sets 20 px text on a 640 px measure and hides its bar while you
read down. It shows the cover image once: when the text starts with the same
picture (through an image proxy or at another size, `src/text.ts`), or with
any picture under a Substack quote card, the text's own image and caption take
the cover's place.

**Settings** (`/settings`, and the **Aa** panel in the reader) follow Reader's:
they belong to the browser (`src/settings.ts`, localStorage). Appearance is
System, Light or Dark; a theme is a pair of palettes: Arctic (neutral), Flexoki
(warm paper and ink) and Night (Arctic by day, black by night).
`public/appearance.js` applies the theme before the first paint. Reading
settings are the font (system sans, `ui-serif`, or Iowan Old Style), size,
line spacing, width and alignment.

Shortcuts: `/` searches, `⌘V` saves a copied link, and `⌘Z` takes back a
change while its toast offers Undo. In the reader, `F` favourites, `E` archives
and returns, `O` opens the original, `H` highlights the selection, `-` and `=`
change the text size (also in the Aa panel), and `Escape` returns. While a
sheet, menu or popover is open, the keys are its.

A library of 600 or more articles stays quick:

- A returning visit opens this browser's copy at once, as Reader does, and
  checks the account in the background. The first cards paint about 55 ms
  after the page starts (140 ms with a 4× CPU slowdown and 150 ms latency),
  where the account check first made it 300 ms. The performance marks
  `arctic:script`, `arctic:open` and `arctic:cards` time each step.
- A new device's first sync runs the four sync clients at once; the links
  commit to IndexedDB first, and the account check brings their scope. Until
  every link is in, the library shows placeholder cards, then all the cards
  at once, in order. On a production-like link (medium library, SIN colo)
  every link is listed at 0.8 s and the sync ends at 0.9 s (3.0 s before).
  `arctic:account`, `arctic:sync:<namespace>`, `arctic:commit` and
  `arctic:synced` time it; [docs/FIRST_SYNC.md](docs/FIRST_SYNC.md) has the
  lab and the numbers.
- A long folder renders 36 cards first (12 on a phone), then 72 more each
  frame. Back and Forward render all cards at once, so the scroll position
  returns.
- An article's text and cover load before it opens: when the pointer rests on
  its card for 60 ms, when a touch or click starts, when the card takes focus,
  and, while the browser is idle, for the cards on screen (texts this browser
  keeps, and six more from the network unless Save-Data is on). The loader
  then waits at most 100 ms, usually not at all, so the page appears with its
  text and a decoded cover. The last 24 cleaned texts and covers stay in
  memory. `arctic:load`, `arctic:loaded` and `arctic:text` time an open.
- The library stays mounted, hidden with React `Activity`, while an article
  or another page is open. Back shows it again without a new render.
- One menu serves every card; a card has a plain button, and one set of
  listeners on the list prefetches for every card.
- A sync keeps the object of each article whose records did not change, so
  its card does not render again. A status change alone renders no cards.

On a production build with 603 saved articles (M-series Mac, Chromium), a click
on a card shows the article's text in 60 ms (median of 8; 73 ms before
prefetching), or 148 ms on a phone-sized window with a 4× CPU slowdown (177 ms
before). The first cards of any folder paint 14–36 ms after the click, and
Back from the reader takes 56 ms.

The first load is 651 kB of JavaScript (213 kB gzip): React, React Router,
Base UI menus, popovers and tooltips, DOMPurify, zod/mini (through local-sync),
the file-batch downloader and the app. The sheet (81 kB, 27 kB gzip) and Defuddle (309 kB, 87 kB gzip,
only to extract a page) load separately.
