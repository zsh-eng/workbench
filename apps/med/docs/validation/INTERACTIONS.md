# Everyday interaction latency

This report measures the interactions people repeat all day: the sidebars, zen mode, clicks in the changed files, the history, and the files tree, the review and file tabs, workspace switches, the command palette, and the pickers. It compares `main` at `3b79b02c` (before) with the performance branch at `71638a1c` (after). Both are production builds, measured with the same fixture and sequence.

## Results

Medians in milliseconds. Frame is input to the end of the next rendered frame. Busy and script are renderer main-thread time until the page settles. Components is the number of React function components that rendered.

| Interaction                  | Frame before | Frame after | Busy before | Busy after | Script before | Script after | Components before | Components after |
| ---------------------------- | -----------: | ----------: | ----------: | ---------: | ------------: | -----------: | ----------------: | ---------------: |
| left-sidebar-hide            |         10.5 |        10.7 |        21.3 |       20.7 |           8.3 |          6.1 |               220 |              127 |
| left-sidebar-show            |         42.0 |        19.7 |        39.4 |       31.8 |          12.3 |          5.3 |               318 |              127 |
| files-sidebar-show           |         17.6 |        18.5 |        23.4 |       26.6 |           7.2 |          7.3 |               231 |              127 |
| files-sidebar-hide           |          8.7 |         9.0 |        13.0 |       15.1 |           6.1 |          5.8 |               231 |              127 |
| zen-on                       |         14.3 |        15.4 |        15.2 |       15.6 |           7.5 |          6.6 |               233 |              129 |
| zen-off                      |         25.8 |        23.1 |        26.7 |       25.2 |           8.1 |          7.1 |               276 |              172 |
| changed-file-click           |         32.2 |        33.6 |        46.7 |       65.2 |          16.7 |         16.2 |               236 |              161 |
| changed-file-click-back      |         29.6 |        30.5 |        43.8 |       46.0 |          16.6 |         15.1 |               236 |              161 |
| palette-open                 |         26.3 |        29.6 |        33.4 |       33.2 |           9.8 |          8.2 |               364 |              260 |
| palette-close                |         14.7 |        16.4 |        25.9 |       28.5 |           8.1 |          7.6 |               359 |              255 |
| file-picker-open             |         27.5 |        31.3 |        49.0 |       44.7 |          17.7 |         15.2 |               738 |              634 |
| file-picker-close            |         16.3 |        17.3 |        27.7 |       27.2 |           8.1 |          6.9 |               231 |              127 |
| branch-picker-open           |         25.0 |        26.4 |        32.5 |       33.3 |           8.9 |          8.3 |               283 |              179 |
| branch-picker-close          |         15.3 |        15.7 |        27.8 |       28.5 |           7.5 |          6.8 |               279 |              175 |
| commit-tab-open              |         16.8 |        11.2 |        18.4 |       14.7 |           9.6 |          6.3 |               293 |              215 |
| commit-tab-close             |         24.1 |        14.6 |        26.0 |       20.0 |          10.1 |          5.7 |               254 |              215 |
| workspace-key-2 (⌘2)         |         50.0 |        46.7 |        88.2 |       75.4 |          23.2 |         18.3 |               539 |              317 |
| workspace-key-1 (⌘1)         |         71.9 |        64.4 |       104.4 |       88.1 |          28.0 |         20.5 |               622 |              408 |
| workspace-row-click          |         39.8 |        33.6 |        65.4 |       62.5 |          21.4 |         15.2 |               347 |              258 |
| workspace-row-back           |         64.2 |        54.4 |        79.0 |       67.9 |          26.6 |         18.1 |               494 |              344 |
| ctrl-tab-open                |         10.3 |        11.3 |        15.0 |       15.7 |           3.1 |          3.5 |                48 |              112 |
| ctrl-tab-release             |         40.2 |        33.1 |        53.7 |       50.1 |          20.8 |         17.0 |               347 |              258 |
| ctrl-tab-back                |         71.4 |        52.0 |        79.7 |       63.7 |          28.1 |         18.4 |               520 |              344 |
| files-sidebar-open-for-tree  |         21.8 |        21.8 |        24.0 |       35.4 |           6.9 |          6.9 |               231 |              254 |
| tree-row-click               |         40.9 |        37.9 |        68.2 |       82.1 |          28.4 |         24.3 |              1065 |              691 |
| tree-row-click-other         |         33.8 |        32.4 |        60.7 |       56.4 |          29.5 |         24.5 |              1064 |              678 |
| tab-changes                  |         44.4 |        37.3 |        62.3 |       68.6 |          17.0 |         11.6 |               468 |              281 |
| tab-file                     |         27.8 |        25.3 |        48.9 |       52.6 |          26.0 |         22.4 |              1075 |              682 |
| tab-changes-again            |         36.8 |        27.4 |        45.3 |       45.3 |          16.6 |         10.9 |               468 |              281 |
| files-sidebar-close-for-tree |         11.7 |        11.0 |        14.2 |       16.3 |           6.0 |          5.6 |               231 |              127 |
| history-commit-click         |         43.1 |        41.8 |        74.1 |       83.3 |          30.8 |         30.1 |               767 |              511 |
| history-commit-click-other   |         20.1 |        21.2 |        41.0 |       46.9 |          20.3 |         19.8 |               743 |              518 |
| history-working-click        |         16.9 |        14.7 |       143.0 |      150.1 |          54.1 |         51.3 |               982 |              628 |

