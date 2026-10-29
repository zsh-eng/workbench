# First sync on a new device

What Arctic for the web does between sign-in and a full library, how to
measure it, and what changed. Measured in October 2026 in the first-sync lab
(`scripts/first-sync-lab.ts`).

Status: built. "Before" is the base commit (`ad4cc6f5` with timing marks
only); "After" is the design below, as built.

## The critical path

1. **Account.** No account is remembered, so `/api/me` must answer before
   the app opens the account's IndexedDB database. The page is blank until
   then.
2. **Four clients, one after another.** `arctic` (links), `arctic-content`
   (text records), `arctic-annotations` and `arctic-reading`. Each sync is
   three requests in turn: `/sync/v3/state`, `/sync/v3/pull-stream` (with a
   CORS preflight), and `/sync/v3/state` again before a push that has
   nothing to send.
3. **Links.** A card needs `article/<id>` and `library/<id>`. The phone's
   first upload sent every `article/` record, then every `library/` record,
   then every `tags/` record, each family sorted by key. So no card can show
   until all `article/` records are in (3 pull pages of 6 for 750 links), and
   the newest links arrive anywhere in the `library/` pages.
4. **Covers.** Each card's og:image comes from its publisher. The first six
   cards load eagerly; the rest are `loading="lazy"`.

## The lab

```sh
# The lab API: the shared API with production's D1 and R2 delays.
SHARED_WORKER_CONFIG=wrangler.lab.jsonc SHARED_PERSIST_TO=<dir> \
  SHARED_APPS=none SHARED_API_PORT=5541 SHARED_INSPECTOR_PORT=5542 \
  SHARED_EXTRA_ORIGINS=http://localhost:5543 bun scripts/dev-shared.ts
# apps/arctic/Browser: a production build against it, and the images.
VITE_SHARED_API_URL=http://localhost:5541 bun x vite build --outDir <dist>
bun x vite preview --outDir <dist> --port 5543 --strictPort
bun scripts/first-sync-lab.ts images
bun scripts/first-sync-lab.ts seed medium   # small | medium | large, once
# From the repository root:
FIRST_SYNC_SIZE=medium FIRST_SYNC_PROFILE=near bun run kit time \
  http://localhost:5543/ --before apps/arctic/Browser/tests/kit/first-sync-device.ts \
  --steps apps/arctic/Browser/tests/kit/first-sync.ts --runs 5 --warmup 0 --timeout 900
```

Each run clears the app's storage and the browser cache, keeps the session
cookie, and opens the library at 390 × 844 in Chromium. `near` is the SIN
colo (25 ms round trip, 30 ms per D1 query, 6 MB/s); `far` is a European
colo (320 ms, 170 ms, 1.2 MB/s), as measured in
[bulk file downloads](../../../../docs/FILE_BATCH.md). The lab's images
server answers each og:image after 90–180 ms, one host per publisher.

| Size   | Links | Texts | Highlights | Sessions | Records |
| ------ | ----: | ----: | ---------: | -------: | ------: |
| small  |   120 |   100 |         20 |       60 |     540 |
| medium |   750 |   630 |        300 |      900 |   4,080 |
| large  | 2,000 | 1,700 |      2,000 |    4,000 |  13,700 |

`medium` has the shape of the real account (734 links, 626 texts). 76% of
links have an image, as in the real library; some are square, tall, a site
icon (a text card) or broken.

## Before

Medians in ms from navigation (5 runs near, 3 far; 3 and 2 for large).

| Size   | Colo | Blank until | First card | All listed | Screen covers | Sync done |
| ------ | ---- | ----------: | ---------: | ---------: | ------------: | --------: |
| small  | near |         179 |        624 |        624 |           837 |     2,480 |
| medium | near |         172 |        760 |        877 |         1,023 |     2,989 |
| large  | near |         176 |      1,005 |      1,344 |         1,457 |     5,051 |
| small  | far  |       1,233 |      3,302 |      3,302 |         4,343 |    12,259 |
| medium | far  |       1,230 |      3,882 |      4,319 |         5,071 |    13,942 |
| large  | far  |       1,235 |      4,846 |      6,196 |         6,701 |    18,856 |

"All listed" is when Saved counts every saved link. Until then the first
screen changes as each page lands: 2 to 4 times in medium and large, with
older links on top. Only at "All listed" is the top of the list right.

Where the time goes, medium, far:

