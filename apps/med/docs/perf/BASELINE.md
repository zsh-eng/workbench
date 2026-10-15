# Med performance baseline

This document records where Med spends time on 2026-10-15, at commit
`3a118b9e` (`main`, with tabs). It gives a breakdown of each action and a ranked list of
fixes. The goal: only React rendering limits Med, and that rendering is well
optimized. Git, polling, parsing, and start-up must not be on the critical
path.

The numbers come from `scripts/perf/baseline.json`. All times are medians, in
milliseconds. Git, HTTP, and WebSocket counts are the fewest over the runs;
React counts are medians.

The first baseline was on the `med-explorations` branch (`e2e6db35`). Main does
not have that branch's Inbox page, Change map, Land, and Turn blame. The
findings are the same on both; main's numbers are below. On main, the 14 test
threads are tabs at the first start, so all 14 stay loaded.

## Commands

Run from `apps/med` after `bun run build`.

```sh
node scripts/perf/budget.mjs                      # about 5 minutes; writes .benchmarks/perf/budget.json
node scripts/perf/budget.mjs --check scripts/perf/baseline.json
node scripts/perf/check.mjs scripts/perf/baseline.json .benchmarks/perf/budget.json
node scripts/perf/budget.mjs --quick --no-react   # about 2 minutes, for a first look
node scripts/perf/budget.mjs --frames --only warm,cold --runs 3 --no-react   # headed; painted frames
node scripts/perf/budget.mjs --only warm,idle --runs 1 --no-react --host-profile
```

`--check` exits 1 when the budget fails. The rules are in `check.mjs` (lines
5–27):

- Git processes must not go up. HTTP requests and WebSocket messages can go up
  by one. These use the fewest over the runs.
- React commits and renders can go up by 15% (medians).
- Bytes (the mean over the runs) can go up by 25%. Memory with all threads
  loaded can go up by 10%.
- Times can go up by the tolerance (25%) or by 5 ms, whichever is more (20 ms
  for host CPU). When the load is more than 1.5 times the baseline's plus 1,
  a slower time is a warning only.
- Racy windows (the first key after a load, warm visits to the large diff,
  agent steps, and idle) compare medians; their counts can go up by 25%, and
  their bytes can double. In agent and idle windows, only counts and host CPU
  are checked; host CPU fails when it doubles.

To make a new baseline, run the budget with
`--out scripts/perf/baseline.json` on a quiet machine. Record the load.

## Test bed and method

- **Test bed.** The exploration demo world (`scripts/explorations/world.mjs`)
  under a scratch HOME in the system temporary folder. It has 14 saved threads.
  Six "long" threads link to real ended Claude transcripts. A fixed rule picks
  them: for each of 294, 201, 111, 79, 32, and 17 MB, the largest transcript in
  `~/.claude/projects` at or below that size that has not changed for 2 hours.
  The pick stays in `.benchmarks/perf/transcripts.json`, which Git ignores,
  because its paths name private projects and sessions; delete it to pick
  again. Committed files record only sizes; on this computer the pick is 294,
  111, 79, 78, 30, and 16 MB. The script makes APFS clones of the transcripts
  and does not write to `~/.claude`. On a computer without them, it writes
  synthetic transcripts of the six sizes; the fixture digest then changes and
  the check prints a warning. One thread has a large diff: 48 files, 10,056
  diff lines.
- **Host.** The built `dist/cli.js` on port 6451, with a Git shim (C,
  `posix_spawn` and `wait4`) first on its PATH. The shim logs each Git process
  with its arguments, time, and CPU.
- **Browser.** Playwright Chromium 153, headless, 1440×900 at 2×, dark.
- **Marks** (`page.mjs`). From the key event: COMMIT (the DOM shows the
  thread's slot), FRAME (the next animation frame), PAINTED (a task after that
  frame), SHOWN (nothing in the slot is pending), and SETTLED (the main thread
  is quiet for 100 ms). LIST marks the thread list on a page load.
- **Breakdown** (`trace.mjs`). A CDP trace splits the time to COMMIT into
  0.1 ms bins. Each bin gets one kind: main-thread work (script, style, layout,
  paint, GC, other), then worker, then Git (a Git process runs), then host (a
  request is open), else idle. "Other" is task and IPC overhead, mostly network
  and WebSocket messages that arrive. JSON and HTML parse count as script.