These runs had load averages of 17 to 35 on 8 cores, because another task ran browser tests at the same time. An earlier pair of runs at load 4 to 11, with the branch before its last commit, agrees on the large effects: left-sidebar-show 28.7 → 23.9 ms, commit-tab-open 18.4 → 8.2 ms, tab-changes 42.4 → 34.9 ms, and lower script time in all workspace switches. In that pair, the switch back to the home review was one frame slower (67 → 82 ms), because a kept diff view rendered twice when it showed. The last commit removed the second render.

What the data supports:

- **Showing the left sidebar** (`⌘B`) takes 20 ms instead of 42 ms at the median frame. Script time falls by more than half, because the history, the changed-file tree, and the workspace list stay mounted.
- **Workspace switches** are 3 to 19 ms faster at the median frame, with 18 to 35% less script time. Long animation frames (over 50 ms) occurred in 43 of 56 switch samples before and in 9 of 56 after.
- **The Commit tab and the Changes tab** open 5 to 10 ms sooner. The review around them no longer renders the Commit tab, the full file view, or each diff header again.
- **React work** falls on the interactions that render the review: 14 to 60% fewer components. Script time is lower or equal in 32 of 33 rows; ctrl-tab-open is 0.4 ms higher. Two rows count more components after (ctrl-tab-open and files-sidebar-open-for-tree), because more commits fell into their counting window; their frame times do not change.

What the data does not support:

- The palette, the pickers, zen mode, and the files sidebar do not change by more than the noise. Their cost is the dialog or tree itself, plus style and paint.
- Some busy values are higher after the change (for example, changed-file-click and tree-row-click). In these rows the script time is equal or lower, and the extra time is in garbage collection and untraced task time. A pair of traced runs at lower load (about 12) showed tree-row-click at 73.4 ms busy and 29.6 ms script before, and 61.0 ms busy and 22.8 ms script after, with equal style time. Treat busy differences under 20 ms as noise at this load.

## Causes and changes

1. **A shown workspace built its diffs again.** React's `<Activity>` detaches refs when it hides a workspace. Pierre's React `CodeView` destroyed its view on a detached ref, so each show created a view, measured it with forced layout, and rendered all visible rows again. `tools/pierre-keep-alive.ts` patches Pierre 1.4.3 at build time, with a version check like `tools/pierre-highlighter.ts`. The wrapper keeps the view while its element stays in the document and frees it when React removes the element, before a replacement attaches. The view skips range and resize work while it has no box, and renders once when its resize observer reports the new size. A browser test checks that a review's `diffs-container` elements are the same after a switch away and back; the test fails without the patch.
2. **The review rendered every panel for unrelated state.** Opening the palette or switching a tab rendered the history, both file trees, the full file view, the mounted Commit tab, and Pierre's diff stream. Pierre's slot renderer then rendered every file header and comment again, because the renderers were new functions. These panels are now memoized, and `App` passes stable handlers and renderers (`useCallback` and `useMemo`). The file list's `refresh` is stable too.
3. **`⌘B` unmounted the left sidebar.** Each show built the history graph, the changed-file tree, and the workspace list again. The sidebar now stays mounted after its first show and hides with `display: none`, as the files sidebar does. The history list ignores the zero size that its resize observer reports while hidden, so it keeps its rows.

## Findings not changed

