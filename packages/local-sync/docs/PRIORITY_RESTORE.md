# Priority restore: prove it or drop it

A new device restores an account with one pull from cursor 0, in the
server's order. An account migrated from elsewhere has its books last, so
Reader's first screen waits for every record. The idea (from Linear's
`instant` load strategy): each app names the key prefixes its first screen
needs, a restore pulls those first without moving the cursor, then the
normal full pull runs.

The user's condition: build it only if it meaningfully improves the first
load or sync after sign-in. This file holds the bar (written before any
measurement), the proposal, its critique and the results.

## The go/no-go bar

Written before the prototype was measured.

- **Metric.** Reader's restore lab (`apps/reader/scripts/restore-lab.ts`),
  `shelf`: the first book on screen with the Library not busy. Also
  reported: `screenCovers` (the first screen complete), `restored` (the
  full pull bootstrapped), the end of the pull-stream network and the
  priority request.
- **Network.** The lab's profile: 40 ms per request, 150 ms more per
  authenticated request, one 50 Mbit/s link shared by all API responses.
- **Runs.** A (base commit `52054114`) and B (prototype) interleaved
  A, B, A, B; 7 runs a side for each size; median and p25; load average
  recorded.
- **Go** when all of these hold:
  1. Large: B's median `shelf` is at least 30% or at least 1,000 ms shorter
     than A's, and B's p75 is below A's p25.
  2. Small and medium: B's median `shelf` is no later than A's by more than
     the larger of 50 ms and 5%.
  3. Every size: B's median `restored` is no later than A's by more than
     the larger of 400 ms and 15%. Large: `screenCovers` no later than 5%.
- Otherwise **no-go**: write up the numbers, keep the branch, do not merge.

The server ideas in `apps/reader/docs/NEW_DEVICE_RESTORE.md` (scope with
the session, covers through `files/batch`) are measured separately, and
only if the priority pull alone misses the bar.

## Proposal

1. **App config.** `new SyncClient({ ..., priority: [...] })`: key prefixes,
   printable ASCII, at most 8. `syncTablePrefix("books")` gives the prefix
   of `encodeSyncKey("books", id)`, `["books",`. Reader: `books`,
   `readingState`, `readingCheckpoints`.
2. **Server.** `/pull` and `/pull-stream` take `prefix` (repeatable). Each
   prefix is a key range `[p, p with its last character + 1)`, read through
   the existing `(user_id, namespace, key)` unique index, then ordered by
   `server_seq`. Pages, cursor, head, byte budget and limits are those of a
   plain pull. Auth, scope and namespace checks are unchanged: the filter is
   one more `WHERE` term on the same identity. No migration.
3. **Remote.** Optional `SyncRemote.pullPrefixed` returns pages, as
   `pullStream` does. The namespaced HTTP client sends it to
   `pull-stream` with `prefix` parameters. An older server refuses the
   unknown parameter (400) or the route (404, 405); the client then yields
   no pages and does not ask again. Remotes without the method, or without
   `pullStream`, never run a priority pull.
4. **Engine.** In `pull()`, after the scope is bound, when the state has not
   bootstrapped and `priority` is set: a priority pull from cursor 0 with its
   own head. It applies each page through `applyRemoteRecords`, observes
   clocks, reports pages to the observer, and never writes `pullCursor` or
   `bootstrapped`. A page with a key outside the prefixes ends it unapplied.
   Then the full pull runs as before. A record in the full pull with the
   same version the priority pull applied is neither applied nor reported
   again; every other record (newer versions, tombstones) is applied as
   before.

## Critique

- **Small accounts pay a request.** One page holds the whole account, so
  the priority pull adds a round trip and a CORS preflight before the full
  pull: about 230 ms in the lab, on `restored`, not on `shelf` (both
  commit the books with one request). Bar item 3 allows it; the bar
  fails if it shows on `shelf`.
- **The gain may be IndexedDB, not network order.** Books arrive last over
  the network _and_ commit after 8,000 puts that slow each later put. A
  client-only reorder cannot fix the first: the books are not on the device
  until the last pages. Measure both by comparing `shelf` with the end of
  the pull-stream network in each run.
- **Duplicates.** The full pull sends the priority records again: about 800
  records, 2 MB raw, in large. Skipping exact versions saves their puts,
  not their bytes. A server-side "everything but the prefixes" pull would
  save the bytes but needs a cursor per filter; not proposed.
