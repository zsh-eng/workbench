# Sync history

What sync did on this device, in words a person can check: "3 highlights in
_Systems Performance_ from your iPhone", "1 note lost to a newer edit", "2
changes waiting on this device". The code is `src/journal.ts` (the journal and
its bounds), `src/history.ts` (the summariser), `src/dexie/journal.ts` (the
store) and `useSyncHistory` in `src/react/index.ts`.

## The problem

`SyncClient.sync()` returns three counts (`pulled`, `skipped`, `pushed`) and
drops everything else. The status store says when the last sync was and why
the last attempt failed. Neither can answer the questions people ask about
sync:

- Did the highlight I made on my phone arrive here?
- Did anything I did here get thrown away?
- What is still only on this device?

The server cannot answer either: it keeps only the latest version of each key
(one row per key, `sync_records_user_key_unique`), so it has no history.

## Options

1. **Show the counts.** "Pulled 3, pushed 1" per pass. Cheap, but a count of
   keys says nothing about books, devices or lost edits, and the counts are
   gone on reload.
2. **A server activity log.** Every push appended to a log that all devices
   can read. It shows changes a device never pulled, but it is a protocol and
   server change, and a retention policy for user data.
3. **A journal on each device, and a summariser.** The client already sees
   every record it pulls (key, device, HLC, deletion) and the winner of every
   change it pushes. Keep that metadata, never the values, bounded, on this
   device. A pure function batches it into groups, and each app names the
   groups in its own nouns. **Chosen** for this round. Option 2 can come
   later and feed the same summariser.

## Design

### The journal

`createSyncJournal({ store })` keeps one entry per sync pass that moved a
record or failed:

| Field                  | What it holds                                                                            |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| `startedAt`, `endedAt` | When the pass ran, by this device's clock                                                |
| `trigger`              | `start`, `interval`, `change`, `retry`, `online`, `visible`, `manual` or `sign-in`       |
| `outcome`, `failure`   | `synced`, `failed` (the failure kind and HTTP status) or `cancelled`                     |
| `received[]`           | Per key: the origin device, the HLC wall time, deleted, and `keptLocal`                  |
| `sent[]`               | Per key: the HLC wall time, deleted, and for a lost edit the winner's device and time    |
| `counts[]`             | A restore or a very large pull: changes per direction, device and table                  |
| `repeats`, `recoveredAt` | A failure that repeated, and when sync next succeeded                                  |

- **Keys, never values.** No record value and no error message is stored:
  a rejected record's message names its key, but a transport's message can
  say anything.
- **The controller begins and ends a pass.** `createSyncController({ journal })`
  gives `run` a `pass` with the trigger, and ends it with the attempt's
  outcome and failure kind. `SyncClient.sync({ observer: pass })` reports
  each committed pull page and each reconciled push batch. One pass can
  span several clients (Arctic syncs four namespaces in one attempt).
- **A lost edit** is a sent change whose winner differs from it. A repeated
  push (the winner is the sent change) is kept, not lost.
- **`keptLocal`**: a pulled record that a newer edit on this device kept
  out. `applyRemoteRecords` may now return those keys; `DexieSyncStorage`
  does. Without them, "from your iPhone: 1 highlight" would name a change
  that this device did not take.
