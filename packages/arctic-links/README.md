# @workbench/arctic-links

Arctic's records for a saved link, as Arctic on iPhone writes them
(`ArticleSyncCodec` in `apps/arctic/Sources/ArticleSyncRepository.swift`). The
package exports TypeScript source and has no dependencies. Three programs use
this one copy:

- Arctic for the web saves a link (`apps/arctic/Browser/src/links.ts`).
- `wb arctic save` saves links from the terminal (`apps/sync-backup`).
- The shared API checks that command's writes (`apps/sync-server`).

| Export                    | What it is                                                    |
| ------------------------- | ------------------------------------------------------------- |
| `canonicalURL`            | The phone's canonical URL of a pasted link, or null           |
| `articleId`               | SHA-256 of the canonical URL: the records' `<id>`             |
| `localID`                 | The phone's UUID for an id, which names its offline copy      |
| `newLinkRecords`          | `article/<id>`, `library/<id>` and `tags/<id>` for a new link |
| `savedLibrary`            | A known link saved again: a field edit of `library/<id>`      |
| `linkTitle`               | A page's title as a new link's title: one line, well-formed   |
| `linkChangesProblem`      | Why a push does more than these two writes, or nothing        |
| `encodeSorted`, `toSwift` | Sorted-key JSON and Swift reference dates                     |

The phone validates every `arctic` record and stops a pull at one it cannot
read. Keep these values in step with `ArticleSyncCodec.canonicalURL`,
`identity` and `values`; `apps/arctic/Browser/tests/links.spec.ts` checks the
records that the web writes.
