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