- **A restore**, a pass that starts before the device is bootstrapped, and
  any pass with more than 500 received keys, keeps counts per table and
  device instead of keys. The table comes from the key (`kindOf`; the
  default reads `encodeSyncKey`'s pair, or the text before `/`).
- **Quiet passes are not stored.** A pass that moved nothing and succeeded
  leaves no entry, so periodic sync does not write every 30 s. A failure
  that repeats with no success between folds into the last entry.
- **Bounds.** Entries older than 30 days are dropped. Beyond 1,000 detailed
  entries or 8,000 detailed keys, the oldest days roll up into one entry per
  day, with counts per direction, device and table. Lost edits keep their
  detail in the roll-up.
- **Cost.** A pass writes one row and reads nothing. Every 50 writes, and
  when a view first subscribes, the journal reads and compacts its rows in
  one transaction. Writes never fail a sync: an error is logged and the
  entry dropped.
- **Storage.** `SyncJournalStore` is `load()`, `put(entry)` and
  `compact(change)`. `/dexie` has `DexieSyncJournalStore` over an app-owned
  `_sync_journal: "id"` table, beside `_sync_outbox` and never in the synced
  table map. The core has no Dexie, React or browser import.

### The summariser

`summarizeSyncHistory(entries, options)` is pure. It returns:

- `lost`: edits lost to a newer one, each with the winner's device and time.
- `waiting`: what is still only on this device, from the outbox keys the app
  passes (`pending`).
- `groups`, newest first. A group is one direction (`received`, `sent`,
  `restored`, `failed`) from one device. Changes join a group while each is
  within 10 minutes of the last, by the HLC wall time, so a reading session
  on the phone is one group however its pushes were split. Changes from
  before today group by day. A restore is one group whatever devices its
  records came from, and a restore that was interrupted and resumed is one
  group too. A group also says when its changes arrived, so a phone that
  was offline reads "made yesterday, arrived 10:42".
- Each group's `items`. The app's `describe({ table, id, deleted, at })`
  gives a kind ("highlight"), its nouns, a verb (added, changed, removed)
  and a container ("_Systems Performance_"); the summariser counts distinct
  keys per kind, verb and container. `phraseSyncItem` writes default English
  ("3 highlights in X", "reading progress in 2 books", "1 book added").
  `describe` is synchronous: an app that needs its database to name a
  container looks the keys up first and passes a `describe` that reads the
  result.

Group ids are stable (direction, device, and the first change's key and
time, or the day), so a view can keep its rows in place while new passes
arrive.

### React

`useSyncJournal(journal)` returns the entries and whether they have loaded;
`useSyncHistory(journal, options)` returns the summary. The journal reads its
store when a view first subscribes, so a sheet opened in one tab sees the
passes another tab wrote.

### Device names

Reader's Devices page lists auth sessions, which carry no sync device ID. The
shared server's `GET /api/apps/:namespace/devices` lists sync clients by
`client_id`, the same `X-Device-ID` that records carry, with the browser, OS
and device type from the user agent. Reader names those "your iPhone", "your
iPad" or "your Mac", remembers the names for offline use, and otherwise says
"another device". iPadOS Safari sends a Mac user agent, so an iPad can read
as a Mac.

### Limits the words keep

- **"Changed", not each edit.** The server keeps the latest version of each
  key, so five edits to one highlight between two pulls arrive as one change.
- **Times are the device's clock.** HLC wall time comes from the device that
  made the change, and the server accepts clocks up to five minutes ahead
  (`MAX_SYNC_FUTURE_CLOCK_SKEW_MS`). Groups from two devices can be out of
  order by that much. A time later than when this device saw the change is
  shown as when it saw it.
- **Only what this device pulled.** Another device's change shows once this
  device has pulled it. A change that a newer one replaced before this
  device pulled never shows.
- **This device only.** Each device keeps its own journal. A new device's
  history starts with its restore, and the journal stays when you sign out,
  as the local data does.

## Critique, and what changed

Read back against the code, the first draft had these problems:

- _Reading writes a pass every 30 s._ A page turn saves a checkpoint, a
  session and a state row, and the next periodic pass pushes them: about
  120 entries an hour while reading. The first bounds (600 entries) kept
  five hours of reading. They are now 1,000 entries and 8,000 keys, and older
  days roll up rather than drop. Merging passes at write time would keep more,
  but breaks "one entry per pass", which the tests and the roll-up rely on.
- _A load on every start._ The draft compacted on load, which read the whole
  journal at launch. Writes now only append; compaction runs every 50 writes
  and when a view opens.
- _A failure streak never ends._ Quiet passes are not stored, so after "12
  tries, couldn't reach the server" nothing said sync recovered. The next
  success now stamps `recoveredAt` on that entry: one write per recovery.
- _Restores split by device._ A restore pulls this device's own old records
  too (`excludeOwnDevice` is false until bootstrap). A per-device restore
  group would read "restored from this device". A restore is now one group,
  with its devices inside, and resumed restores join it.
- _A roll-up hid lost edits._ Counts per day are fine for routine changes,
  not for the one thing worth finding later. Lost edits keep their detail.
- _Times from the future._ A device that observes a remote HLC ahead of its
  clock carries it into its own next edits (`tickSyncHlcBatch` takes the
  maximum). Both sent and received times are now capped at when this device
  saw them.
- _`keptLocal` changes a storage result._ Two existing tests compare the
  exact `{ applied, skipped }`. The field is optional and additive; the tests
  now include it.
- _Debug only, recorded for everyone._ The view is behind Debug, but the
  journal records on every device, so turning Debug on shows past days. This
  adds Dexie version 8 to Reader (one new local table, no upgrade function).
  Dexie 4 opens a newer database from older code, so a stale tab keeps
  working.

Kept as drafted, after weighing:

- _The controller knows the journal._ An app could wrap `run` itself, but the
  controller is the one place with the trigger and the failure kind, and
  three apps would repeat the wrapper.
- _The same database as the data._ A separate database would avoid the
  version bump, but the journal would need its own name per account and lab
  client, and would outlive a deleted library. A table follows `_sync_outbox`.
- _Entries, not a stored summary._ Storing groups would tie the database to
  today's grouping rules and each app's nouns.

## In the apps

- **Reader** (this round, behind Debug): Account → Activity opens one sheet
  with **Now** (the activity jobs, as the glyph's sheet lists them) and
  **Recent** (lost edits, waiting changes, then the groups). Rows keep their
  places while the sheet is open. The activity glyph keeps its rule:
  restores, imports, waiting updates and failed downloads only. Devices adds
  a Debug list of syncing devices with what each last sent. Debug → Design
  ideas → Sync history compares layouts.
- **Arctic for the web** keeps four `SyncClient`s under one controller: it
  passes `pass` to each `client.sync({ observer })` and implements
  `SyncJournalStore` over its own IndexedDB. Its keys are `table/id`, which
  the default `kindOf` reads.
- **Spaced** adds `_sync_journal` to its Dexie schema and passes the journal
  to `createSyncController`.
