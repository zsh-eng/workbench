# First review on a new device

A person who signs in to Spaced on a new device waits for the whole
restore before the first card shows: Spaced keeps "Restoring your cards and
review history…" on every page until the last record commits, and only
then loads `operations` into memory. This file holds the measurements, the
go/no-go bar (written before any prototype was measured), the proposal, its
critique and the results. The engine side is local-sync's
[priority restore](../../../packages/local-sync/docs/PRIORITY_RESTORE.md).

## The restore lab

`scripts/restore-lab.ts` seeds synthetic accounts on a local sync-server.
Reader's restore-lab proxy (`apps/reader/scripts/restore-lab.ts proxy`)
serves the API and the builds over HTTPS and HTTP/2 with the same network
profile as Reader's lab: 40 ms per request, 150 ms more per authenticated
request, one 50 Mbit/s link for all API responses. The kit modules
`tests/kit/restore-lab-device.ts` and `tests/kit/fresh-restore.ts` sign in,
clear the app's storage for each run, open Review at 390 × 844 and record:

- `firstReview`: the first due card on screen with its grade buttons, not
  behind the restoring screen. The metric.
- `restored`: the sync state says the first pull has finished.
- `settled`: the first frame after both with no "Restoring" text anywhere.
- `counts`: each change of the due count beside the Spaced icon (shown at
  phone width), with whether "Restoring" text was on screen.
- each API request, and the IndexedDB row counts at the end.

```sh
# apps/sync-server: a local server for the lab's origins (ports 5631-5637).
bun x wrangler d1 migrations apply workbench-sync-local --local \
  --persist-to .wrangler/spaced-restore-lab
bun x wrangler dev --local --port 5631 --ip 127.0.0.1 --inspector-port 5637 \
  --persist-to .wrangler/spaced-restore-lab \
  --var BASE_URL:https://localhost:5632 \
  --var APP_ORIGINS:https://localhost:5633,https://localhost:5634
# apps/spaced2: a production build for the lab API, served on 5635.
VITE_SHARED_API_URL=https://localhost:5632 bun run build
bun x vite preview --port 5635 --strictPort --host 127.0.0.1
# Workbench root: the shaped link; a second build on 5636 behind 5634.
RESTORE_LAB_API=https://localhost:5632 LAB_API_UPSTREAM=http://127.0.0.1:5631 \
  RESTORE_LAB_APPS=https://localhost:5633=http://127.0.0.1:5635,https://localhost:5634=http://127.0.0.1:5636 \
  node apps/reader/scripts/restore-lab.ts proxy
bun apps/spaced2/scripts/restore-lab.ts seed large   # small | medium | large
NODE_TLS_REJECT_UNAUTHORIZED=0 RESTORE_LAB_SIZE=large bun run kit time \
  https://localhost:5633/ --before apps/spaced2/tests/kit/restore-lab-device.ts \
  --steps apps/spaced2/tests/kit/fresh-restore.ts --runs 1 --warmup 0 --timeout 900
```

`tests/kit/grade-during-restore.ts` instead grades cards while the history
restores; its reviews reach the server, so give it a second account
(`seed large large-grades`, then `RESTORE_LAB_ACCOUNT=large-grades`).
`RESTORE_LAB_PROFILE` and `RESTORE_LAB_TRACE` record a CPU profile or a
trace of a run (`fresh-restore.ts`).

The accounts are synthetic, with the record mix the schema and the totals
in `OPFS_STORAGE_BENCHMARK.md` suggest (about 30,000 card and deck records
of 10 MB and 67,000 review records of 34 MB in the largest account), not
any user's records:

| Size   | Cards | Records | `operations` | Review records | Due now |
| ------ | ----: | ------: | -----------: | -------------: | ------: |
| small  |   100 |   1,232 |          466 |            766 |      12 |
| medium | 1,000 |  11,567 |        4,516 |          7,051 |      95 |
| large  | 7,000 | 101,312 |       31,882 |         69,430 |     593 |