- **Correctness.** The full pull reads each key's current row after the
  priority pull, so its version is the same or newer: a newer edit or a
  tombstone replaces the priority row; the same version is skipped. A
  pending local edit wins in both pulls through the outbox check. Sign-out
  aborts the shared signal and the device check stops both pulls; an epoch
  change fails the scope check on either request, as a partial full pull
  does today. Rows the priority pull committed stay, as rows of a partial
  full pull do.
- **D1 cost.** The key-range scan reads only matching rows (about 800 in
  large) and sorts them by `server_seq`; scanning the sequence index with a
  key filter would read every row before the books. Only restores pay it.
- **Arctic.** Its first screen needs `article/` and `library/`, nearly the
  whole `arctic` namespace; texts, highlights and sessions are already in
  other namespaces that commit after the links. A prefix pull there would
  download most of the namespace twice. Check the record shares before
  ruling it out.
- **Spaced.** Its UI shows "restoring" until the whole pull ends and then
  loads `operations` into memory. The cards due today are not a key prefix.
  Check whether its first load is slow and what a priority pull would need
  from the app.

## What the critique changed

Three builds were measured against A; B3 is what is built.

- **B1: one pull after the other.** `restored` was 200–260 ms later in every
  size on the lab profile: the full pull waited for the priority request.
- **B2: the full request at the priority pull's last page.** That hid the
  commit of the last priority pages (about 100 ms in large), not the
  priority request's own round trip before a small account's only page:
  small and medium still finished 250 ms later, and on the far profile all
  sizes finished 850–940 ms later (a CORS preflight and a request at 320 ms
  each).
- **B3: both requests at once.** The full pull's request goes out with the
  priority pull's; its commits wait for the priority pull, so the two never
  write at once and its server reads may come before the priority pull's.
  The transport ends a request after 30 s, body included, so a full request
  that has waited 10 s for the priority pull is dropped, having committed
  nothing, and sent again once the priority pull ends. A shorter wait still
  comes out of the first full window's 30 s. In Reader's large lab account
  the priority pull is a third of the full pull's bytes (2.4 MB against
  7.2 MB), so a link on which it takes 10 s needs about 30 s for the full
  pull, which missed the limit before this change too.
  A window that misses fails after its first commits, as before, and the
  retry resumes from that cursor without a priority pull.
- **Skip at or below the applied sequence.** Each winning write of a key
  takes a higher sequence, so a full-pull record at or below the sequence
  the priority pull applied for its key is that version or an older one,
  and is skipped. A newer version or a tombstone is above it and is
  applied. This holds in whatever order the server reads the two pulls.
- **One priority pull per restore.** A full-pull page commits only after a
  priority pull has ended, so a cursor past 0 means the device already has
  the priority records: a retry does not pull them again.
