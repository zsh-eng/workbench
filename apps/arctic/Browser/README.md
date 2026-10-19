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
visit. Highlights, notes and reading time stay on the phone.

Text copies are cleaned HTML files in `arctic-content`: no scripts, at most
2 MiB, named by XXH64 (`src/sync/xxh64.ts`; the server checks every hash). The
reader cleans a copy again with DOMPurify before it shows it. A copy under 120
words is refused as a preview or sign-in page; a new copy replaces one only
when it is 30% longer. Opened copies stay in IndexedDB, and a service worker
keeps the app shell, so the library and opened articles work offline.

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
page; see [download measurements](docs/DOWNLOAD_VALIDATION.md)). The output
holds personal article text: keep it private, and delete it after the import.

## Design

One system with the phone app: the platform sans-serif for interface and
reading, a neutral palette, hairline rules, and untreated publisher images.
Glacier blue marks only small details, such as the favourite star. Folders are
large text tabs; a card is a 16:10 cover, the source line and the title. An
article without an image shows its standfirst as a text cover. The reader sets
20 px text on a 640 px measure, hides its bar while you read down, and shows
the hero image once. Light and dark follow the system. The forward page change
is a view transition of the cover and title.

Shortcuts: `/` searches. In the reader, `F` favourites, `E` archives and
returns, `O` opens the original, and `Escape` returns.

The first load is 602 kB of JavaScript (194 kB gzip): React, React Router,
Base UI menus and tooltips, DOMPurify, zod (through local-sync) and the app.
Defuddle (309 kB, 87 kB gzip) loads only to extract a page.