Each card has a `card` and a `cardContent` record and one or two
`updateDeckCard` records; three in five come from notes with siblings
(`cardMetadata`, and `cardSuspended` from burying); some are deleted,
bookmarked or suspended. One card in twenty is new, so due at once. Records
go to the server in the order of an account migrated from the old backend
(`scripts/sync-migration/convert.ts`: each legacy table in turn, review logs
last), then three weeks of reviews since the migration, which move each
reviewed card's `card` record to the end of the pull: 3,752 of the large
account's `operations` records come after its first review log.

The lab does not cover a real iPhone (Safari's IndexedDB is another
engine), a real mobile network, Cloudflare's edge or D1 latency per page,
Google sign-in, or card images.

## Where the time goes (before)

Base build `5a152d8d`, one probe run per size, Chromium through the kit,
load average 2–7 from other work on the machine:

| Size   | `firstReview` | `restored` | Pull-stream requests |
| ------ | ------------: | ---------: | -------------------: |
| small  |         1,125 |      1,125 |                    1 |
| medium |         3,169 |      3,124 |                    1 |
| large  |        59,435 |     59,194 |                    7 |

The large restore took 59 s in the lab, not the 15–16 s that
`SYNC_RESTORE_TRACE.md` measured for a benchmark candidate (a compiled Zod 4
decoder, an empty-outbox shortcut and larger transactions; not the shipped
client). In a trace of the large restore:

- **IndexedDB writes: about 50 s.** The backend's `BackingStore::PutRecord`
  took 49.7 s for 101,316 puts. Most puts take 0.03 ms; 15,698 took about
  3 ms each, in runs of consecutive puts, and those make 47 s. The outbox
  lookups (`bulkGet`, 101,315 gets) took 0.5 s, index updates 0.2 s,
  commits 0.1 s. The cause of the slow runs is not known; the slow puts
  occur in every window, after the first 10,000 records.
- **Main thread: 7.5 s busy, 51.5 s idle** (V8 profile of the same restore).
  Zod 3 decoding of each record and envelope checks are most of it.
- **Network: about 1.4 s.** The server sends the whole account in 1.6 s
  without a link (79.6 MB of JSON, 8.8 MB gzip, so 1.4 s at 50 Mbit/s).
  Each window's response ends when the client has read it, about one page
  ahead of the commits.
- **In-memory rebuild and render: about 0.24 s** (`restored` to
  `firstReview`), with 31,882 `operations` records.
- **The push's scope request: about 0.21 s.** The restoring screen ends
  after the pass's push, which first asks `/sync/v3/state` again.

`operations` is 31% of the records and 26% of the bytes (2.1 MB gzip). In
the server's order, 28,130 of them come first and 3,752 come last, so a
plain pull has every card only at its end.

While it restores, the base build shows a due count of 0 beside the Spaced
icon at phone width (the count reads memory, which is empty): a wrong count
presented as final, from 0.3 s to the end of the restore.

## The go/no-go bar

Written before any prototype was measured.

- **Metric.** `firstReview` in the restore lab. Also reported: `restored`,
  `settled`, the end of each pull-stream request, and the IndexedDB row
  counts.
- **Network.** The lab profile: 40 ms per request, 150 ms more per
  authenticated request, one 50 Mbit/s link.
- **Runs.** A (base commit `5a152d8d`) and B (prototype) interleaved A, B,
  A, B; 7 runs a side for each size; median and p25 (p75 also reported);
  load average recorded.
- **Go** when all of these hold:
  1. Large: B's median `firstReview` is at least 30% or at least 1,000 ms
     shorter than A's, B's p75 is below A's p25, and B's median
     `firstReview` is at most half of B's median `restored` (review opens
     well before the restore ends).
  2. Small and medium: B's median `firstReview` is no later than A's by
     more than the larger of 50 ms and 5%.
  3. Every size: B's median `restored` is no later than A's by more than
     the larger of 400 ms and 15%.
  4. Every B run ends with the same IndexedDB row counts as A and an empty
     outbox, and every due count that B shows beside the Spaced icon
     equals the count when the run settles.
  5. Tests prove the engine's priority-done signal, a review made during
     the restore, and a review made during the restore that the full pull
     later overlaps (kept once, pushed once, never replaced by the older
     copy).
