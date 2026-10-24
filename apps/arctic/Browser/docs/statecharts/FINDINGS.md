# Arctic for the web: statecharts

Status, 24 October 2026: TLC checked each model, and each chart comes from
TLC's state graph. Bugs 1, 2, 4 and 5 are fixed, and each fix has a test that
failed before it (see [REPLAYS.md](REPLAYS.md)). Bug 3 is not fixed here: the
sheets branch (`agent/arctic-sheets-toast`) owns its code.

Med, the review app in `apps/med`, is not modelled here.

## Files

| Model | What it holds | Rules |
| --- | --- | --- |
| `LinkBar.tla`, `LinkBarFixed.tla` | The phone's link bar, and the search or topic that filters the library. | 1, 2 |
| `TextSheet.tla` | The Text and theme sheet, the chunk that holds its code, and the network. | 3 |
| `NoteSync.tla`, `NoteSyncFixed.tla` | One note on a highlight, edited on the phone and on the web. | 4, 5 |
| `ArticleText.tla`, `ArticleTextFixed.tla` | The text of a link saved on the web. | 6 |

- A bug model describes the code at commit 9bb68715, before the fixes. A
  fixed model describes the code after its fix, and cites the current lines.
  `TextSheet.tla` describes the current code.
- Each model has a `.cfg` with its rules and a `.map.mjs` with the reader's
  labels. The fixed model uses the same two files.
- `<Name>-statechart/` holds what the tool wrote: `chart.mmd` and
  `chart.png`, one `bug-<n>.mmd` and `bug-<n>.png` for each class of bug,
  `stories.md` and `summary.json`. TLC's own output (`tlc/`) is not kept.
- A device that is offline is one whose sync steps wait. TLC tries every
  order of steps, so the sync models need no network.

## Commands

Copy this folder to a scratch folder outside the repository. In that folder,
run these with pstack's `skills/statechart/scripts/statechart.mjs`:

```sh
node statechart.mjs from-spec LinkBar.tla --fixed LinkBarFixed.tla --cover --png --title "Link bar on a phone"
node statechart.mjs from-spec TextSheet.tla --cover --png --title "Text and theme sheet on a phone"
node statechart.mjs from-spec NoteSync.tla --fixed NoteSyncFixed.tla --cover --png --title "One note on the phone and the web"
node statechart.mjs from-spec ArticleText.tla --fixed ArticleTextFixed.tla --png --title "The text of a link saved on the web"
```

The first run installs TLC and Java with mise, about 305 MB. `--cover` draws
a path to each state, not each transition, so that the chart stays legible.
Quote counts only from `summary.json`.

## Results

From each `summary.json`, 24 October 2026:

| Model | Model states | Model transitions | Chart states | Chart transitions | Chart status |
| --- | --- | --- | --- | --- | --- |
| LinkBar | 64 | 236 | 13 | 17 | 13 work, 3 fixed, 0 still wrong |
| TextSheet | 22 | 64 | 13 of 14 | 11 of 40 | 13 work, 1 wrong |
| NoteSync | 225 | 341 | 14 | 16 | 16 work, 1 fixed, 0 still wrong |
| ArticleText | 8 | 10 | 9 | 11 | 7 work, 2 fixed, 0 still wrong |

- Each guard in each model cites a line of code (`uncited` is empty).
- TLC found no bug that a reading of the code had not found. It found two
  more paths to bugs 1 and 2 (LinkBar classes 3 and 4), and it confirmed
  that rule 4 holds.

## Rules