- **React.** A second pass serves a build with `react-dom/profiling`
  (`vite.profiling.config.ts`) and a minimal DevTools hook. It records React's
  own time, commits, and component renders. The build is not minified, so its
  times are 10–30% longer; use it for counts and shares.
- **Cold ⌘.** The script holds `GET /api/reviews/<id>` of the first thread
  that the warm pool loads. The warm pool stops, and the target stays cold.
- **Runs.** Five runs of each action; 35 warm switches between 7 threads, and
  5 to the large diff. One page load first is not counted. Each load starts
  2 s after the last. The React pass makes 2 runs and 14 warm switches.
- **Not measured.** Pages that main does not have (see above).

Machine: Apple M1 Pro, 8 cores, 16 GB, macOS 27, Node 25.3, Git 2.52. Other
agents ran browser tests on the same machine. The 1-minute load average was
2.2–3.3 during the main pass of the baseline run and up to 9 during its
React pass (each action records its own).

## Results by action

| Action                        | Load | COMMIT        | PAINTED | SHOWN | SETTLED |  Git (time) | HTTP (API) | WS msgs, kB | Host CPU |
| ----------------------------- | ---: | ------------- | ------: | ----: | ------: | ----------: | ---------: | ----------: | -------: |
| Page load, to the thread      | 2.97 | LIST 171, 109 |       – |   301 |       – | 13 (144 ms) |    60 (17) |      5, 195 |       80 |
| First ⌘ after the load (cold) | 2.97 | 77            |      98 |   102 |     610 | 83 (758 ms) |    69 (63) |    19, 1087 |      260 |
| Cold ⌘ after idle             | 3.21 | 86            |     108 |   105 |     169 | 19 (168 ms) |    19 (18) |      7, 162 |       40 |
| Cold ⌘, large diff            | 3.11 | 76            |     124 |   120 |     173 | 14 (176 ms) |    18 (17) |       7, 65 |       40 |
| Warm ⌘ switch                 | 2.46 | 26            |      45 |    28 |     129 | 19 (235 ms) |    15 (15) |      7, 192 |       60 |
| Warm ⌘, large diff            | 2.46 | 30            |      47 |    31 |     101 | 14 (200 ms) |    15 (15) |       8, 90 |       50 |

### Time to COMMIT

Production build, in ms. For the page load, the time to LIST. The last column
is React's time in the profiling build, of that build's total time to COMMIT.

| Action                 | Script | Style | Layout | Paint |  GC | Other | Worker | Git | Host | Idle | React (profiling) |
| ---------------------- | -----: | ----: | -----: | ----: | --: | ----: | -----: | --: | ---: | ---: | ----------------: |
| Page load, to LIST     |    118 |    12 |     11 |     3 |   4 |    18 |      0 |   0 |    3 |  0.2 |         76 of 230 |
| First ⌘ after the load |     35 |     6 |      3 |     2 |   2 |    12 |      0 |   9 |    4 |    0 |         40 of 123 |
| Cold ⌘ after idle      |     39 |     5 |      3 |     4 |   9 |    13 |    0.9 | 0.4 |   10 |  0.2 |          31 of 86 |
| Cold ⌘, large diff     |     36 |     6 |      3 |     4 |   0 |    11 |     11 |   1 |    3 |  0.2 |         31 of 110 |
| Warm ⌘ switch          |     14 |   6.6 |    5.3 |   0.1 |   0 |   0.2 |      0 |   0 |    0 |  0.2 |          16 of 31 |
| Warm ⌘, large diff     |     14 |   7.2 |    6.5 |   0.2 |   0 |   0.2 |      0 |   0 |    0 |  0.3 |          17 of 32 |

Idle waits are below 0.5 ms in each action. Git and host waits are on the
critical path only for cold opens (5–6 ms), the first key after a load
(12 ms), and the page load (11 ms).

### Whole action

Main thread from the key to SETTLED, in ms; React from the profiling pass.

