# @workbench/arctic-links

Arctic's records for a saved link, as Arctic on iPhone writes them
(`ArticleSyncCodec` in `apps/arctic/Sources/ArticleSyncRepository.swift`), and a
link's preview, read from its page as the phone reads it
(`ArticleMetadata.parse` in `apps/arctic/Shared/ArticleMetadata.swift`). The
package exports TypeScript source and has no dependencies. Three programs use
this one copy:

- Arctic for the web saves a link and fills its preview
  (`apps/arctic/Browser/src/links.ts`).
- `wb arctic save` and `wb arctic backfill-previews` save links and fill
  previews from the terminal (`apps/sync-backup`).
- The shared API reads a page's preview for the web (`src/preview.ts`) and
  checks wb's writes (`src/cli-links.ts`), both in `apps/sync-server`.

| Export                    | What it is                                                    |
| ------------------------- | ------------------------------------------------------------- |
| `canonicalURL`            | The phone's canonical URL of a pasted link, or null           |
| `articleId`               | SHA-256 of the canonical URL: the records' `<id>`             |
| `localID`                 | The phone's UUID for an id, which names its offline copy      |
| `newLinkRecords`          | `article/<id>`, `library/<id>` and `tags/<id>` for a new link |
| `savedLibrary`            | A known link saved again: a field edit of `library/<id>`      |
| `linkTitle`               | A page's title as a new link's title: one line, well-formed   |
| `readPreview`             | A page's title, description, image and icon, by phone rules   |
| `previewPatch`            | The preview fields an `article/<id>` record lacks             |
| `withPreview`             | That record with only those fields filled                     |
| `cleanPreview`            | The valid fields of a preview from elsewhere                  |
| `linkChangesProblem`      | Why a push does more than these three writes, or nothing      |
| `encodeSorted`, `toSwift` | Sorted-key JSON and Swift reference dates                     |

The phone validates every `arctic` record and stops a pull at one it cannot
read. `canonicalURL` therefore refuses two kinds of address that the WHATWG
parser takes but Swift's URL decoder does not: a host with characters other
than letters, digits, `-`, `_` and `.`, and a path whose escapes are not UTF-8
(Latin-1 `caf%E9`). On 26 October 2026, 1,650 random canonical URLs were
fixed points of a copy of the phone's `canonicalURL`, with the same id, on
macOS 27 Foundation (not yet on an iPhone). Keep these values in step with `ArticleSyncCodec.canonicalURL`,
`identity` and `values`; `apps/arctic/Browser/tests/links.spec.ts` checks the
records that the web writes.

## Previews

`readPreview(html, pageURL)` reads the page's head as the phone does: the title
from `og:title`, `twitter:title`, then `<title>`; the description (the record's
`subtitle`) from `og:description`, `description`, then `twitter:description`;
`imageURL` from `og:image`, then `twitter:image`; `faviconURL` from the first
`<link>` whose `rel` has `icon` or `apple-touch-icon`, else `/favicon.ico`.
Relative addresses resolve against the page's final URL, after redirects. It
skips comments and the text of scripts and styles, stops at `</head>` or
`<body>`, and decodes character references. It keeps an address only in
`canonicalURL` form (at most 2,048 characters), so the phone can decode it, and
a description as one line of at most 500 characters. A challenge page's title
("Just a moment…") is not kept. The tests are in `preview.test.ts`
(`bun test` here).

Two rules differ from the phone's, on purpose. The phone gives no icon when a
page names none; here `/favicon.ico` stands in (the owner asked for it; the
web shows the site's initial when the file is missing). And the phone reads
tags anywhere in the page; here only the head, so the shared API reads at
most the start of a page.

A preview fills only what a record lacks: `previewPatch` and `withPreview`
set `imageURL`, `faviconURL` and `subtitle` where the record has none (absent,
null or blank) and keep every other field, so the phone's own preview is never
replaced. The phone still fetches its own preview while the record has no
`taggingText`, and then its values replace these.

`linkChangesProblem` accepts a third shape from the Workbench Backup
credential, a **preview**: only the `article/<id>` record of an article in the
library, equal to `withPreview` of the stored record, with each new field in
the form `readPreview` writes.
