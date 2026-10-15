# Med performance baseline

This document records where Med spends time on 2026-10-15, at commit
`e2e6db35` (branch `med-explorations`). It gives a breakdown of each action and
a ranked list of fixes. The goal: only React rendering limits Med, and that
rendering is well optimized. Git, polling, parsing, and start-up must not be on
the critical path.

The numbers come from `scripts/perf/baseline.json`. All times are medians, in
milliseconds. Git, HTTP, and WebSocket counts are the fewest over the runs;
React counts are medians.

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

Three later runs pass this check: at loads of 3.6 and 5.3 with no warnings,
and at 8.8 with warnings for slower times.

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
  again. Committed files record only sizes. The script makes APFS clones of
  the transcripts and does not write to `~/.claude`. On a computer without
  them, it writes synthetic transcripts of the six sizes; the fixture digest
  then changes and the check prints a warning. One thread has a large diff: 48
  files, 10,056 diff lines.
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
- **Not measured.** Turn blame, Change map, Land, and the Inbox page. The
  counts do not include requests to `/edits` and `/land`.

Machine: Apple M1 Pro, 8 cores, 16 GB, macOS 27, Node 25.3, Git 2.52. Other
agents ran browser tests on the same machine. The 1-minute load average was
2.3–4.3 during the baseline run (each action records its own).

## Results by action

| Action                        | Load | COMMIT        | PAINTED | SHOWN | SETTLED |  Git (time) | HTTP (API) | WS msgs, kB | Host CPU |
| ----------------------------- | ---: | ------------- | ------: | ----: | ------: | ----------: | ---------: | ----------: | -------: |
| Page load, to the thread      | 2.66 | LIST 178, 112 |       – |   303 |       – | 13 (152 ms) |    59 (17) |      5, 196 |       60 |
| First ⌘ after the load (cold) | 2.66 | 99            |     126 |   139 |     642 | 74 (709 ms) |    59 (54) |     16, 962 |      270 |
| Cold ⌘ after idle             | 3.39 | 82            |     124 |   115 |     184 | 19 (175 ms) |    20 (18) |      7, 411 |       50 |
| Cold ⌘, large diff            | 3.20 | 73            |     121 |   118 |     195 | 14 (189 ms) |    18 (17) |       7, 65 |       50 |
| Warm ⌘ switch                 | 3.70 | 23            |      43 |    25 |     144 | 19 (234 ms) |    16 (16) |      8, 260 |       70 |
| Warm ⌘, large diff            | 3.50 | 22            |      42 |    23 |     138 | 14 (175 ms) |    14 (14) |       7, 69 |       40 |

### Time to COMMIT

Production build, in ms. For the page load, the time to LIST. The last column
is React's time in the profiling build, of that build's total time to COMMIT.

| Action                 | Script | Style | Layout | Paint |  GC | Other | Worker | Git | Host | Idle | React (profiling) |
| ---------------------- | -----: | ----: | -----: | ----: | --: | ----: | -----: | --: | ---: | ---: | ----------------: |
| Page load, to LIST     |    121 |    12 |     11 |     4 |   4 |    20 |      0 |   0 |    4 |  0.1 |         76 of 213 |
| First ⌘ after the load |     42 |     8 |      4 |     5 |   4 |    29 |      0 |   4 |    4 |  0.2 |         37 of 142 |
| Cold ⌘ after idle      |     38 |     5 |      3 |     4 |   0 |    22 |    0.3 |   0 |    7 |  0.3 |         40 of 103 |
| Cold ⌘, large diff     |     33 |     6 |      3 |     3 |   0 |    12 |     12 |   2 |    4 |  0.2 |         33 of 110 |
| Warm ⌘ switch          |     12 |   6.1 |    4.5 |     0 |   0 |   0.1 |      0 |   0 |    0 |  0.3 |          16 of 30 |
| Warm ⌘, large diff     |     10 |   6.3 |    5.2 |     0 |   0 |   0.1 |      0 |   0 |    0 |  0.3 |          15 of 28 |

Idle waits are below 0.5 ms in each action. Git and host waits are on the
critical path only for cold opens (7 ms or less) and the first key after a
load (8 ms). In the profiling build, which is slower, the first key waits
16–64 ms for Git and the host (two baseline runs).

### Whole action

Main thread from the key to SETTLED, in ms; React from the profiling pass.