| Action                        | Script | Style | Layout | Paint | Forced layout, style | Longest task | Workers (ms) | React ms, commits, renders |
| ----------------------------- | -----: | ----: | -----: | ----: | -------------------: | -----------: | -----------: | -------------------------: |
| Page load, to the thread      |    173 |    16 |     27 |     9 |               22, 15 |           44 |       5 (74) |               167, 44, 895 |
| First ⌘ after the load        |    280 |    42 |     31 |    25 |               21, 21 |           22 |       8 (65) |            255, 151, 2,428 |
| Cold ⌘ after idle             |     91 |    24 |      8 |    13 |                 5, 7 |           14 |       4 (17) |                97, 48, 966 |
| Cold ⌘, large diff            |    108 |    25 |      7 |    10 |                 5, 8 |           37 |       3 (45) |                96, 43, 880 |
| Warm ⌘ switch                 |     37 |    17 |      6 |    11 |                 5, 7 |           26 |        0 (0) |                45, 15, 336 |
| Warm ⌘, large diff            |     32 |    21 |      7 |    11 |                 6, 7 |           27 |        0 (0) |                45, 15, 360 |
| Three agent steps, off screen |     60 |     0 |      0 |     0 |                 0, 0 |           20 |       18 (2) |                 32, 7, 230 |

In a warm switch, the `<Activity>` reveal re-runs layout effects
("Reconnect"). Most renders are Base UI roots that show nothing: per warm
switch, MenuRoot 25, TooltipRoot 17, ActionTooltip 16, FloatingTree 14,
TooltipTrigger 13, ContextMenuRoot 12.

### Idle and background work

| Window                 |     Git, per minute | Git CPU | Host CPU | Browser main thread | Style recalculations | WS messages |
| ---------------------- | ------------------: | ------: | -------: | ------------------: | -------------------: | ----------: |
| 60 s idle, one window  |                  98 |  1.10 s |   890 ms |              120 ms |                    0 |   4 (pings) |
| 60 s idle, two windows | 98 (shared by both) |  1.06 s | 1,060 ms |              148 ms |                    0 |   8 (pings) |

Idle Git: 66 `git status` (`runtime/watch.ts:114`, every 10 s for each watched
repository), 26 `git rev-list --count` (`checkout-work.ts:18`, every 30 s for
each tab), and 6 others. Each Git process takes 10–12 ms (8–10 ms CPU).