| # | Rule | Invariant | Before the fix | After the fix |
| --- | --- | --- | --- | --- |
| 1 | After you cancel the link bar, nothing you did in it gets saved. | `CancelSavesNothing` | Broken: bug 1 | Holds (90968d39) |
| 2 | When a save from the link bar is done, its card is in view. | `SavedLinkInView` | Broken: bug 2 | Holds (90968d39) |
| 3 | Once things settle while online, the Text and theme sheet you tapped is on screen. | `SheetShowsOnline` | Broken: bug 3 | Not fixed here |
| 4 | Once both devices are done syncing, they show the same note. | `SameNote` | Holds | Holds |
| 5 | Once both devices are done syncing, the note is its newest edit. | `NewestNote` | Broken: bug 4 | Holds (95110e6b) |
| 6 | Once the phone has an article's text and is done syncing, the web can show it too. | `TextReachesWeb` | Broken: bug 5 | Holds (4ca672ee) |

Rules 4 and 5 said "online and done syncing". A device that is offline cannot
be done syncing in these models, so the word is gone. Rule 6 was a proposal.
It now says "done syncing", and the phone obeys it.

## Bugs

Paths are relative to `apps/arctic/Browser` unless they start with `apps/` or
`packages/`. Each bug's chart shows TLC's shortest path to it.

### 1. Paste saves a link after you cancel (rule 1)

Chart: [LinkBar bug 1](LinkBar-statechart/bug-1.png). TLC's path: tap +, tap
Paste, tap × or the list, the clipboard gives a link.

- **Code before:** the clipboard's result called `link.submit(text)` with no
  check that the bar was still open. Cancel closed the bar, but the read went
  on.
- **Fix (90968d39):** each close counts up. A Paste keeps the count from
  when it started, and drops its result if the bar closed since then
  (`src/AddLink.tsx:254`, `:263-264`, `:347-351`).
- **Reach:** low. The read must wait, for example while Chrome on Android
  asks for clipboard permission. On iPhone, Safari blocks the page while its
  own Paste button shows.

### 2. A link saved during a search or a topic is hidden (rule 2)

Chart: [LinkBar bug 2](LinkBar-statechart/bug-2.png). TLC's path: search or
pick a topic, tap +, type a link, tap Save.

- **Code before:** after a save, `show()` went to `/` to drop `?q=` and
  `?topic=`. The library kept its query and topic in state and wrote them
  back to the address, so the filter stayed.
- **Fix (90968d39):** `show()` asks for all of Saved
  (`src/AddLink.tsx:105`), and the library clears its search and topic once
  for that navigation (`src/Library.tsx:70-79`). The new card shows at the
  top of Saved, and the search field is empty. A phone shows one folder at a
  time, so the reader sees the link that they saved, where new links go.
- **Reach:** each save while a search or topic is on: the phone's link bar,
  the wide popover and ⌘V.

### New: a tap on the phone's search field opened a folder

The test for bug 2 found this. With a search on and the keyboard away, the
folder names showed through the search field and took its taps.

- **Fix (4e8327b3):** the field sits above the folders, and the folders fade
  while the field shows (`src/styles.css`, `.strip-search` and
  `.strip[data-searching] .folders`).

### 3. A sheet whose code failed to load never opens (rule 3)

Chart: [TextSheet bug 1](TextSheet-statechart/bug-1.png). TLC's path:
offline, open an article, tap Text and theme, the code fails to load, the
connection returns.

- **Code:** `loading ??= import("./sheet")` keeps a rejected import for the
  life of the page (`src/surface.tsx:73`), and each sheet asks the same
  promise again (`src/surface.tsx:94`). The panel's `open` stays true, so a
  second tap changes nothing (`src/Reader.tsx:547-553`). The service worker
  installs only what `index.html` names (`public/sw.js:11-13`), so the
  sheet's chunk is cached only after its first online load.
- **Reach:** the first sheet after a deploy, offline, before the idle
  preload (`src/surface.tsx:80-86`) fetched the new chunk. The Notes and
  More sheets share this code.
- **Fix direction:** precache the sheet's chunk when the service worker
  installs. On a failure, say so, and let a later tap try again. Chromium
  also keeps the failed module, so a later import of the same URL fails too.
  `agent/arctic-sheets-toast` owns this code, so this branch does not change
  it.