| Step                                        |    ms | Share of first list            |
| ------------------------------------------- | ----: | ------------------------------ |
| App script (HTML and JS over the link)      |   864 |                                |
| Account (`/api/me`)                         |   370 | blank page                     |
| Scope (`/sync/v3/state`)                    |   546 |                                |
| Pull stream until its first page            | 1,697 | preflight, then 5–6 D1 queries |
| `article/` pages before any `library/` page |  ~390 |                                |
| The rest of the links' pages                |  ~600 | ~180 ms a page                 |
| IndexedDB, all six pages of links           |    87 | 2% of the pull                 |
| Render, last commit to cards                |  4–19 |                                |
| Push's scope request, with nothing to push  |   510 | after the list                 |
| Texts, highlights, reading: 3 × 3 requests  | 8,940 | sync done at 13.9 s            |

Large, near: IndexedDB commits take 569 ms of the links' 934 ms pull and
1,948 ms over all four namespaces; rendering stays under 20 ms a commit.

## The bottleneck

Round trips, not bytes or the device. Before the first record arrives, a
new device makes four requests in turn (account, scope, preflight, pull),
and the server reads D1 several times inside each. Then three more clients
repeat the same pattern, one after another, which is why a full sync takes
3–5 s near and 12–19 s far. IndexedDB and rendering are a few percent,
except IndexedDB in the large library.

## Proposal (client only)

1. **Run the four clients at once.** Each has its own state, records and
   cursor. The attempt waits for all four and then fails with the first
   error, as before. Expected: sync done near 1.0–1.6 s, far 4–7 s.
2. **Push only what is pending.** A sync calls `push` only when the store
   has unsent changes; an edit made during the pull asks for another sync,
   as it does today. Saves one request per client per sync, every sync.
3. **The account check brings the links' scope.** `/api/apps/arctic/me`
   answers like `/api/me` and sends the scope in `X-Sync-Scope`, as every
   namespaced route does (Spaced already asks it). The links' first pull
   uses that scope instead of asking `/state`. The server still checks the
   scope on the pull. Saves one request before the first page.
