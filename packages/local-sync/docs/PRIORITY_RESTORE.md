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
3. **Remote.** `SyncRemote.pullPrefixed?(deviceId, request, prefixes,
   signal)` returns pages. The namespaced HTTP client sends it to
   `pull-stream` with `prefix` parameters. An older server refuses the
   unknown parameter (400) or the route (404, 405); the client then yields
   no pages and does not ask again. Remotes without the method never run a
   priority pull.
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
  the network *and* commit after 8,000 puts that slow each later put. A
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