### 4. An older phone edit replaces a newer web edit (rule 5)

Chart: [NoteSync bug 1](NoteSync-statechart/bug-1.png). TLC's path: edit the
note on the phone, edit it on the web, the phone syncs, the web takes the
account's note. Both devices then show the phone's older edit.

- **Code before:** the phone saved an edit to its files only. Its journal
  read the edit at the next sync, and stamped it with the clock of that sync
  (`apps/arctic/Sync/Sources/ArcticSync/SyncStore.swift:215`). The server
  keeps the higher stamp (`packages/local-sync/src/hono/d1.ts:72-81`). A
  stamp cannot go back in time, so the fix had to change when the phone
  commits, not how it compares.
- **Fix (fb413c03, 95110e6b):** each edit of a highlight, a note or a
  reading session commits to its journal when it is made, as the web's
  edits do (`apps/arctic/Sources/LibrarySync.swift:598-605`, `:669-682`).
  Each family keeps the scope of its last sync on disk, so its journal opens
  offline. A sync still compares `updatedAt` for files that changed outside
  the app.
- **Records:** the same keys, values and schema version. The server does
  not change.
- **The iPhone app must ship** fb413c03, 95110e6b and 4ca672ee. After the
  update, the first sync must be online, because it writes the scopes. Until
  then, an edit commits at the next sync, as before.
- **Reach:** the same note or highlight edited on both devices while one is
  offline, when the device with the older edit syncs first.

### 5. The text that the phone keeps never reached the web (rule 6)

Chart: [ArticleText bug 1](ArticleText-statechart/bug-1.png), and the
[full chart](ArticleText-statechart/chart.png), where the fix adds the step
"The phone sends the text". The bug and the fix show the same state, because
the labels do not say whether the phone is done syncing.

- **Code before:** the phone kept a Reader copy when you opened an article,
  or when it prepared a visible row. The copy stayed on the phone. A link
  saved on the web showed "The text of this article is not in your account
  yet" until you used Keep a copy there.
- **Fix (4ca672ee):** each sync sends up to five Reader copies whose text
  the account lacks, newest first (`apps/arctic/Sources/LibrarySync.swift:627-657`).
  The phone sends the HTML in `#reader-content`, which the Reader's
  extraction already cleaned, without the page around it. It keeps the web's
  limits: at least 120 words, at most 2 MiB, no `<script`
  (`apps/arctic/Sources/LibrarySync.swift:412-433`). A copy that the account
  has stays as it is.
- **Records:** the file goes to `arctic-content`, named by its XXH64 hash, as
  the server requires (`apps/arctic/Sync/Sources/ArcticSync/XXH64.swift`). The
  record is the `content/<id>` record that the web writes, with schema 1 and
  `source: "arctic"`. The server does not change.
- **Not sent:** a teaser under 120 words, and a copy that the server refused
  with a 4xx status. The phone tries those again at its next launch.

## What the models leave out

- Wide layouts: the popover, the sidebar and keyboard shortcuts. Bug 2
  applied to them, and the fix covers them, but they are not drawn.
- Toasts and Undo, which `agent/arctic-sheets-toast` is changing. Sync and
  connection status, which `agent/sync-states` is changing.
- The Notes and More sheets, the highlight bar, the toolbar that hides on
  scroll, reading position, and images.
- A clipboard that holds prose, and two Paste taps in a row.
- Library and article records (the `arctic` namespace), deletions (both sides
  use `deletedAt`, so a deletion syncs as an edit), and reading sessions,
  which commit the same way as notes.
- Time is in whole minutes, and an edit takes one, so no two edits share a
  stamp. A hybrid clock's counter is folded into one number. Each device
  edits the note once.
- The first sync after the update, before the phone has its scopes.
- How many copies go up in each sync, and a copy that the server refuses.
- Sign-in, sign-out, account switches and service worker updates.
