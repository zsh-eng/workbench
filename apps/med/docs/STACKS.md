# Stacks and sets: one thread, many reviews

Status: design record, October 2026. Steps 1–3 are built; [deferred](#deferred)
lists the rest. [Agent workspaces](AGENT_WORKSPACES.md) describes threads and
sessions.

**A thread is one intent; reviews are its parts.** An agent that reviews four
stacked pull requests makes one thread with four parts, not four workspaces.

| Shape    | Parts                                   | A part's diff                                     |
| -------- | --------------------------------------- | ------------------------------------------------- |
| Stack    | Ordered layers; the first is the bottom | Against the layer below (the bottom: its base)    |
| Set      | Independent parts, in any order         | Against its own base                              |
| Attempts | Alternatives; keep one                  | Each attempt's worktree against the shared commit |

Attempts stay as they are: a group of threads (`group` on each saved review,
[Attempts](USAGE.md#attempts)). An attempt is a live agent with its own session,
worktree, and live Changes; Med's thread is one lead session and one checkout,
and the sidebar state, recap, message box, and auto-close are per thread. A
stack's or a set's parts are frozen hand-offs of one session. Folding attempts
into parts needs a thread with several lead sessions, which is a larger change
than this one and would put Keep, Undo, and the Attempts page at risk. The
sidebar draws both the same way (one row, its parts under it), and the shape
names leave room for `attempts` later.

## Data model

A thread is a saved review (`src/shared/saved-review.ts`). Three optional
fields carry the parts; the record stays `version: 1`.

```ts
saved.parts = {
  shape: "stack" | "set",
  // The current version's parts, in order. A stack's first part is its bottom.
  items: [{ id: "l_…", key, title, pullRequestUrl?, pullRequestTitle?,
            state?: "open" | "draft" | "merged" | "closed", base?, head? }],
};
target.part = "l_…";                 // the part that this comparison is
iteration.guides = { "l_…": guide }; // each part's Guide in that version
```

- A part's **target** is its comparison in a version (base..head), with its
  captured sources and its comments, as any target. Its **viewed** marks are
  the review's (`data/viewed.ts`): they belong to file content, so a file that
  two layers show with the same blob is viewed in both, and "Whole stack" shows
  the top layer's blobs.
- A part's **key** (its PR URL or branch) matches it across versions. Each
  key also maps to the thread in `.keys.json`, so `med review create --key
<part key>` adds a version of the thread that replaces only that part.
- A new version recaptures every part. A part whose base and head did not
  change keeps its target, so its comments and viewed marks stay.
- `describe()` adds `partTotals` (files, +/−, comments) from the current
  version; the thread list sends them with each part.

**Migration.** Nothing on disk changes. A record without `parts` is a
single review, as before. A thread becomes a stack only when the agent or the
reader makes it one; Med then gives it iterations if it had none (as a second
hand-off does) and moves its guide to the first part. An older Med reads such
a record (Zod drops unknown keys) and shows its targets as one version with
several comparisons; if it writes the record, the parts and their guides are
lost, but no comparison or comment is.

## Agents create one thread

- `med review create --stack <pr|branch>…` and `--set <pr|branch>…` take
  pull request numbers, URLs, or branches, bottom first. A pull request reads
  its title, branches, commits, and state with `gh pr view`; a missing head is
  fetched as `refs/pull/<n>/head`, never checked out. A layer of a pull request
  is the pull request's own diff (merge base with its base commit); a layer of
  a branch is the branch since the layer below, and the bottom since `--base`
  (default: the repository's base branch). `--guide` takes a JSON array, one
  guide or `null` for each part.
- The Med skill tells agents to make one stack for related pull requests.
- **Detection: automatic, with Undo.** A hand-off of one range joins an open
  thread when its base commit is the head of that thread's top layer (or its
  head is the bottom layer's base), in the same repository, and either the
  same agent session made both or both are pull requests. It then becomes a
  layer of that thread, not a new tab, and the CLI prints "Added layer 3 to
  …". The rule needs commits, not names, so it works for branches without
  GitHub and for `med pr checkout`. Why not offer "These 4 form a stack: group
  them?": the offer would come after four tabs had opened, which is the clutter
  that this removes, and the evidence (a commit chain from one session, or
  GitHub's own base) is strong. **Ungroup** undoes it.
- **Manual grouping.** Drag a row onto the middle of another row of the same
  repository and hold for half a second (the row is outlined) to stack it on
  top, so a quick drop still reorders; the row's menu has **Stack on ▸** and
  **Ungroup**, and **Treat as a set** / **Treat as a stack**. Grouping moves the
  dragged thread's current comparisons, with their comments and guide, its pull
  request, key, and sessions; what stays (its brief, pins, and older versions)
  goes to history with it. Ungroup makes each part above the first a thread
  again, with its comparison and comments.

## Diff semantics

| Mode               | Comparison                                   | Comments go to                       |
| ------------------ | -------------------------------------------- | ------------------------------------ |
| This layer         | The part's saved target                      | That target                          |
| Whole stack        | `range(bottom.base, top.head)`, live objects | A commented comparison of the thread |
| Layers i–j (range) | `range(layer i base, layer j head)`          | The same                             |

Bases and heads are object IDs, so the live modes are immutable: the host and
the browser cache them, and they read no checkout. All layers of a stack use
the thread's one checkout; a switch loads a saved target and keeps the
session, files, and Git state (`loadSavedTarget`). A set has only "This part".

## UI states

- **Sidebar.** The thread's row has a progress strip, one segment per part,
  bottom first: unreviewed (outline), in progress (some files viewed, or a
  comment), approved (all files viewed, no comments), changes requested (all
  files viewed, with comments). The Review writes each layer's viewed and file
  counts to `med:layers:v1:<review>` in local storage, so the strip reads no
  diff. The chevron shows the parts, top first, numbered, with +/−. A merged
  or closed layer's segment is dim.
- **Stack rail.** At the top of the Review's rail: the layers top to bottom, the
  base branch (`main`) at the bottom, each with its number, title, state, and
  +/−. Shift-click picks a range. **This layer** and **Whole stack** sit above.
  A narrow pane, where the rail hides, has a layer menu in the review's row.
- **Keys.** `⌥↑` and `⌥↓` go up and down the stack. **Next unreviewed** (button
  and `⌘K`) goes to the lowest layer that has no verdict (approved or changes
  requested) and is not merged or closed.
- **Top bar.** The current layer's pull request, through `PullRequestTitle`.

## Critique

- **Migration safety.** No field is required, no record is rewritten, and a
  parse failure still keeps the file (`saved-review-corrupt`). Grouping and
  ungrouping run in the store's write lock and write the target record before
  the source; a crash between the two can leave a comparison in both, never in
  neither.
- **Merged or closed layers.** They stay in the rail with their state; their
  captures stay readable. Next unreviewed skips them. The whole stack still
  starts at the bottom layer's base.
- **A retargeted base.** A pull request whose base is no longer the layer
  below (such as `main` after the layer below merged) is diffed against its own
  base, as GitHub does, and the rail marks it "on main". Detection by commits
  does not join it to the old chain.
- **Huge stacks (10+).** The rail scrolls; the strip keeps segments of at least
  3 px and counts the rest. The browser reads ahead only the layers next to the
  shown one, so its 24 MB cache holds the neighbours that `⌥↑`/`⌥↓` reach.
- **Non-GitHub branches.** `--stack a b c` needs only Git; titles are branch
  names. Detection works on commits.
- **Perf budget.** A switch is a cached saved target in the same checkout:
  no request and no Git. `budget.mjs` measures `⌥↑`/`⌥↓` in a four-layer stack
  (`layerSwitch`, 50 ms p95).

## Deferred

- Comments that follow code across layers, and viewed marks through a restack
  (a layer whose commits changed is a new target).
- GitHub review threads and state per layer: the top bar shows the stored title
  and state; comments still read the thread's own pull request.
- Reordering parts by drag inside a thread; attempts as a shape.