| Action                        | Script | Style | Layout | Paint | Forced layout, style | Longest task | Workers (ms) | React ms, commits, renders |
| ----------------------------- | -----: | ----: | -----: | ----: | -------------------: | -----------: | -----------: | -------------------------: |
| Page load, to the thread      |    177 |    17 |     27 |    10 |               23, 15 |           45 |       5 (77) |               168, 43, 937 |
| First ⌘ after the load        |    289 |    50 |     34 |    36 |               18, 23 |           24 |       7 (68) |            271, 145, 2,549 |
| Cold ⌘ after idle             |    106 |    24 |      9 |    17 |                 6, 8 |           24 |       4 (20) |               104, 52, 994 |
| Cold ⌘, large diff            |    112 |    23 |      8 |    13 |                 5, 7 |           34 |       3 (44) |                96, 47, 968 |
| Warm ⌘ switch                 |     41 |    12 |      5 |    13 |                 5, 7 |           23 |        0 (0) |                49, 18, 334 |
| Warm ⌘, large diff            |     32 |    12 |      6 |    12 |                 5, 6 |           22 |        0 (0) |                45, 16, 370 |
| Three agent steps, off screen |     64 |     3 |      4 |     7 |                 0, 0 |           20 |       18 (1) |                28, 23, 343 |

React is 61–73% of script time in the profiling build. In a warm switch, the
`<Activity>` reveal re-runs layout effects ("Reconnect"): 3 per switch, 17 ms.

Most renders are Base UI roots that show nothing. Per warm switch: MenuRoot 27,
TooltipRoot 18, ActionTooltip 18, FloatingTree 14, TooltipTrigger 14,
ContextMenuRoot 11 (102 of 334). A cold open renders each ThreadRow 3 times
(43 renders for 14 rows).

### Idle and background work

| Window                 |      Git, per minute | Git CPU |     Host CPU | Browser main thread | WS messages |
| ---------------------- | -------------------: | ------: | -----------: | ------------------: | ----------: |
| 60 s idle, one window  |                  102 |  1.07 s |   530–970 ms |          190–375 ms |   4 (pings) |
| 60 s idle, two windows | 102 (shared by both) |  0.96 s | 550–1,090 ms |          340–675 ms |   8 (pings) |

The ranges come from five runs on 2026-10-15. Idle Git: 68 `git status`
(`runtime/watch.ts:114`, every 10 s for each watched repository), 28
`git rev-list --count` (`checkout-work.ts`, every 30 s for each thread), and 6
others. Each Git process takes 10–12 ms (7.5–10.5 ms CPU).