4. **A calm first sync.** From the sign-in redirect onwards, the library's
   frame shows with placeholder cards and "Getting your library…" instead of
   a blank page and an empty list. The cards show when the links' first
   pull ends, all at once and in order, instead of reshuffling.
   HIG [Collections](https://developer.apple.com/design/human-interface-guidelines/collections):
   avoid changing a layout "while people are viewing and interacting with
   it". If the first pull fails, the cards that arrived show.
5. **On-screen covers first.** No cover loads until the list is final, so
   no bandwidth goes to cards that move off the first screen. The cards on
   the first screen load eagerly at high priority, the rest lazily.

Not proposed: showing a card from `article/` alone (its folder, order and
read state are in `library/`), and IndexedDB changes (2% of the medium
pull).

## Critique

- **Parallel clients compete for the link.** Far, 1.2 MB/s: the other
  three pulls are about 0.15 MB gzip in medium, about 0.1 s of the links'
  pull. Their requests overlap the links' server time, so they cost less
  than they save. Measure first list both ways before keeping it.
- **IndexedDB contention.** All four write one object store, so their
  commits queue. Large: reading's commits (35 ms each) can delay a links
  commit. Measure.
- **Holding the cards trades first card for a right first screen.** The
  first card moves to "All listed": +0.1 s near, +0.5–1.3 s far, before the
  other changes. The other changes bring "All listed" forward by more than
  that (scope request, competition from covers of transient cards).
- **A scope from `me`.** It is the same object `/state` returns, set by the
  same middleware. The client checks its origin and namespace as
  `getScope` does. A returning device keeps asking `/state` before each
  pull, so an epoch change is still noticed.
- **Push only when pending.** `getPendingChanges` can drop a field edit
  whose record is gone; then `push` sends nothing either. No change.
- **Before the account is known** the page stays blank, as before: the
  placeholder needs the account's database to know its links were never
  pulled. Showing it from the sign-in redirect would need a flag kept
  across the redirect; not built.

## What was built

The proposal, with one change found by measuring: **the four clients start
at once, but the others' commits wait for the links' first pull** (or five
seconds: their streams stay open meanwhile, inside each request's 30-second
limit). All four write one IndexedDB object store, so fully parallel
commits queued in front of the links': large, near, every link listed at
2,757 ms instead of 1,344 ms before. Holding the other commits keeps their
requests in flight while the links commit alone. And the placeholder
shows once the account is known, not from the sign-in redirect (see
Critique).

| Variant (medians, ms)                | Medium near | Large near | Medium far | Large far |
| ------------------------------------ | ----------: | ---------: | ---------: | --------: |
| Before: all listed                   |         877 |      1,344 |      4,319 |     6,196 |
| Fully parallel: all listed           |         925 |      2,757 |      3,933 |     5,924 |
| Links first, then the rest at once   |         818 |      1,418 |      3,830 |     5,900 |
| Built (others' commits wait): listed |         802 |      1,440 |      3,837 |     5,762 |
| Built: sync done                     |         931 |      3,003 |      3,971 |     7,304 |

"Links first" lists as fast but finishes the sync 0.4–2.3 s later. The
variants are separate runs of two or three each.

## After

Medians in ms from navigation, before → after (5 runs near, 3 far; 3 and
2 for large). With the placeholder, the first card is when every link is
listed, in order, and the first screen changes once.

| Size   | Colo |   Blank until |    All listed | Screen covers |      Sync done |
| ------ | ---- | ------------: | ------------: | ------------: | -------------: |
| small  | near |     179 → 209 |     624 → 540 |     837 → 764 |    2,480 → 635 |
| medium | near |     172 → 209 |     877 → 802 |   1,023 → 971 |    2,989 → 931 |
| large  | near |     176 → 223 | 1,344 → 1,440 | 1,457 → 1,608 |  5,051 → 3,003 |
| small  | far  | 1,233 → 1,381 | 3,302 → 2,854 | 4,343 → 3,961 | 12,259 → 3,432 |
| medium | far  | 1,230 → 1,377 | 4,319 → 3,837 | 5,071 → 4,638 | 13,942 → 3,971 |
| large  | far  | 1,235 → 1,376 | 6,196 → 5,762 | 6,701 → 6,824 | 18,856 → 7,304 |

- **Sync done** is 1.7–3.9 times sooner: 9 requests instead of 14, and
  the clients overlap.
- **All listed** is 75–480 ms sooner, except large near (+96 ms): the
  links' last pull page waits for the other namespaces' commits already in
  IndexedDB's queue.
- **Blank until** is 30–47 ms later near and about 145 ms later far:
  `/api/apps/arctic/me` reads the namespace's epoch for the scope, one more
  D1 query than `/api/me`. It saves the 550 ms scope request after it.
- **Screen covers** loads 13–19 og:images instead of 15–36: none go to
  cards that leave the first screen.
- In large, the first card now shows 0.4–0.9 s later than before's first
  (wrong) card, in exchange for showing the right one.

## The restore island

The placeholder's "Getting your library…" is now the shared restore island
(`src/RestoreIsland.tsx`, packages/background-activity): it grows out of
the count by the title, or a phone's account button, says "Getting your
library · 2,000 links" (the links on this device so far; the library's
size is not known until its last page), waits for a connection or a
sign-in, says "Library ready" when the links' first pull has every page,
and folds back. Its colours come from each palette, at 4.5:1 or more in
every theme and mode (`src/styles.css`).

Large, near, 4 runs a side interleaved with the build before it (medians,
ms): all listed 1,439 → 1,461, screen covers 1,608 → 1,630, sync done
2,945 → 2,986. The island grows from about 0.7 s to 1.2 s and folds after
the list, and its width moves on the main thread each frame. With reduced
motion, which only fades it, there is no difference: 1,443 → 1,439,
1,606 → 1,599, 2,957 → 2,946 (3 runs a side).

## Server proposals (not built)

1. **One session read per sync request.** `/sync/v3/*` routes run
   `requireUser` twice: the namespace middleware and `createSyncHonoRoutes`'
   `requireAuth`. Each is a Better Auth session read in D1. Far, that is
   about 170 ms of each pull and push.
2. **Read the next pull page while sending this one.** `pull-stream` reads a
   page from D1, sends it, then reads the next. Far, the links' 16 pages in
   the large library took 3.4 s, about 210 ms a page, against a bandwidth
   floor under 1 s. Prefetching one page in the Worker hides the D1 time.
3. **The web does not need `taggingText`.** It is 1,052 of an `article/`
   record's 1,359 bytes on average in the real account (77%). A field filter is a protocol change; not
   proposed.
