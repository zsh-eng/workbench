# New-device restore

What a new device does between sign-in and a full Library, how to measure it,
and what the server could change next. Measured in October 2026 in the restore
lab (`scripts/restore-lab.ts`).

## The critical path

1. **Session check.** Better Auth's `get-session`. The sync controller starts
   only when it has the account.
2. **Scope.** `/sync/v3/state` binds this device's local data to the account
   and its sync epoch.
3. **Restore.** A `/sync/v3/pull-stream` request with `prefix` parameters
   for the books, reading states and checkpoints, and at the same time one
   plain `/sync/v3/pull-stream` request, whose pages commit after the first
   request's. Pages hold at most 500 records. While one page commits to
   IndexedDB, the next page downloads.
4. **Library.** Each committed page that changes books, reading states or
   checkpoints refreshes the Library query. The page shows when the books, the
   first covers on this device and the fonts are ready.
5. **Covers.** Each cover is a 480 px WebP of about 40 KB, from
   `/files/:id`. A BlurHash shows until it arrives.

The sync journal's restore entry keeps counts only. With the sync state
store it took 6 ms of main-thread time in a trace of the large restore. The
Activity restore job reads the controller's status; the trace (a minified
build) gave it no measurable time.

## The restore lab

The lab runs the production path over HTTPS and HTTP/2, with latency and one
shared link:

```sh
# apps/sync-server: a local server for the lab's origins.
bun x wrangler dev --local --port 5521 --ip 127.0.0.1 \
  --var BASE_URL:https://localhost:5522 --var APP_ORIGINS:https://localhost:5523
# apps/reader: a production build that uses the lab API, served on 5526.
VITE_SHARED_API_URL=https://localhost:5522 bun run build
NETWORK_LAB_PORT=5526 bun scripts/network-lab.ts
node scripts/restore-lab.ts proxy        # 5522 -> API, 5523 -> app
bun scripts/restore-lab.ts seed large    # small | medium | large, once
NODE_TLS_REJECT_UNAUTHORIZED=0 RESTORE_LAB_SIZE=large bun run kit time \
  https://localhost:5523/ --before test/e2e/kit/restore-lab-device.ts \
  --steps test/e2e/kit/fresh-restore.ts --runs 3 --warmup 0 --timeout 1200
```

`RESTORE_LAB_API` and `RESTORE_LAB_APP_ORIGIN` move the lab to other
ports; `RESTORE_LAB_APPS=origin=upstream,...` serves several builds behind
the one shaped link, so a before and an after can alternate run by run.
`LAB_RTT_MS`, `LAB_SERVER_MS` and `LAB_MBPS` change the link.

Each run clears the app's storage, keeps the session cookie and opens the
Library at 390 × 844. `fresh-restore.ts` records the milestones and each API
request to `RESTORE_LAB_OUT`. With `RESTORE_LAB_TRACE` it saves a Chrome
trace; with `RESTORE_LAB_SECONDS` it suits `kit clip`.

| Size   | Books | Reading | Highlights | Sessions | Notes |
| ------ | ----: | ------: | ---------: | -------: | ----: |
| small  |     8 |       2 |         40 |       30 |     2 |
| medium |    40 |      12 |        600 |      500 |    11 |
| large  |   300 |      20 |      5,000 |    3,000 |   100 |

Every eighth book has no cover. Books being read have EPUBs of 10 MB. Records
are pushed in the order of a migrated account, so books come last in the
pull.