- **The first switch to a workspace that was mounted while hidden** costs about twice a later switch. In two runs per build, it took 83 to 86 ms after (later switches 35 to 50 ms) and 95 to 102 ms before (later switches 48 to 82 ms). A hidden tree does not subscribe to its stores, because `useSyncExternalStore` subscribes in an effect. The tree renders its loaded review only when it shows. The benchmark tables do not include this switch, because the warm round absorbs it.
- **Tooltip roots.** Each `ToolButton` mounts a Base UI `Tooltip.Root` and trigger. A file open renders about 70 of them. In a profile of eight workspace switches, the Base UI tooltip and floating hooks were the largest component cost.
- **Style, layout, and paint of the shown workspace.** Activity hides with `display: none`, so a shown workspace lays out about 1,700 objects again. Style, layout, and paint are 35 to 55 ms of busy time per switch in these traces.
- **Selection scroll on show.** The effect that scrolls the selected file into view runs again on each show and forces layout through Pierre's `getScrollTop`. In these traces the forced layout replaces the frame's own layout, so removing it would not save time.

## Method

`scripts/benchmark-interactions.mjs` drives headless Chromium through Playwright and reads Chrome traces through CDP. It does not use screenshots or the desktop browser pane, whose animation frames are throttled.

- **Machine.** Apple M1 Pro, 8 cores, 16 GiB, Node 25.3, headless Chromium 153 at 1440 × 1000.
- **Fixture.** A temporary local clone of this repository at `3f99788c`. The working changes are the last ten commits of `apps/med`, reversed (46 files). Three linked worktrees sit at `3f99788c~5`, `~20`, and `~40`; each has the last three commits of `apps/med` reversed. The page starts with four workspaces: the checkout and the three worktrees. The host runs with a temporary state directory and home folder. Git hooks are off.
- **Builds.** Before: `git archive main:apps/med` at `3b79b02c`, built with the same `node_modules`. After: `bun run build` at `71638a1c`.
- **Sequence.** The groups run in this order: left sidebar (hide, show), files sidebar (show, hide), zen (on, off), changed-file click and back, palette (open, close), file picker, branch picker, Commit tab (open, close), `⌘2` and `⌘1`, workspace-row click and back, `⌃Tab` (open, release, back), files tree (open sidebar, click a row, click another row, Changes tab, file tab, Changes tab, close sidebar), and history (click a commit, click another commit, click working changes). Each group has one unmeasured warm round, then seven timed rounds, one counting round, and three traced rounds.
- **Frame.** From the trusted input event's `timeStamp` to a task posted from the next animation frame. That task runs after the frame's style, layout, and paint.
- **Busy and script.** Self time on the renderer main thread from arming to settling (eight frames under 24 ms), from the traced rounds. Script is the JavaScript part; the rest is style, layout, paint, garbage collection, and other tasks.
- **Components.** Function components that rendered in the counting round, from a React DevTools hook stub. One sample per run.
- **Runs.** Two runs per build, interleaved: before, after, before, after. The table pools both runs: 14 timed and 6 traced samples per interaction and build.

## Limits

- Frame times are quantized to display frames of 16.7 ms. A frame difference smaller than one frame is not a result; use script time for small changes.
- The machine was shared and under load during the runs in the table. See the load averages above.
- Busy includes the harness's own polling: about 1 ms in each of the eight or more settle frames. Both builds pay it.
- Headless Chromium has no GPU raster or display latency. The numbers are application response plus frame scheduling, not key-to-photon latency.
- The fixture is one medium review (46 files). Larger reviews have more diff and history rows; most costs here grow with them.
- History-working-click waits for the host to compute the working diff. Its ready time (about 1 s) is host work and is not compared.

## Tests

- `tests/browser/workspaces.test.tsx`: the shown review keeps its rendered `diffs-container` elements after a switch away and back.
- `tests/browser/app.test.tsx`: `⌘B` hides and shows the sidebar, and its panels are the same elements after the show.
- After a merge of `main` at `c9233198`, the browser (190 tests), integration (136 passed, 6 skipped), and unit (324) projects pass. Two browser tests failed in earlier runs at load averages above 12 and failed on `main` at the same load: the history tooltip scan timing and the Mermaid diagram in the brief. They passed in the final run.

## Reproduce

```sh
bun run build
node scripts/benchmark-interactions.mjs --runs 7 --trace --out /tmp/after.json
# Before: build main's apps/med in a separate folder, then:
node scripts/benchmark-interactions.mjs --cli <before>/dist/cli.js --runs 7 --trace --out /tmp/before.json
```

`--only a,b` runs the groups that contain the named interactions. `--trace-out` saves the raw Chrome trace.