A host CPU profile (on `med-explorations`, 120 idle seconds, two windows)
shows: Git processes 20% (the watcher's status check is 9% of this), the
transcript tail poll (`agent-transcripts.ts:25`, every 400 ms for each followed
file) 9%, and the thread list loop (`server.ts:1058–1080`, every 1.5 s for each
window) 4%.

With tabs, the sidebar's working indicator does not turn, and the test bed has
no waiting thread at idle: no style recalculation. A waiting thread's dot still
animates `box-shadow` (`ThreadSidebar.tsx:727–731, 968–975`), which the
compositor cannot run; before tabs, this was about 320 recalculations a minute
for each window.

Three agent steps in a thread that is not on screen: the host sends the full
thread list (14 kB) for each step. React makes 7 commits and 230 renders.

### Memory

With 14 threads loaded: JS heap 47 MB (3.3 MB for each thread), 43,200 DOM
nodes, 10,260 event listeners, and 18 workers (14 patch parsers, one for each
workspace; 3 diff workers; 1 Markdown worker).

### Painted frames

On `med-explorations`: headed Chromium on the 120 Hz display, CDP screencast,
3 runs, load 2.9:

| Action        | COMMIT | First frame after COMMIT | Longest frame gap |
| ------------- | -----: | -----------------------: | ----------------: |
| Warm ⌘ switch |     28 |                       37 |                19 |
| Cold ⌘        |     91 |                       95 |                19 |

A warm switch paints one frame after its commit. The longest gap is two frames
at 120 Hz; the screencast can also drop frames, so this is an upper limit.

## Known facts, checked

| Fact                                        | Measured on main                                                           | Result                               |
| ------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------ |
| Warm switch 35–60 ms                        | COMMIT 26, PAINTED 45                                                      | Faster                               |
| Cold open 53–78 ms                          | COMMIT 86, SHOWN 105                                                       | Same; Git is off the commit path     |
| Large diff 270–360 ms                       | Cold SHOWN 120; warm 31                                                    | Much faster                          |
| First ⌘ after load about 250 ms             | COMMIT 77 (63–93)                                                          | Faster                               |
| Page load to the list about 170 ms          | LIST 171                                                                   | Same                                 |
| Idle host 190–310 ms per 30 s               | Host 445 ms per 30 s, and Git children 550 ms CPU per 30 s                 | Higher; Git was not counted before   |
| Each Git process 10–13 ms                   | 10–12 ms                                                                   | Correct                              |
| Thread list polls every 1.5 s               | Correct (`server.ts:1034–1066`); one loop for each window; sends on change | Correct                              |
| One worker for each workspace               | 14 patch parsers, plus 4 other workers                                     | Correct                              |
| Diff, transcript, and file tree virtualized | Diff: 49 of 10,056 lines in the DOM; transcript: first view of 150 units   | Correct; file tree not checked alone |

## Findings

1. **A warm switch is fast but starts much work.** COMMIT is 26 ms and has no
   Git or host wait. But each switch starts 19 Git processes, 15 requests
   (`controller.ts:2023`, `resume()` calls `reconcile()`), and 50–60 ms of
   host CPU. The host sends the session's first view again: 29–593 kB for each
   thread, 192 kB median. Revisits get as many bytes as first visits, so the
   resume path (`?feed&count`) did not skip the first view. The main thread
   works until SETTLED at 129 ms.
2. **Forced layout is about half of a warm switch.** Of 26 ms to COMMIT, 12 ms
   is forced style and layout. Traces with JS stacks give the sources:
   `SessionThread.tsx:1144–1175` (`readProbe` reads the probe on each reveal,
   about 55%), `App.tsx:885–903` (scroll restore through `CodeView.scrollTo`,
   after the commit, about 20%), `SessionThread.tsx:1460`
   (`getBoundingClientRect` for each unit), `Workspaces.tsx:1624`
   (`KeepScroll`), and `PaneTree.tsx:472` (`useBox`).
3. **Idle is not idle.** With no change on disk, the host starts 98 Git
   processes a minute (1.1 s Git CPU) and uses 0.9–1.1 s of its own CPU. A
   waiting thread's dot recalculates style about 320 times a minute.
4. **The first key after a load is 3 times a warm switch.** The warm pool
   loads 13 threads at the same time: 83–101 Git processes, 69 requests, and
   1,087 kB of session data in the window. Main-thread "other" (IPC) is 12 ms
   before the commit.
5. **React renders things that do not show.** Menu and tooltip roots are about
   30% of renders in a warm switch. Every ThreadRow renders again for each
   thread list update. Page load runs 130 ms of script before the list; it
   loads 40 files (2.2 MB).

## Ranked fixes

Gains are estimates from the breakdowns above. "Host only" means no change to
the web app.

|   # | Fix                                                                                                                                                                                                                                                                                                      | Data                                                                                                                                                                                                                                        | Expected gain                                                                                                             | Files                                                                                                                                                                               |
| --: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|   1 | **Host repository cache; no new checks on show.** The host keeps branches, targets, worktrees, sessions, and the working diff, and clears them on watcher events. `resume()` does not call `reconcile()` unless an event came while the thread was hidden. (Cache: host only.)                           | Warm switch: 19 Git, 15 requests, 50–60 ms host CPU, SETTLED 140 ms. Cold: 19 Git, 19 requests, 5 ms host wait. First key: 55–83 Git, 54 requests.                                                                                          | Warm: Git 19 → 0, requests 15 → 2 or fewer, SETTLED 140 → about 60 ms. Cold COMMIT −5 ms. First key COMMIT −20 to −30 ms. | `web/data/controller.ts:816–822, 2023–2033`; `host/server.ts` (`session()`, branches, targets, drift); `host/repository/registry.ts`                                                |
|   2 | **Push instead of polling.** Use watcher events for status and checkout work, with a long safety interval; follow transcripts with `fs.watch`; send thread list changes, not the full list. (Host only, except the indicators.) Make the sidebar indicators compositor-only.                             | Idle: 102 Git a minute, 0.9 s Git CPU, 0.4–0.8 s host CPU; about 320 style recalculations a minute for each window. Agent step: full list, 14.5 kB.                                                                                         | Idle Git 102 → near 0 a minute; idle host CPU −70%; idle browser main thread −80%.                                        | `host/runtime/watch.ts:114`; `host/checkout-work.ts:18`; `host/agent-transcripts.ts:25, 244–355`; `host/server.ts:448, 1058–1080`; `web/components/shell/ThreadSidebar.tsx:591–595` |
|   3 | **Parsed content cached by Git object ID and transcript position; first screen first.** Serve reviews with an ETag from their object IDs; keep parsed files by ID; resume sessions by byte offset. Keep host followers and web stores for each thread in the warm pool. (ETag and followers: host only.) | Warm: first view sent again, 187 kB (29–593 kB). Warm large diff: review JSON 568 kB again. Cold: 162 kB. First key: 704 kB. Host keeps 6 idle followers (`IDLE_FEEDS`); the test cycles 8 threads; the web keeps 12 stores for 14 threads. | Warm WS 187 kB → below 5 kB; warm large diff HTTP −568 kB; SETTLED −50 ms; less host CPU.                                 | `host/agent-transcripts.ts:358–490`; `web/data/session-stream.ts:139–146, 173`; `host/server.ts` (session events, saved target review); `web/data/controller.ts` (review reload)    |
|   4 | **Layout reads once per theme and width.** Skip `readProbe` when the theme and width are the same (`knownMetrics` exists); measure units with `ResizeObserver` only; restore scroll from saved numbers without a read.                                                                                   | Warm switch: 10 of 20 ms before COMMIT is forced style and layout; page load: 26 + 17 ms.                                                                                                                                                   | Warm COMMIT 20 → about 13 ms; PAINTED 45 → about 35 ms.                                                                   | `web/components/session/SessionThread.tsx:1144–1175, 1460`; `web/App.tsx:885–903`; `web/components/Workspaces.tsx:1624`; `web/components/PaneTree.tsx:472`                          |
|   5 | **React render scope** (added from the data). Mount menu and tooltip roots on first open; memo ThreadRow on its own thread; keep threads in a store by ID so that one change renders one row.                                                                                                            | About 30% of warm-switch renders are menu and tooltip roots. ThreadRow renders 3 times in a cold open, and for each agent step.                                                                                                             | Renders −30 to −40%; warm React before COMMIT 16 → about 10 ms.                                                           | `web/components/ToolButton.tsx` (`ActionTooltip`); `web/components/shell/ThreadSidebar.tsx`; workspace toolbar menus                                                                |
|   6 | **Worker pools and a smaller entry bundle.** Share 2 patch-parser workers between workspaces; move code that the first screen does not use out of the entry.                                                                                                                                             | Page load: 40 files, 2.2 MB, 130 ms script before LIST. 18 workers for 14 threads; heap 3.3 MB for each thread.                                                                                                                             | LIST 202 → about 150 ms; workers 18 → 6; less memory.                                                                     | `web/workers/client.ts`; `web/main.tsx`; `web/components/Workspaces.tsx` (`createParser`); `vite.config.ts`                                                                         |
|   7 | **First-paint rules for diff and transcript.** Virtualization works: keep it above about two screens; render in full below that; never measure on reveal (fix 4).                                                                                                                                        | Large diff: 49 of 10,056 lines in the DOM; cold COMMIT 70 vs 68 for a small diff; warm 21 vs 20. The cost of virtualization is the measurement on reveal.                                                                                   | Small (below 5 ms) after fix 4. Measure a full-render switch before a change.                                             | `web/components/session/SessionThread.tsx`; `web/components/session/thread-heights.ts`; diff options in `web/App.tsx`                                                               |

## Limits

- The profiling build is not minified, so its times are longer. Use it for
  React counts and shares, not for absolute times.
- Painted frames come from a CDP screencast in headed Chromium. It can drop
  frames. The check does not include them.
- Host CPU comes from `ps` (10 ms steps). A host CPU profile doubles host CPU.
- Idle and agent windows are one run each. Their times move with the load;
  the check uses their counts and a host CPU limit only. The React pass runs
  the next three agent steps (a command, a read, a command), not the same
  three, because the demo agent has nine steps.
- Warm switches visit threads that the sidebar shows in its first nine places;
  the order can change between rounds as threads update.
- The machine was shared: the load was 2.2–9.0 during the main baseline, and
  other agents ran browser tests.
- Not measured: GPU and raster time, the installed app window, memory over
  hours, switch time with two windows open, and the file tree alone.
- The real transcripts are on this computer only. On another computer, the
  test bed uses synthetic transcripts with a different digest, so a new
  baseline is necessary.