- **D1.** Each prefix page picks its sequences from the key index (which
  holds each row's sequence) and only then reads those rows, so values are
  read once and the sort holds integers. A priority set of N keys still
  visits about N index entries per page.
- **Fallback.** Only the first window's 400, 404 or 405 means "no filter";
  a later window's error propagates.

## Results

Chromium at 390 × 844 through `bun run kit time`, one run per invocation,
A and B alternating; medians in ms from navigation (p25–p75). A is the base
commit's build, B is B3 as built. Every run ended with the same IndexedDB
row counts on both sides (94, 1,218, 8,900). Load averages are from other
agents' work on the machine.

**Lab profile** (40 ms + 150 ms per authenticated request, 50 Mbit/s;
7 runs a side; load A 1.6–6.2, B 1.5–4.9):

| Size   | Metric       | A                   | B                   |
| ------ | ------------ | ------------------- | ------------------- |
| large  | shelf        | 2,999 (2,993–3,016) | **908** (892–920)   |
| large  | allBooks     | 3,324 (3,310–3,338) | 1,243 (1,222–1,270) |
| large  | screenCovers | 3,953 (3,927–3,958) | 3,490 (2,668–3,572) |
| large  | restored     | 3,261 (3,259–3,286) | 3,189 (2,353–3,238) |
| medium | shelf        | 937 (926–939)       | **855** (845–876)   |
| medium | restored     | 937 (926–939)       | 949 (944–958)       |
| small  | shelf        | 810 (802–811)       | **783** (778–794)   |
| small  | restored     | 805 (798–810)       | 808 (794–818)       |

Against the bar: (1) large `shelf` −2,091 ms, −70%; B's p75 920 is far
below A's p25 2,993. (2) Medium −82 ms, small −27 ms. (3) `restored`:
small +3 ms, medium +12 ms, large −72 ms; large `screenCovers` −463 ms
(−12%). **Go.**

**Far profile** (320 ms + 170 ms per authenticated request, 10 Mbit/s;
5 runs a side; load A 2.5–11.2, B 2.1–8.1):

| Size  | Metric       | A                   | B                       |
| ----- | ------------ | ------------------- | ----------------------- |
| large | shelf        | 4,231 (4,225–4,241) | **2,121** (2,098–2,254) |
| large | screenCovers | 7,149 (7,108–7,167) | 6,426 (6,383–7,955)     |
| large | restored     | 4,517 (4,509–4,556) | 4,543 (4,484–5,722)     |
| small | shelf        | 1,998 (1,981–2,004) | 1,995 (1,994–2,000)     |
| small | restored     | 1,998 (1,981–2,004) | 2,016 (2,013–2,023)     |

The earlier builds, each against its own interleaved A: B1 finished
`restored` 200–260 ms later in every size on the lab profile; B2 250 ms
later in small and medium, and 850–940 ms later in every size on the far
profile. B3 removed both.

**B's restore time has two modes.** Large, lab: 3 of 7 B runs restored at
2.22–2.37 s and 4 at 3.19–3.27 s (A: 3.24–3.33 s). Large, far: 3 of 5 at
4.45–4.54 s and 2 at 5.72–5.74 s (A: 4.51–4.56 s): on the slow link 2 of 5
restores ended about 1.2 s later than A's, with their shelf 2.1 s
earlier. In the late runs the full pull's response also ends later
(lab 2.25–2.33 s against 1.75–1.86 s): Chromium hands the stream over in
2 MB pieces as the page reads it, so its end follows the commits, and the
commits were slower. The cover requests during the restore were the same
in both modes. Five traced B runs (tracing slows everything) restored at
2.48–2.81 s without a split. In the traces A spent 1.97 s in IndexedDB's
put operations and B 0.85–0.93 s for the same 9,000 records. Cause not
found.

The cost is bytes: in the traces, A's restore pulled 7.2 MB and B's
9.6 MB (the priority pull's 2.4 MB, then the full pull's 7.2 MB with the
same records again).

Where the large gain comes from: A's full pull network ended at 1,887 ms,
with the books last, and the books committed at about 3,000 ms, behind
8,000 other puts. B's priority network ended at 871 ms and its first page
committed by 908 ms into empty stores. So about 1.1 s of the 2.1 s was
IndexedDB backlog and about 1.0 s network order. A client-only change
(committing the priority prefixes in their own transaction) could at best
remove the backlog: the books still arrive last, at about 1.9 s.

Raw samples (`run1` to `run5-far`), their summaries, the summary script and
one Chrome trace each of A and B (large, lab profile) are kept outside the
repository with the before/after clip.

## Arctic and Spaced

- **Arctic: not applicable.** In the first-sync lab's libraries, the first
  screen's `article/` and `library/` records are 86% of the `arctic`
  namespace's bytes (67% of its records); `tags/` is the rest. Texts,
  highlights and sessions are already separate namespaces whose commits
  wait for the links (`apps/arctic/Browser/docs/FIRST_SYNC.md`). A priority
  pull would send 86% of the namespace twice to save at most the `tags/`
  pages; by FIRST_SYNC's numbers that is under 1 s in large far and less
  elsewhere, before the extra request. It cannot reach the bar. Not
  measured; not wired.
- **Spaced: built.** Its first screen reads only `operations` (about 30%
  of the records); review logs feed Stats. Spaced declares
  `syncTablePrefix("operations")` and opens Review when the engine's
  `prioritized()` observer hears that the priority pull has committed. In a
  Spaced lab with a synthetic account of 101,312 records, the first due
  card came at 16.9 s instead of 59.1 s, and the restore ended 5.4 s
  earlier (`apps/spaced2/docs/FIRST_REVIEW.md`).
