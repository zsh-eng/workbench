# Med architecture and performance review

Status: exploration, 15 October 2026. Base: `18642fb2` (Med 0.4.2 and the
exploration harness). Two proof-of-concept commits follow it on this branch:
`bd3e0bf4` (thread store) and `f01b717e` (route table). The
[method](#method) section tells how I measured.

## 1. Verdict

Med is fast where its author measured and tuned it. A cold load shows the
thread list in about 170 ms, and `⌘1`–`⌘9` shows a thread in about 30 ms. The
structure does not scale with the product. One React component of 5,553 lines
owns every feature. One host function of 1,712 lines owns every route. Window
state reaches every mounted workspace through contexts, so the cost of one
agent's step grows with the number of threads in view. Memory grows the same
way, with no budget. The data model has a hard wall: the 129th thread fails.
I do not recommend a rewrite. I recommend five structural moves, each small and
measured. Do the two that users feel first: a window store with selectors (the
first proof of concept removes 96% of the renders per agent step) and a thread
index apart from the review captures. Then cut the development cost: a command
registry, feature controllers that empty `App.tsx`, and a route table with
shared contracts (the second proof of concept does this for the Commit tab).

## 2. The current shape

### Code

| Area                     | Lines  | Notes                                                |
| ------------------------ | ------ | ---------------------------------------------------- |
| `src/web`                | 68,271 | 76 components; 10,200 lines are grammars and themes  |
| `src/host`               | 13,856 |                                                      |
| `src/shared`             | 6,983  | 4,000 lines are retained Hunk modules                |
| `src/cli`                | 1,863  |                                                      |
| `tests`                  | 23,885 | 63 files, about 660 cases                            |
| `scripts/validate-*.mjs` | 4,004  | 13 end-to-end scripts on the built CLI and a browser |

Four files hold the structure. The commit column counts the 254 commits that
changed `apps/med/src` before the base. Med came into Workbench on 24 September.

| File                            | Lines | Shape                                                                                                                                                                                       | Commits |
| ------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `web/App.tsx`                   | 5,798 | One component of 5,553 lines. 256 hook calls: 61 `useState`, 33 `useEffect`, 4 `useLayoutEffect`, 27 `useRef`, 29 `useMemo`, 77 `useCallback`, 24 custom hooks. It reads 20 context values. | 97      |
| `host/server.ts`                | 2,401 | One `handle()` closure of 1,712 lines: an `if` chain with 54 path patterns and 79 method checks, 41 body parses, 32 `requireRepo` calls.                                                    | 64      |
| `web/components/Workspaces.tsx` | 2,107 | 11 contexts. `WorkspaceHost` is 718 lines with 102 hook calls.                                                                                                                              | 35      |
| `web/data/controller.ts`        | 2,116 | One closure of 1,850 lines: a 25-field snapshot and 33 methods.                                                                                                                             | 27      |

`App.tsx` grew from 2,407 lines (24 September) to 3,746 (7 October) and 5,798
(14 October). `server.ts` grew from 920 to 1,301 and 2,401 lines.

### Runtime

Demo world, production build, headless Chromium at 1440 × 900 and 2×. Each
extra thread is a copy of the station-search session, ten times as long.
Medians of five runs, or of the nine `⌘` keys.

| Measure                                              | 4 threads        | 13 threads       | 29 threads       |
| ---------------------------------------------------- | ---------------- | ---------------- | ---------------- |
| Cold load to the thread list (empty HTTP cache)      | 169 ms           | 162 ms           |                  |
| Reload to the thread list (cached assets)            | 79 ms            | 80 ms            |                  |
| Cold load of `/review/<id>` to a ready thread        | 256 ms           | 259 ms           |                  |
| `⌘` switch: first visit / revisit                    | 25–40 / 28–34 ms | 28–31 / 29–30 ms | 32–44 / 39–42 ms |
| JS heap after the idle preload                       | 21 MiB           | 47.5 MiB         | 93 MiB           |
| DOM nodes / event listeners                          | 8.8k / 2.9k      | 30k / 10k        | 67k / 24.5k      |
| Web workers                                          | 9                |                  | 34               |
| Script time of 3 agent steps in another thread, base | 80 ms            | 175 ms           | 318 ms           |
| The same with the thread store (`bd3e0bf4`)          |                  | 14 ms            | 42 ms            |
| Host CPU in 30 idle seconds, one window              | 190–310 ms       |                  |                  |

The entry chunk and its static imports are 24 chunks: 1,916 KiB, or 584 KiB
gzipped. Pierre Diffs is 331 KiB of it, React DOM 203 KiB, Base UI 198 KiB,
Pierre Trees 151 KiB, Zod 89 KiB, and `App.tsx` 84 KiB. A cold load runs
240 ms of script, with one long task of 53 ms. All JavaScript is 313 chunks,
10.5 MiB (3.0 MiB gzipped); lazy Mermaid layouts are most of it. For a
local host this is acceptable. It is not in the top five.

### Renders

An unminified build and a React DevTools hook count each component whose
props or hook state changed in a commit (13 threads).

| Interaction                           | `App` renders, base → store | All component renders, base → store |
| ------------------------------------- | --------------------------- | ----------------------------------- |
| 3 agent steps in another thread       | 42 → 0                      | 10,176 → 390                        |
| Pointer rests on 5 thread rows        | 40 → 0                      | 10,096 → 520                        |
| Two `⌘` switches                      | 35 → 14                     | 8,975 → 3,942                       |
| Type 20 characters in the message box | 0 → 0                       | 303 → 303                           |
| Open the Changes tab                  | 1 → 1                       | 518 → 518                           |

### Tests

| Project                             | Files | Cases | Lines  |
| ----------------------------------- | ----- | ----- | ------ |
| unit (`tests/data`, `tests/review`) | 25    | 292   | 5,793  |
| host and integration                | 26    | 156   | 7,906  |
| browser (Vitest with Playwright)    | 12    | 212   | 10,186 |

Measured files: `workspaces.test.tsx` 11 tests in 13.7 s, `session.test.tsx`
23 in 11.8 s, `commit-flow.test.ts` 3 in 2.8 s, `git-actions.test.ts` 6 in
4.0 s, `threads.test.ts` 2 in 8.6 s. The first browser run after
`bun install` failed one test on a Vite dependency reload, a known flake.
`app.test.tsx` has 70 tests in 3,550 lines. Its `mountApp` is 632 lines, with
24 options and a fake host of about 33 routes.

## 3. The top five problems

### 1. `App.tsx` owns every feature

**Evidence.** One component holds the pickers (12 states), find (3), notes and
selection (6), the guide and the brief (9), the session pane, the Commit tab,
blame, Zen mode, and toasts. Its keydown effect is 310 lines with 40
dependencies, such as the selection and the find text; it subscribes again
when one changes. The page has 25 keydown
listeners in 15 files. `data/shortcut-guide.ts` (422 lines) says: keep it in
step with App's keydown handler, by hand. 97 of the last 254 commits touch
`App.tsx`; it grew 2.4 times in three weeks.

**Cost.** Parallel agents edit the same file, so their branches conflict.
Tonight seven experiments run at once. A feature cannot be tested alone: each
App test mounts everything behind a 632-line fake host. Every state change
runs 256 hooks and the whole review tree.

**Fix.** Feature controllers. A feature owns an external store, its commands,
and its view. `ReviewController`, `fileWorkspace`, and the pane tree already
work this way. `App` becomes a layout that places panes. One command registry
(ID, keys, context, run) feeds the key handler, the palette, and the guide.

### 2. Window state reaches every mounted workspace

**Evidence.** The render table above. A cause count on each `App` render
gave two causes. First, every `App` read the thread list context: for its own
agent state and for `@` mentions. Second, each thread loaded ahead got a new
workspace object on each list update, switch, or pointer rest, and `Entry`
passed it to its `App`. The thread list changes each time any transcript
changes, read every 1.5 s. Each mounted `App` costs about 3.5 ms of script per
change. With 29 threads, one agent step cost 106 ms per window.

**Cost.** Wasted CPU and battery while any agent works, and a cost that grows
with each thread. No long task appeared, because React slices the work. But
the main thread is busy when you type or switch.

**Fix.** One window store with selector hooks. Contexts carry only stable store
handles. `bd3e0bf4` does this for the thread list and keeps warm workspace
objects stable: 0 `App` renders per agent step or pointer rest. Next, move
the other window contexts (`Snapshot`, `Warm`, `PullErrors`, `ShellContext`)
behind the same store.

### 3. Memory grows with every thread in view, with no budget

**Evidence.** A thread in view is one that works, waits, or changed in the
last three days. Their number has no limit, and the sidebar's height does not
limit it. Each one stays mounted in `<Activity>`: about 2.9 MiB of heap, 2,350
DOM nodes, 860 listeners, and one patch-parser worker (`workers/client.ts`
keeps one worker for each workspace). At 29 threads: 93 MiB heap, 67k nodes,
24.5k listeners, 34 workers. Real threads are larger: the architecture guide
gives 5 MB of heap and 15 MB of renderer memory each.

**Cost.** By the guide's figures, 30 real threads take 150 MB of heap and
450 MB of renderer memory in one window. Each mounted tree also adds style and
layout work. The `⌘` switch median rose from about 30 ms at 13 threads to
about 40 ms at 29 threads (noisy).

**Fix.** Keep the "open tabs stay loaded" model, with a budget. Mount at most
N threads (start with 12): working and waiting threads first, then by last
shown. A thread over the budget keeps its data (session store, scroll place,
review cache) and drops its DOM. Use one patch-parse pool of two workers, with
"latest only" kept for each workspace.

### 4. The host is one `if` chain, and the API contract exists three times

**Evidence.** `handle()` tests 54 path patterns in order. Order is behaviour:
routes before `/api/windows` skip the bounded request section, and routes after
it take a slot. `shared/protocol.ts` declares TypeScript interfaces.
`web/data/api.ts` declares 20 Zod schemas for the same shapes again (for
example `Session` and `sessionSchema`). `shared` has two different schemas
named `fileChangesSchema`. 20 web files write `/api/...` strings by hand (57
paths). Test fakes write the routes a third time: about 33 in `mountApp` and
30 in `workspaces.test.tsx`.

**Cost.** 64 of 254 commits touch `server.ts`. A renamed field compiles on
both sides and fails at run time with "The server returned an invalid
response". Fakes drift from the host.

**Fix.** A route table with shared contracts. A contract names the method,
path, input schema, and output schema. The host parses the input, and the
type checker holds the handler's answer to the output schema. The browser
calls `api.call(route, input)`. `f01b717e` moves the Commit tab's five routes
to this form.

### 5. Saved reviews are the thread database, with a hard cap and no delete

**Evidence.** `saved-reviews.ts` refuses a new record after 128 files
(`MAX_REVIEWS`). Archived threads count. No route or command deletes one. On
the demo world with 128 records, `med review create` failed: "Saved reviews
reached the limit of 128 reviews". `POST /api/threads` uses the same write
path. Each write also reads the size of every record. The thread list reads
the directory and the file status of each record every 1.5 s, for each
window. Each record holds its captures: patch, sources, and images, up to
64 MiB.

**Cost.** At ten threads a day, a user reaches the wall in about two weeks.
Then new threads and agent hand-offs fail. The polling cost is small today
(about 1% of a core at 128 records).

**Fix.** Keep a thread index apart from the captures: one small file, or
SQLite as the vaults use. Archive moves the captures to cold storage or prunes
them by a rule. Add Delete to the thread menu and the CLI. Limit bytes of live
captures, not the count of threads. Let one watcher push thread changes to all
windows.

## 4. Target architecture

```text
Browser
  Window store ─ workspaces, threads, shell, mount budget; selector hooks
  Command registry ─ ID, keys, context, run; key handler, palette, guide read it
  Per workspace: controllers with external stores
    Review (exists) · Files (exists) · Panes (exists) · Session · Notes and guide
    · Find · Pickers · Commit
  Views ─ thin components; App only places panes (target < 1,500 lines)
  Live client ─ one WebSocket, typed channels, one reconnect rule
  Workers ─ patch pool (2) · Pierre pool (≤ 3) · Markdown (1) · editor and Vim
            search on demand
Shared
  contracts/ ─ one Zod schema for each route's input and output
Host
  Route table ─ contract → handler in a feature module
  Services ─ repositories · review captures · thread index · sessions · vaults · search
  Event bus ─ watchers publish; live channels subscribe; no polling for each stream
```

**Ownership.** A controller owns its state, its requests, and its cleanup. A
view reads it with a selector. No controller reads another's internals; the
window store connects them.

**Caching rules.** Today Med has at least 12 caches, each with its own rule:
review 24 MiB and source 8 MiB in each controller, 12 kept sessions, 200
Markdown results, 80 Pierre ASTs, 10-second warm reads, and blame chunks in
the page; review 64 MiB, source 32 MiB, saved records 64 MiB, transcript
followers, and pull requests on the host.

1. Content named by a Git object ID is immutable. Cache it within a byte budget.
2. Mutable content uses an identity key (revision, or size and modification
   time). An event removes it; a timer does not.
3. Each cache has one owner, a byte budget, and a dispose path. List them all
   in one table in `ARCHITECTURE.md`.

### Migration path

Each step lands alone and keeps behaviour. "Measure" says what proves it.

| Step | Change                                                                                                               | Measure                                                                                       |
| ---- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 0    | Land `bd3e0bf4` (thread store).                                                                                      | Render table above; done.                                                                     |
| 1    | Add render and memory budgets to `scripts/explorations`: count renders per agent step, heap and nodes per thread.    | Fail when an agent step renders an `App` that does not show that thread.                      |
| 2    | Window store for `Snapshot`, `Warm`, `PullErrors`, and the shell.                                                    | At most 4 `App` renders per `⌘` switch (now 7); switch time does not change.                  |
| 3    | Command registry; generate the shortcut guide from it.                                                               | Keydown listeners 25 → 5 or fewer; `app.test.tsx` key tests pass without change.              |
| 4    | Extract controllers from `App`, one per change: pickers, find, Commit, guide and notes, session pane.                | `App.tsx` lines and hook calls fall each time; a feature's tests mount only its view.         |
| 5    | Route table for the other host routes, one group per change: git, browse, saved reviews, sessions, threads, service. | `handle()` below 200 lines; each route has one contract and one client call.                  |
| 6    | Web client and test fakes use the contracts; remove the web schemas.                                                 | Web `z.object` count about 40 → 0; `mountApp` lines fall.                                     |
| 7    | One live client with typed channels; `/api/windows` becomes a channel.                                               | Stream code lines; one reconnect test covers all channels.                                    |
| 8    | Thread index apart from captures; Delete; pushed thread changes.                                                     | 500 threads in a scratch state: create time and idle host CPU stay flat.                      |
| 9    | Mount budget and a shared patch pool.                                                                                | At 29 threads: heap < 50 MiB, nodes < 30k, workers ≤ 8; `⌘` to a thread over budget < 100 ms. |

## 5. What I would remove

| Item                                               | Evidence                                                                                                                                                                                                                                      | Action                                                          |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Two of the three live transports                   | One event stream goes three ways: a WebSocket channel, an event-stream channel (`POST /api/live/:id` and `ChannelResponse`), and a direct stream when a test or demo gives its own fetch. Seven consumers each keep their own reconnect loop. | Keep the WebSocket; give tests the same path.                   |
| The `/api/windows` Web Lock and `BroadcastChannel` | The code says one window holds the stream so that each window keeps one of the six connections. A WebSocket takes none of the six. `localStorage` already names the window used last.                                                         | Make it a live channel that each window reads.                  |
| Response schemas in `web/data/api.ts`              | 20 schemas repeat `shared/protocol.ts`. `historySchema` has no user.                                                                                                                                                                          | Derive from the shared contracts (step 6).                      |
| The hand-kept shortcut guide                       | 422 lines that must mirror 25 listeners by hand.                                                                                                                                                                                              | Generate it from the command registry.                          |
| The Elements page in the product bundle            | 5,771 lines (6% of `src`) and a 143 KB chunk: a design gallery and session replays.                                                                                                                                                           | Keep the page; build it from a development entry only.          |
| Pointer-rest prefetch for threads in view          | Threads in view mount and settle when the browser is idle. First visits and revisits match (31 and 30 ms at 13 threads) without a pointer. Before `bd3e0bf4`, five pointer rests rendered 40 `App`s.                                          | Keep it for threads out of view; measure, then remove the rest. |
| One patch worker for each workspace                | 29 threads gave 34 workers.                                                                                                                                                                                                                   | A shared pool (step 9).                                         |
| Rare code in the entry chunk                       | `SourcesPage` imports `displayPath` from `Welcome` (23 KB); `App` and `SavedReviewHeader` import `PullRequestComments` (96 KB) at once.                                                                                                       | Move `displayPath`; load pull request comments on demand.       |
| Dead exports                                       | 17 exports have no reference anywhere, such as `readTranscriptTail`, `useHostFetch`, `WorkspaceStore`, and `historySchema`.                                                                                                                   | Remove them in one change.                                      |

## 6. Risks and open questions

- **How many saved reviews do you have now?** Run
  `ls ~/.local/state/med/reviews | wc -l`. Near 128, problem 5 is urgent.
- **The budget changes a decision.** `5bacd8f2` keeps every thread in view
  loaded, as a terminal keeps tabs. A budget makes the first switch to an old
  thread slower. What memory is acceptable for 30 threads in one window?
- **Conflicts with tonight's work.** The experiments edit `App.tsx` and
  `Workspaces.tsx`. Extract controllers after you choose which experiments
  stay. The thread store commit is small, but it touches `Workspaces.tsx`.
- **Behaviour changes in the proofs of concept.** With the store, the `@`
  list reads the threads at each keystroke; it does not change while you only
  look at it. With the route table, a GET with an empty `repo=` now fails the
  schema (400 `invalid-request`) instead of the registry check, and paths are
  limited to 4,096 characters.
- **The demo world is small.** Real sessions are longer, so absolute numbers
  are larger; the ratios should hold. Other agents ran on the machine (load
  2.6 to 4.6 on 8 cores), so timings vary by about 10 ms.
- **Headless Chromium is not the installed app.** It runs at 60 Hz, in a
  normal window. Render counts are counts, not time.
- **Seen, not explained.** Opening a working-changes thread requested
  `GET /api/git/targets` four times.
- **Not run.** I did not run the full suites (shared machine). I ran the type
  check, lint, and format; the workspaces (11), session (23), and App `@`
  mention (1) browser tests; and the host `host` (23), commit-flow (3),
  git-actions (6), and threads (2) tests. All pass. A scratch host and a
  browser also exercised `@` thread mentions and stage and commit in the
  Commit tab.

## Method

- **Bundle.** `bun run build:web`. A script walks the static imports from
  `index.html` and attributes minified bytes to sources with the source maps.
- **Load, switch, memory.** A Playwright script builds the exploration world
  (`scripts/explorations/world.mjs`), starts the built host on port 6461 with
  a scratch state directory, and adds threads. Cold loads use a new browser
  context for each run. Ready means the visible workspace slot has
  `data-review-status="ready"` and nothing visible with `data-pending`. A
  switch runs from the `keydown` time stamp to the frame after the new slot
  shows with nothing pending. Memory is CDP `Performance.getMetrics` after a
  forced garbage collection and 20 s of idle preload.
- **Agent cost.** `world.advance()` appends steps to the glossary transcript.
  CDP script time is compared over 9 s with and without three steps.
- **Renders.** A DevTools hook in an unminified build compares each function
  component's props and hook list with the last commit. The `App` causes come
  from its context dependencies and state hooks.
- **Host.** `ps` CPU time of the host over 30 idle seconds, and a
  `--cpu-prof` profile cut to that window.