A host CPU profile of 120 idle seconds (two windows, profiler on) shows: Git
processes 20% (the watcher's status check is 9% of this), the transcript tail
poll (`agent-transcripts.ts:25`, every 400 ms for each followed file) 9%, and
the thread list loop (`server.ts:1068`, every 1.5 s for each window) 4%.

The browser's idle work is style recalculation: about 320 a minute for each
window. The sidebar's state indicators animate without stop
(`ThreadSidebar.tsx:739–760`); the waiting dot animates `box-shadow`, which the
compositor cannot run.

Three agent steps in a thread that is not on screen: the host sends the full
thread list (14.5 kB) for each step. React makes 23 commits and 343 renders;
every ThreadRow renders again.

### Memory

With 14 threads loaded: JS heap 55 MB (4.0 MB for each thread), 43,100 DOM
nodes, 30,030 event listeners, and 18 workers (14 patch parsers, one for each
workspace; 3 diff workers; 1 Markdown worker).

### Painted frames

Headed Chromium on the 120 Hz display, CDP screencast, 3 runs, load 2.9:

| Action        | COMMIT | First frame after COMMIT | Longest frame gap |
| ------------- | -----: | -----------------------: | ----------------: |
| Warm ⌘ switch |     28 |                       37 |                19 |
| Cold ⌘        |     91 |                       95 |                19 |

A warm switch paints one frame after its commit. The longest gap is two frames
at 120 Hz; the screencast can also drop frames, so this is an upper limit.

## Known facts, checked

| Fact                                        | Measured                                                                     | Result                               |
| ------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------ |
| Warm switch 35–60 ms                        | COMMIT 23, PAINTED 43; headed: COMMIT 28, frame 37                           | Faster                               |
| Cold open 53–78 ms                          | COMMIT 82, SHOWN 115                                                         | Same; Git is off the commit path     |
| Large diff 270–360 ms                       | Cold SHOWN 118; warm 23                                                      | Much faster                          |
| First ⌘ after load about 250 ms             | COMMIT 99 (71–114); 184–300 on the first load after the host starts          | Faster, except after a host start    |
| Page load to the list about 170 ms          | LIST 178                                                                     | Same                                 |
| Idle host 190–310 ms per 30 s               | Host 265–485 ms per 30 s, and Git children 530 ms CPU per 30 s               | Higher; Git was not counted before   |
| Each Git process 10–13 ms                   | 10–12 ms                                                                     | Correct                              |
| Thread list polls every 1.5 s               | Correct (`server.ts:1068–1078`); it reads each saved record; sends on change | Correct                              |
| One worker for each workspace               | 14 patch parsers, plus 4 other workers                                       | Correct                              |
| Diff, transcript, and file tree virtualized | Diff: 49 of 10,056 lines in the DOM; transcript: first view of 150 units     | Correct; file tree not checked alone |

## Findings

1. **A warm switch is fast but starts much work.** COMMIT is 23 ms and has no
   Git or host wait. But each switch starts 19 Git processes, 16 requests
   (`controller.ts:2023`, `resume()` calls `reconcile()`), and 70–110 ms of
   host CPU. The host sends the session's first view again: 18–573 kB for each
   thread, 260 kB median. Revisits get as many bytes as first visits, so the
   resume path (`?feed&count`) did not skip the first view. The main thread
   works until SETTLED at 144 ms.
2. **Forced layout is 46% of a warm switch.** Of 23 ms to COMMIT, 11 ms is
   forced style and layout. Traces with JS stacks give the sources:
   `SessionThread.tsx:1174–1189` (`readProbe` reads the probe on each reveal,
   about 55%), `App.tsx:889–901` (scroll restore through `CodeView.scrollTo`,
   after the commit, about 20%), `SessionThread.tsx:1494–1500`
   (`getBoundingClientRect` for each unit), `Workspaces.tsx:1700`
   (`KeepScroll`), and `PaneTree.tsx:472` (`useBox`).
3. **Idle is not idle.** With no change on disk, the host starts 102 Git
   processes a minute (1.1 s Git CPU) and uses 0.5–1.0 s of its own CPU. Each
   window recalculates style about 320 times a minute.
4. **The first key after a load is 4.3 times a warm switch.** The warm pool
   loads 13 threads at the same time: 74 Git processes, 59 requests, and 962 kB
   of session data in the window. Main-thread "other" (IPC) is 29 ms before
   the commit.
5. **React renders things that do not show.** Menu and tooltip roots are 31%
   of renders in a warm switch. Every ThreadRow renders again for each thread
   list update. Page load runs 121 ms of script before the list; it loads 39
   files (2.28 MB).

## Ranked fixes

Gains are estimates from the breakdowns above. "Host only" means no change to
the web app.

|   # | Fix                                                                                                                                                                                                                                                                                                      | Data                                                                                                                                                                                                                                        | Expected gain                                                                                                             | Files                                                                                                                                                                                            |
| --: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
|   1 | **Host repository cache; no new checks on show.** The host keeps branches, targets, worktrees, sessions, and the working diff, and clears them on watcher events. `resume()` does not call `reconcile()` unless an event came while the thread was hidden. (Cache: host only.)                           | Warm switch: 19 Git, 16 requests, 70–110 ms host CPU, SETTLED 144 ms. Cold: 19 Git, 20 requests, 7 ms host wait. First key: 74 Git, 59 requests.                                                                                            | Warm: Git 19 → 0, requests 16 → 2 or fewer, SETTLED 144 → about 60 ms. Cold COMMIT −7 ms. First key COMMIT −20 to −30 ms. | `web/data/controller.ts:816–822, 2023–2033`; `host/server.ts:617, 1733–1745, 1879, 2066, 2137–2156`; `host/repository/registry.ts`                                                               |
|   2 | **Push instead of polling.** Use watcher events for status and checkout work, with a long safety interval; follow transcripts with `fs.watch`; send thread list changes, not the full list. (Host only, except the indicators.) Make the sidebar indicators compositor-only.                             | Idle: 102 Git a minute, 1.1 s Git CPU, 0.5–1.0 s host CPU; about 320 style recalculations a minute for each window. Agent step: full list, 14.5 kB.                                                                                         | Idle Git 102 → near 0 a minute; idle host CPU −70%; idle browser main thread −80%.                                        | `host/runtime/watch.ts:114`; `host/checkout-work.ts:18, 81`; `host/agent-transcripts.ts:25, 241–340`; `host/server.ts:316, 1068–1078`; `web/components/shell/ThreadSidebar.tsx:590–595, 739–760` |
|   3 | **Parsed content cached by Git object ID and transcript position; first screen first.** Serve reviews with an ETag from their object IDs; keep parsed files by ID; resume sessions by byte offset. Keep host followers and web stores for each thread in the warm pool. (ETag and followers: host only.) | Warm: first view sent again, 260 kB (18–573 kB). Warm large diff: review JSON 568 kB again. Cold: 411 kB. First key: 962 kB. Host keeps 6 idle followers (`IDLE_FEEDS`); the test cycles 8 threads; the web keeps 12 stores for 14 threads. | Warm WS 260 kB → below 5 kB; warm large diff HTTP −568 kB; SETTLED −50 ms; less host CPU.                                 | `host/agent-transcripts.ts:355–470`; `web/data/session-stream.ts:139–146, 173`; `host/server.ts:974, 1697–1733`; `web/data/controller.ts` (review reload)                                        |
|   4 | **Layout reads once per theme and width.** Skip `readProbe` when the theme and width are the same (`knownMetrics` exists); measure units with `ResizeObserver` only; restore scroll from saved numbers without a read.                                                                                   | Warm switch: 11 of 23 ms before COMMIT is forced style and layout; page load: 23 + 15 ms.                                                                                                                                                   | Warm COMMIT 23 → about 15 ms; PAINTED 43 → about 33 ms.                                                                   | `web/components/session/SessionThread.tsx:1174–1189, 1494–1500`; `web/App.tsx:889–901`; `web/components/Workspaces.tsx:1700`; `web/components/PaneTree.tsx:472`                                  |
|   5 | **React render scope** (added from the data). Mount menu and tooltip roots on first open; memo ThreadRow on its own thread; keep threads in a store by ID so that one change renders one row.                                                                                                            | 31% of warm-switch renders are menu and tooltip roots. ThreadRow renders 3 times in a cold open, and for each agent step.                                                                                                                   | Renders −30 to −40%; warm React before COMMIT 15 → about 10 ms.                                                           | `web/components/ToolButton.tsx` (`ActionTooltip`); `web/components/shell/ThreadSidebar.tsx:408`; workspace toolbar menus                                                                         |
|   6 | **Worker pools and a smaller entry bundle.** Share 2 patch-parser workers between workspaces; move code that the first screen does not use out of the entry (768 kB, 22 preloads).                                                                                                                       | Page load: 39 files, 2.28 MB, 121 ms script before LIST. 18 workers for 14 threads; heap 4.0 MB for each thread.                                                                                                                            | LIST 178 → about 130 ms; workers 18 → 6; less memory.                                                                     | `web/workers/client.ts:14`; `web/main.tsx:33–37`; `web/components/Workspaces.tsx` (`createParser`); `vite.config.ts`                                                                             |
|   7 | **First-paint rules for diff and transcript.** Virtualization works: keep it above about two screens; render in full below that; never measure on reveal (fix 4).                                                                                                                                        | Large diff: 49 of 10,056 lines in the DOM; cold COMMIT 73 vs 82 for a small diff; warm 22 vs 23. The cost of virtualization is the measurement on reveal.                                                                                   | Small (below 5 ms) after fix 4. Measure a full-render switch in phase 2 before a change.                                  | `web/components/session/SessionThread.tsx`; `web/components/session/thread-heights.ts`; diff options in `web/App.tsx`                                                                            |

The planned order changes in two places. Layout reads move up from 5 to 4:
they are 46% of a warm switch. React render scope is new at 5. Worker pools and
the bundle move down: they affect page load and memory, not switches. First
paint moves to 7: virtualization already works.

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
- The machine was shared: the load was 2.0–4.5 over the day's runs, and other
  agents ran browser tests.
- Not measured: GPU and raster time, the installed app window, memory over
  hours, switch time with two windows open, and the file tree alone.
- The real transcripts are on this computer only. On another computer, the
  test bed uses synthetic transcripts with a different digest, so a new
  baseline is necessary.