- Otherwise **no-go**: write up the numbers, keep the branch, do not merge.

## Proposal

1. **Engine.** `SyncPassObserver.prioritized()`, heard once when a priority
   pull has committed its last page and before the full pull's first
   commit; not heard when no priority pull runs or the server refuses or
   ignores the prefixes. Generic for every app on local-sync; Reader passes
   no such observer and is unchanged.
2. **Priority.** `syncTablePrefix("operations")`: every card, schedule,
   content, suspension, deck and deck membership. The review history
   (`reviewLogOperations`) follows in the full pull. The cards due today are
   not a key prefix (the due date is in the value), but everything Review
   reads is one table prefix, 31% of the records. No key, server or
   migration change: the prefix filter is live.
3. **Memory.** Each committed `operations` row goes into memory as it
   commits, as `reloadMemory` would fold it (a row replaces the fields its
   type owns), without telling the UI while the cards restore. At the
   signal Review opens on memory as it is, with no read back from
   IndexedDB.
4. **UI.** Two phases. While the cards restore, every page but Profile says
   "Restoring your cards…" and the due count beside the icon is hidden.
   While the history restores, every page opens; Review says "Restoring
   review history…" and Stats says "Restoring your review history…" rather
   than show part of it. A `cardsRestored` marker (the device ID, in
   `metadataKv`) lets a reload during the history phase open Review at
   once.
5. **Reviews during the restore** are local writes as at any other time:
   rows and outbox in one transaction. The full pull's copy of a reviewed
   card is at or below the sequence the priority pull applied, so it is
   skipped; a newer remote version meets the outbox check, which keeps the
   newer of the two. The pass's push sends the reviews after the full pull.

## Critique

- **IndexedDB still decides the first review.** B opens when 31,882 puts
  have committed into empty stores. The slow-put runs hit them as they hit
  A; B gains because they are 31% of the puts and come first.
- **A narrower priority.** Review needs the card records
  (`["operations","[\"card` covers all six card types) and the decks;
  `updateDeckCard` (8,339 records, 26% of `operations`) only feeds the deck
  pages. Two prefixes reach that set without a key change, but the deck
  pages would then wait for the history. Measure it only if B misses the
  bar, or as a follow-up.
- **Grades wait for page commits.** A local write takes the sync lock that
  each page commit holds; a page of 500 slow puts holds it for about 1.5 s.
  Measure a grade during the history phase.
- **Memory must equal a reload.** For each key the latest row replaces what
  its type owns, so commit order does not matter, except for one field: the
  `card` handler set `createdAt` only when it created the card. A restore
  brings a recently reviewed card's content (which creates it in memory)
  before its schedule, so memory held `createdAt` 0, and a grade writes
  `card.createdAt || Date.now()`. Fixed before measuring: the schedule's row
  sets `createdAt` in both paths, as a reload reads it.
- **The card under review is a snapshot.** A newer remote version of it in
  the full pull does not replace it while it is on screen; that is the rule
  for every background sync (`src/lib/review/session.ts`), unchanged.
- **Before the first answer.** Until `/me` answers (about 0.3 s), the app
  does not know there is an account to restore; Review shows "No cards
  created yet" in A and B for that time. Not changed here; the due count no
  longer shows 0 for an empty library.
- **Small accounts** pay the priority request, but it goes out with the
  full pull's (local-sync's B3 build), so it shows on `restored` at most.
- **Retries and reloads.** A failed full pull keeps the cards; with a cursor
  of 0 the next attempt runs the priority pull again and rewrites the same
  rows. Another tab hears the signal as a change and reloads its memory.

## Results

