# Project symbol search

This document records where **Symbols in the project** (`⌘⇧O` with no file
open, or Project in the symbol picker) spent its time on 2026-11-14 at
`9b2c854b`, what changed, and the results. A checkout's project symbols come
from Universal Ctags over its working files ([usage](../usage/find.md#symbols-and-vim-navigation)).
Symbols in one file were already fast: 30–90 ms to open the picker on
`server.ts`, and about 18 ms from a key to the painted list, because the
browser ranks a file's symbols itself.

## Where the time went

Each key in the project picker sends one request; the host ranks and returns
the best 100. There is no debounce, and a new key's request stops the last one
(`X-Med-Latest`). On the Workbench checkout (3,121 files, 62,000 tags), from a
key to the list:

| Part                                      | Before     | Cause                                                                                                                                                                                                                                                      |
| ----------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page, before the request leaves           | 3–4 ms     | —                                                                                                                                                                                                                                                          |
| `git ls-files` for each key               | 22–25 ms   | A Git process for each key: the host read the checkout again at each search.                                                                                                                                                                               |
| `lstat` of every file for each key        | 13–15 ms   | The same read: each file's size and time, to find the files that changed.                                                                                                                                                                                  |
| Ranking 62,000 tags                       | 9–16 ms    | Two lower-case strings and a scope string made for each tag at each key, and the query's characters iterated each time.                                                                                                                                    |
| React: the list of 100                    | 11–20 ms   | —                                                                                                                                                                                                                                                          |
| Preview of minified code, at the next key | 400–500 ms | `apps/arctic/Resources/reader.js` (538 KB, lines of up to 83,000 characters) gave 1,376 tags such as `u` and `F`, which rank first for a one-letter query. A Chrome trace of the next key has one 545 ms task, almost all Paint: the preview of that line. |

The first read, as the picker opens, ran Ctags on 500 files at a time, one
process after another: 1.8–2.6 s.

## Changes

- **The last read answers while the checkout is unchanged.** The host passes
  the checkout's token (`checkoutState` in `server.ts`: the watcher's revision
  of its files and the Git signature) to `WorkingTreeSymbols.search`. While the
  token is the same, a key ranks the last read: no Git and no `lstat`. A file
  event changes the token at once, before the watcher's delay, so an edit, a
  new or deleted file, and a branch switch read again; that read parses only
  the files that changed. The symbols request starts a live watcher, as the
  file list does. Without a ready watcher there is no token, and each search
  reads as before. One read runs at a time for each checkout, and at most one
  waits behind it: searches at newer tokens share that one. The host keeps
  the symbols of 8 checkouts.
- **Ranking keys are made once.** `symbolKeys` keeps each tag's lower-case
  name and scoped name; `findSymbolKeys` ranks with them. The order is the
  same; `findSymbols` is `findSymbolKeys` over new keys. The picker keeps the
  keys of a file's symbols between keys.
- **Ctags runs 4 processes at a time** (fewer on a machine with fewer than 5
  cores), on 200 files each. The symbols keep Git's file order, so equal
  matches keep one order.
- **Names on a line of more than 20,000 bytes are left out**, as in minified
  code; the file view shows a file with such a line as plain text. Only a file
  that has tags and is larger than 20,000 bytes is read for the check. The
  file's other lines keep their names.

## Results

Apple M1 Pro (8 cores), Universal Ctags 6.2.1, Node 25.3.0, headless Chromium
at 1440 × 1000. Each pair ran one after the other, with a load average of 4.4
to 5.2 (other agents' jobs). Medians, with p95 after the slash. A key is typed
when the last key's results show; "typed" keys are 60 ms apart. Host rows
call `WorkingTreeSymbols` directly; app rows run the built CLI and the page.

Workbench at `9b2c854b` (3,121 files, 62,000 tags):

| Measure                                  |      Before |      After |
| ---------------------------------------- | ----------: | ---------: |
| Host: first read                         |    1,774 ms |     506 ms |
| Host: a key                              |  44 / 51 ms | 3.8 / 8 ms |
| Host: a key without a watcher            |  44 / 52 ms | 40 / 43 ms |
| App: open the picker to the first answer |    1,865 ms |     545 ms |
| App: a key to its results                | 65 / 386 ms | 31 / 45 ms |
| App: the request of a key                |  48 / 86 ms |   6 / 8 ms |
| App: last key, typed                     | 58 / 435 ms | 19 / 34 ms |

Six copies of Workbench in one checkout (17,814 files, 365,000 tags, under
the 20,000-file limit):

| Measure                                  |       Before |        After |
| ---------------------------------------- | -----------: | -----------: |
| Host: first read                         |    10,607 ms |     2,792 ms |
| Host: a key                              | 228 / 247 ms |   26 / 36 ms |
| Host: a key without a watcher            | 231 / 276 ms | 207 / 233 ms |
| App: open the picker to the first answer |    10,693 ms |     2,943 ms |
| App: a key to its results                | 240 / 295 ms |   43 / 56 ms |
| App: the request of a key                | 224 / 275 ms |   29 / 39 ms |
| App: last key, typed                     | 244 / 266 ms |   41 / 51 ms |

At a load of 13 to 29, the same runs gave 31–100 ms for a key after, against
77–518 ms before; the first read varies most with load.

## Commands

Run from `apps/med` after `bun run build`, with Universal Ctags installed:

```sh
node scripts/benchmark-working-symbols.mjs <repo>
# The base build: a copy of dist/ at 9b2c854b, and that commit's apps/med.
node scripts/benchmark-working-symbols.mjs <repo> --cli <base>/dist/cli.js --source <base-checkout>/apps/med
```

The script bundles `src/host/search/symbols.ts` for the host rows, starts the
built CLI with an empty state folder and no Zoekt for the app rows, and writes
`.benchmarks/working-symbols.json`. The base build's `--cli` must sit in a
folder named `dist` beside a `node_modules` that has `zod`, for example
`.benchmarks/before/dist`.

## Limits

- The first read after the host starts still runs Ctags over every file;
  the tags are not kept on disk.
- An edit is seen when the watcher's event arrives, tens of milliseconds
  after the write. A search in that gap gets the last read; the next one
  reads again.
- As for the file list, some edits have no file event: in a folder that Git
  ignored when the watcher started, and on Linux, deeper than 8 folders. The
  safety check finds them (each minute while a window shows the checkout,
  else each 10 minutes); until then, the last read answers.
- A checkout of more than 20,000 files takes its project symbols from Zoekt,
  which this work did not change.