The lab adds 40 ms to each request, 150 ms more to each authenticated one,
and shares 50 Mbit/s. These are estimates. It does not cover a real iPhone
(Safari's IndexedDB is a different engine), a real mobile network, Cloudflare's
edge, D1 latency for each pull page, or Google sign-in.

## Results

Medians in ms from navigation: 5 runs for small and medium, 3 for large,
Chrome on an Apple silicon Mac with load averages of 4 to 11 from other work.

| Size   | Build  | Empty until | First shelf | Restore done | Screen covers | All covers | Scope requests |
| ------ | ------ | ----------: | ----------: | -----------: | ------------: | ---------: | -------------: |
| small  | before |         752 |         769 |          762 |         2,686 |      3,059 |             11 |
| small  | after  |         305 |         781 |          767 |         1,096 |      1,096 |              2 |
| medium | before |         988 |       1,033 |        1,024 |         5,781 |     25,220 |             50 |
| medium | after  |         276 |         865 |          863 |         1,218 |      1,716 |              2 |
| large  | before |       3,503 |       3,623 |        3,923 |        13,937 |    142,421 |            296 |
| large  | after  |         279 |       3,033 |        3,307 |         4,036 |      9,158 |              2 |

"Empty until" is the last frame that said "Your library is empty". "Screen
covers" is when every book on the first screen shows its cover.

"Scope requests" counts `/sync/v3/state` in the last run. The first shelf
of small did not change. The medium and large ranges do not overlap (medium
983–1,072 before, 838–945 after; large 3,332–3,668 before, 3,024–3,035
after). The only change before the shelf is the Library's whole-table reads,
but the load was a little higher in the before runs.

Where the time goes in the large restore (ms from navigation, medians):

| Step                                       |    Before |     After |
| ------------------------------------------ | --------: | --------: |
| Session check (`get-session`)              |   123–329 |    73–283 |
| Scope (`/sync/v3/state`)                   |   331–533 |   288–505 |
| Pull stream, network (about 8,400 records) | 580–2,149 | 559–1,915 |
| Last page committed                        |     3,923 |     3,307 |
| First book on screen                       |     3,623 |     3,033 |
| First cover request                        |     3,961 |     3,102 |
| Covers on the first screen                 |    13,937 |     4,036 |
| All 264 covers                             |   142,421 |     9,158 |

Before, each cover waited for its own scope request, and the browser sent
those one at a time: 264 covers took 138 s, about 520 ms each, one after
another. The reading books' EPUBs (about 20 of 10 MB, from 5.7 s to 42.7 s)
shared the link with them. After, a cover request takes about 250 ms,
twelve go at once, and the EPUBs wait until the covers are done.

## What changed

- **One scope for file requests** (`local-sync` `request(path, init, false)`).
  Each cover asked `/sync/v3/state` first, from a new client. The browser
  sends identical requests one at a time, so covers downloaded one after
  another. Now file requests send the scope that sync bound.
- **A cover queue.** Twelve covers load at once: those on screen first, then
  the rest of the Library in order.
- **EPUBs one at a time, after the covers.** The Library prepared every
  book being read, so a new device downloaded all of their EPUBs at once.
  Now the books on the device are prepared at once, and the others download
  one at a time, the book read last first, when the restore has ended and no
  other download is under way. Each is tried once while the Library is
  open. In the medium lab, the 12 EPUBs downloaded from 2.0 s to 27.4 s.
- **Covers fade in** over their BlurHash in 320 ms.
- **The Library reads whole tables** instead of walking Dexie cursors on
  every refresh during the restore.
- **The restore island** replaces the empty Library while a restore runs:
  the Library's frame with quiet covers, and the shared island growing out
  of the activity glyph's place, "Restoring library · 12 books" (the books on
  this device so far; the restore's size is not known). It waits for a
  connection or a sign-in until a pull reaches the end, says "Restored" and
  folds back (`LibraryRestoreIsland`, packages/background-activity). A
  reload, an offline start or an expired session that leaves the restore
  unfinished shows it too: the saved sync state has not bootstrapped, and
  the account is signed in (also the remembered one offline) or its
  session has ended. A library without an account, or after a sign-out,
  does not restore and does not say "Restored". Its colours come from each theme, at
  4.5:1 or more in light, dark, night and both Flexoki themes
  (`src/index.css`). In the large lab, 4 runs a side interleaved with the
  build before it: first shelf 912 → 916 ms, restore done 3,264 → 2,266
  ms (the two modes below; 1 of 4 base runs and 4 of 4 island runs were
  in the faster one). Every book is listed 54 ms later (1,264 → 1,318 ms):
  the island grows from about 0.8 s to 1.3 s, and its width moves on the
  main thread each frame. With reduced motion, which only fades it, the
  difference is 12 ms (1,240 → 1,252, 3 runs a side).

## Books first (built)

A new device pulls the keys of `books`, `readingState` and
`readingCheckpoints` first, without moving its cursor, then everything
(`READER_RESTORE_PRIORITY` in `src/lib/sync-v2/tables.ts`; the engine and
server side are in local-sync's
[PRIORITY_RESTORE.md](../../../packages/local-sync/docs/PRIORITY_RESTORE.md)).
The full pull skips the books it already has. Lab medians, 7 runs a side,
interleaved with the base build (far profile: 320 + 170 ms, 10 Mbit/s,
5 runs a side):

| Size       | First shelf   | Restore done  | Screen covers |
| ---------- | ------------- | ------------- | ------------- |
| small      | 810 → 783     | 805 → 808     | 1,123 → 1,113 |
| medium     | 937 → 855     | 937 → 949     | 1,297 → 1,234 |
| large      | 2,999 → 908   | 3,261 → 3,189 | 3,953 → 3,490 |
| small, far | 1,998 → 1,995 | 1,998 → 2,016 | 3,037 → 3,056 |
| large, far | 4,231 → 2,121 | 4,517 → 4,543 | 7,149 → 6,426 |

In large, the priority pull's network ends at 0.87 s and the first books
commit at once into empty stores. Of the 2.1 s gained, about 1.1 s was
IndexedDB (the base build's books arrived by 1.9 s and committed at 3.0 s,
behind 8,000 other puts) and about 1.0 s network order (the books came
last). The large restore's end has two modes with the change: in the lab,
2.2–2.4 s or 3.2–3.3 s; on the far profile, 4.4–4.5 s or 5.7 s, which is
1.2 s later than the base build (2 of 5 runs). The cause is not known;
local-sync's doc has the numbers.

## What remains

IndexedDB still bounds the large restore: the full pull's network ends at
about 2.3 s and its last page commits at about 3.2 s (1.8 s and 2.3 s in
the faster mode). Covers on the first screen download by about 1.3 s, but
each is stored in IndexedDB before it shows, behind the restore's commits,
so the first screen shows BlurHash placeholders from 0.9 s to 3.5 s.
Showing a downloaded cover before its IndexedDB write commits would bring
them to about 1.4 s; not built.

## Server proposals (not built)

1. **The scope with the session.** `/sync/v3/state` already authenticates.
   If the controller started a restore in parallel with `get-session`, or the
   session answer carried the scope, a new device would save one request:
   about 200 ms in every size in the lab.
2. **Covers without a preflight or a session read.** Each cover is a
   cross-origin request with the `X-Sync-Scope` header, so it costs a CORS
   preflight for each new URL, and the server reads the session for each.
   In the lab a cover takes about 250 ms, and 264 covers take about 6 s after
   the shelf. Options, with their cost:
   - Better Auth's cookie cache removes the session read from each request.
   - A batch endpoint for up to 50 covers would turn 264 requests into 6: at
     50 Mbit/s, 10.5 MB of covers take about 1.7 s.
   - `Access-Control-Max-Age` does not help covers: each URL is new.
