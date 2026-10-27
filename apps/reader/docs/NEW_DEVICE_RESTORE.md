# New-device restore

What a new device does between sign-in and a full Library, how to measure it,
and what the server could change next. Measured in October 2026 in the restore
lab (`scripts/restore-lab.ts`).

## The critical path

1. **Session check.** Better Auth's `get-session`. The sync controller starts
   only when it has the account.
2. **Scope.** `/sync/v3/state` binds this device's local data to the account
   and its sync epoch.
3. **Restore.** One `/sync/v3/pull-stream` request. Pages hold at most 500
   records. While one page commits to IndexedDB, the next page downloads.
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
- **"Restoring your library…"** replaces the empty Library while a restore
  runs.

## What remains

IndexedDB bounds the large restore. The pull stream's network ends at about
1.9 s and the last page commits at about 3.3 s. In two traces, Chrome's
IndexedDB backend spent 2.0 s and 2.5 s on 9,000 puts, and the time per put
grew from 0.03 ms to 0.5 ms as the stores filled. Index updates took less
than 0.1 s of that. The main thread is mostly idle. The Library shows when
the books commit, which is last in the server's order.

## Server proposals (not built)

1. **Books first in a restore.** A bootstrap pull of the books, reading
   states and checkpoints, before the full pull from cursor 0. The full pull
   sends them again, and the version check keeps them. In the large lab
   account, the first page commits at about 1.0 s and the books at 3.0 s, so
   the shelf could show at about 1.2 s, with one more request. Small and
   medium gain little: their pull is one to three pages. This needs a key-prefix filter on the pull
   that does not move the device's cursor.
2. **The scope with the session.** `/sync/v3/state` already authenticates.
   If the controller started a restore in parallel with `get-session`, or the
   session answer carried the scope, a new device would save one request:
   about 200 ms in every size in the lab.
3. **Covers without a preflight or a session read.** Each cover is a
   cross-origin request with the `X-Sync-Scope` header, so it costs a CORS
   preflight for each new URL, and the server reads the session for each.
   In the lab a cover takes about 250 ms, and 264 covers take about 6 s after
   the shelf. Options, with their cost:
   - Better Auth's cookie cache removes the session read from each request.
   - A batch endpoint for up to 50 covers would turn 264 requests into 6: at
     50 Mbit/s, 10.5 MB of covers take about 1.7 s.
   - `Access-Control-Max-Age` does not help covers: each URL is new.