Chromium at 390 × 844 through `bun run kit time`, one run per invocation,
A and B alternating, 7 runs a side; medians in ms from navigation
(p25–p75). A is the base build (`5a152d8d`), B this branch. Raw lines,
the summary and the clips are kept outside the repository.

| Size   | Metric        | A                      | B                      |
| ------ | ------------- | ---------------------- | ---------------------- |
| large  | `firstReview` | 59,131 (59,032–59,730) | **16,857** (16,837–16,904) |
| large  | `restored`    | 58,898 (58,795–59,512) | 53,544 (53,462–54,434) |
| large  | `settled`     | 59,131 (59,032–59,730) | 53,725 (53,627–54,610) |
| medium | `firstReview` | 3,154 (3,130–3,238)    | **1,314** (1,295–1,320) |
| medium | `restored`    | 3,116 (3,086–3,198)    | 2,553 (2,545–2,562)    |
| small  | `firstReview` | 1,060 (1,041–1,072)    | **766** (758–784)      |
| small  | `restored`    | 1,045 (1,026–1,064)    | 1,042 (1,035–1,074)    |

Load averages: large A 2.2–8.0, B 2.2–4.5; medium and small 2.1–3.0.

Against the bar:

1. Large `firstReview` −42,274 ms (−71%); B's p75 (16,904) is far below
   A's p25 (59,032); B opens Review at 31% of its own restore.
2. Medium −1,840 ms (−58%), small −294 ms (−28%).
3. `restored`: large −5,354 ms, medium −563 ms, small −3 ms.
4. All 42 runs of a size ended with the same rows in `operations`,
   `reviewLogOperations` and an empty outbox (B's `metadataKv` holds one
   more row, the marker). B never showed a due count other than the final
   one (21 runs); A showed 0 beside the icon during every restore (21 runs).
5. Tests: `packages/local-sync/test/priority.test.ts` (the signal, once,
   before the full pull; not heard on a refused or ignored filter or a
   restored device) and `apps/sync-server/e2e/spaced-first-review.spec.ts`
   (a new device reviews while the full pull is held, a reload opens
   Review at once, Stats waits, the review survives the full pull's older
   copy and reaches the server once).

**Go.**

Where B's large restore goes: the priority pull's response ends at 11.0 s
(it ends as the client reads it, one page ahead of the commits) and Review
opens at 16.9 s, when its 31,882 puts have committed. The full pull's first
request waited the 10 s limit and went again at the signal; it ended at
51.8 s. B's restore ends 5.4 s earlier than A's with the same puts, plus
31,882 records sent twice (2.1 MB gzip); the cause is not known.

**Grades during the restore.** Two more large runs on a second account
graded a card every 3.5 s while the history restored: 18 grades took 57–298
ms from the tap to the next card (median 160 ms), against 25–38 ms before
the full pull's first commit. Each grade waits for the page commit that
holds the sync lock. Afterwards the server held each of the 36 reviews
those runs made once.

**A narrower priority (measured, not built).** A build whose priority was
`["operations","[\"card` and `["operations","[\"deck\"` (every card record
and the decks, not `updateDeckCard`: 23,543 records) opened Review at
8,585, 8,590 and 8,799 ms in three large runs, against B's 16,857: 26%
fewer records, half the time. In A's trace the first 10,000 puts were fast
and the slow runs came after, which would explain it. The deck pages would
then have to wait for the full pull too.

## What remains

- **The slow puts.** In the lab, most of the restore is IndexedDB puts of
  about 3 ms each in long runs. The cause is not known, and a real phone
  (Safari's IndexedDB) was not measured; a traced restore of the real
  account on the phone would say how much of this the user sees.
- **The narrower priority** above halves the first review in the lab, at
  the cost of the deck pages waiting for the history. A decision.
- **The `type` and `timestamp` indexes** on both tables are never queried;
  each put maintains them. Dropping them is a Dexie schema version, which a
  tab of an older build cannot open. Not measured.
- **Grades during the restore** wait for a page commit (up to about
  0.3 s). Smaller commits during the history restore would shorten that.
