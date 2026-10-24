# Med: statecharts

Status, 24 October 2026: TLC checked each model, and each chart comes from
TLC's state graph. Bugs 1, 2, 4, 5 and 6 are fixed, and each fix has a
behavioural test that failed before it. Bug 3 is not fixed: it needs a
decision (see [Open questions](#open-questions)).

## What is modelled, and why

Three flows can lose or corrupt the reader's work, so they are modelled:

| Model              | What it holds                                                                                                                                     | Harm when it is wrong                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `EditorDrafts.tla` | One working file in the editor: its draft, the host's checked save, the workspace that keeps the draft, and another program that writes the file. | Lost text. A save that replaces another program's change. |
| `CommitTab.tla`    | The Commit tab of one checkout: Space, Commit and Commit all, Git's answers, and another program that writes or stages files.                     | A commit that holds other files than the dialog counted.  |
| `SentComments.tla` | One comment, Send to the agent, and an edit while the host sends it.                                                                              | The agent gets old text, and the edit leaves the drafts.  |

These were read in the code, not modelled:

- Request generations and the invalidation of reads. They are guarded and
  tested, and the harm is a stale view, not lost data.
- Panes and layout.
- Saved-review files. They are written atomically under a lock.
- The note write queue. It has race tests.
- The page's outbox. Each message has an ID, and the host sends it once.
- Push. It pushes an exact commit, and the host checks HEAD.

Critique of the choice:

- The models are small: one file with three contents, three file names, one
  comment and one edit. TLC proves the rules only inside those bounds. Each
  bug here needs no more than that.
- The first `EditorDrafts.tla` counted text that the file on disk already
  had as unsaved. A probe run showed a false loss after Refresh. The model now
  owes only text that is not on disk.
- The first model had the editor's notice as a variable that never changed.
  It is now `Banner`, from what the editor shows. A refused save's error
  counts, because it says that the file changed.
- The fix model found a gap in the first fix: a draft that came back, then
  went back to its saved text, showed "Saved" with no notice. Bug 2c is that
  gap, and it is fixed.

## Files

- A bug model (`<Name>.tla`) describes main at d53abaa8, before the fixes.
  A fix model (`fix/<Name>.tla`) describes this branch after the fixes, and
  cites its lines. Paths in the models start at `apps/med/src`.
- Each model has a `.cfg` with its rules and a `.map.mjs` with the reader's
  labels. The fix model uses the same map.
- `<Name>-statechart/` holds what the tool wrote: `chart.mmd` and
  `chart.png`, one `bug-<n>.mmd` and `bug-<n>.png` for each class of bug,
  `stories.md` and `summary.json`. TLC's own output (`tlc/`) is not kept.

## Commands

Copy this folder to a scratch folder outside the repository. In that folder,
run these with pstack's `skills/statechart/scripts/statechart.mjs` (Java and
TLC 1.7.4 from mise):

```sh
node statechart.mjs from-spec EditorDrafts.tla --fixed fix/EditorDrafts.tla --expect-broken SaveKeepsOtherChanges --cover --png --title "Editing a working file"
node statechart.mjs from-spec CommitTab.tla --fixed fix/CommitTab.tla --cover --png --title "Committing on the Commit tab"
node statechart.mjs from-spec SentComments.tla --fixed fix/SentComments.tla --png --title "Sending comments to the agent"
```

The EditorDrafts run reports "Broken but not expected", because the bug
model breaks rules 1 and 2. Copy the outputs back, then run
`bunx oxfmt docs/statecharts` in `apps/med`. Quote counts only from
`summary.json`.

## Results

From each `summary.json`:

| Model        | Model states | Model transitions | Chart states | Chart transitions | Chart status                                                 |
| ------------ | ------------ | ----------------- | ------------ | ----------------- | ------------------------------------------------------------ |
| EditorDrafts | 20474        | 81107             | 31 of 58     | 35 of 280         | 17 work, 29 fixed, 11 still wrong, 1 wrong only with the fix |
| CommitTab    | 3871         | 7848              | 75 of 272    | 78 of 986         | 223 work, 49 fixed, 0 still wrong                            |
| SentComments | 150          | 203               | 14           | 19                | 10 work, 4 fixed, 0 still wrong                              |

- `--cover` draws a path to each state, not each transition.
- Each guard in each model cites a line (`uncited` is empty).
- The 11 states that are still wrong, and the one that is wrong only with the
  fix ("Workspace closed, the draft waits in memory (another program's change
  was replaced)"), break rule 3 only. That is bug 3.

## Rules

| #   | Rule                                                                                                                | Invariant                   | Before            | After             |
| --- | ------------------------------------------------------------------------------------------------------------------- | --------------------------- | ----------------- | ----------------- |
| 1   | Your unsaved text stays until you choose Discard draft.                                                             | `UnsavedTextKept`           | Broken: bug 1     | Holds             |
| 2   | Once Med has caught up, the editor tells you when the file on disk is not the text that it opened or saved.         | `ChangeShown`               | Broken: bug 2     | Holds             |
| 3   | A save never replaces a change that another program made to the file.                                               | `SaveKeepsOtherChanges`     | Broken: bug 3     | Broken (expected) |
| 4   | When no save runs, the dot shows unsaved exactly when your text differs from the file as Med last read or saved it. | `DotTellsTruth`             | Holds             | Holds             |
| 5   | A commit holds exactly the files that the Commit dialog counted when you pressed Commit.                            | `CommitHoldsWhatYouCounted` | Broken: bugs 4, 5 | Holds             |
| 6   | Your commit message stays until a commit with it is made.                                                           | `MessageKept`               | Holds             | Holds             |
| 7   | A comment leaves your drafts only when the agent's message has its newest text.                                     | `SentIsNewest`              | Broken: bug 6     | Holds             |
| 8   | Once the agent's message has a comment's newest text, the comment is not in your drafts.                            | `NewestLeavesDrafts`        | Holds             | Holds             |
| 9   | The thread shows each sent comment as the agent's message has it.                                                   | `ThreadShowsSent`           | Broken: bug 6b    | Holds             |

## Bugs

"Main" lines are at d53abaa8. "Fix" lines are on this branch.

### 1. An unsaved draft closes with its workspace (rule 1)

Chart: [EditorDrafts bug 2](EditorDrafts-statechart/bug-2.png). TLC's path:
open the file, type, close the workspace. TLC found four ways in: close the
workspace; Med unloads a hidden one; and close while a save runs, then the
host refuses the save at its first or its second check.

- **Main:** the drafts live in a store for each `App` (`web/App.tsx:520`).
  The `App` unmounts when its workspace closes
  (`web/data/workspaces.ts:340-345`) or leaves memory past 6 workspaces or
  16 tabs (`web/components/Workspaces.tsx:104`, `:107`, `:1862-1866`). Close
  asks nothing. The page's leave warning goes with the `App`
  (`web/App.tsx:530-539`).
- **Reproduced:** yes. `tests/browser/workspaces.test.tsx`, "an unsaved
  draft outlasts its tab…": after ⌘⌥W, a `beforeunload` did not warn, and
  the reopened file showed the disk's text as "Saved". The unload path is the
  same unmount; the test does not open 7 workspaces.
- **Fix (7965aafe):** a workspace that closes or leaves memory gives its
  unsaved drafts to a store for the window (`web/data/editor-drafts.ts:20-42`,
  `:107-113`, `web/App.tsx:521-524`). The next editor that opens the file
  takes the draft back, with its undo history
  (`web/data/editor-drafts.ts:75-103`). The window warns before the page
  leaves while a kept draft is unsaved (`web/components/Workspaces.tsx:203`,
  `:387-389`, `:2144-2153`, `:2187`). A save on its way still finishes the
  kept draft.

### 2. The editor never says that the file changed on disk (rule 2)

Chart: [EditorDrafts bug 1](EditorDrafts-statechart/bug-1.png). TLC's path:
open the file, another program writes it, Med checks the file.

- **Main:** the editor's messages are the save error, the clipboard, syntax
  and discard ones (`web/components/FileEditor.tsx:806-837`). Only the
  read-only view shows `stale` (`web/components/FullFileView.tsx:546-553`),
  and a working file opens in the editor (`:996-1002`). A dirty draft learns
  of the change only when Save is refused.
- **Reproduced:** yes. `tests/browser/navigation-integration.test.tsx`, "the
  editor says when another program changes its file".
- **Fix (05d0073f, 4ff05501):** the editor shows "The file changed on disk"
  while no save runs and the watch found a change, or the file read again
  differs from the draft's (`web/components/FileEditor.tsx:204-214`,
  `:822-833`). A saved draft offers **Refresh contents**. An unsaved draft
  says that it is kept, and that Save will not replace the file.

**2b. A save's answer hid a change.** TLC's path: save, the host renames,
another program writes, Med checks (stale), then the save's answer sets
`stale` to false (main `web/data/file-workspace.ts:506-515`). Reproduced:
"a change on disk while a save is on its way still shows after the save".
Fix (05d0073f): after it takes the saved file, the workspace reads the disk
again (`web/data/file-workspace.ts:192-194`, `:319-341`, `:531-543`). The
cost is one read for each save.

**2c. A kept draft, undone to its saved text, showed "Saved".** The fix model
found it. Reproduced: the reopen part of the bug 1 test failed when the
check was for unsaved drafts only. Fix (4ff05501): the editor compares any
draft with the file read again.

### 3. A save can replace another program's change (rule 3)

Chart: [EditorDrafts bug 3](EditorDrafts-statechart/bug-3.png). TLC's path:
type, save, the host checks twice, another program writes, the host renames.

- **Main and branch:** `host/repository/browse.ts:452-460` is the last
  check; `parentSafe` and the access check wait (`:461-462`); `rename`
  replaces the file (`:463`). `ARCHITECTURE.md` says so: "Another process can
  still write after the last check."
- **Reproduced:** no. The window is between two system calls, and the code
  has no seam to hold it.
- **Not fixed.** POSIX has no rename that compares first. See
  [Open questions](#open-questions).

### 4. Commit all also commits a file that came after the dialog (rule 5)

Chart: [CommitTab bug 1](CommitTab-statechart/bug-1.png). TLC's path: press
Commit with nothing staged, an agent writes a new file, Med stages, Git
commits a, b and n.

- **Main:** Commit all runs `api.stage(null, true)`
  (`web/components/CommitView.tsx:447-449`), which is `git add --all` with no
  path (`host/repository/commit-flow.ts:252`). The commit sends the key of
  that answer (`CommitView.tsx:453`), so the host's key check
  (`commit-flow.ts:296`) passes.
- **Reproduced:** yes. `tests/browser/commit-view.test.tsx`, "Commit all
  commits the files that its dialog counted…": the commit held a.ts, b.ts
  and n.ts.
- **Fix (e4524038):** Commit all stages the counted paths
  (`web/components/CommitView.tsx:445-446`, `:453`,
  `web/data/commit.ts:75-80`).

### 5. A commit goes on after Git's staged files changed (rule 5)

Charts: [CommitTab bug 3](CommitTab-statechart/bug-3.png) (a stage fails)
and [CommitTab bug 2](CommitTab-statechart/bug-2.png) (another program
stages a file).

- **Main:** the Commit button works while a stage is on its way, and the
  commit waits for it in the queue (`web/components/CommitView.tsx:391-405`).
  A failed stage reads the status again (`:398-400`). The commit then sends
  the key of whatever Git has staged (`:452-453`). The dialog said "Commit 2
  files"; the commit held one. If another program staged a file before Git
  answered your stage, the commit took that file too.
- **Reproduced:** yes, both. `tests/browser/commit-view.test.tsx`, "a stage
  that fails stops the commit…" (the commit held a.ts only), and "a file that
  another program stages while your stage is on its way stops the commit".
- **Fix (e4524038, test 81beec08):** before it commits, the tab compares
  Git's staged files with the counted ones, and stops with "The staged files
  changed since you pressed Commit. Check them, then commit again."
  (`web/components/CommitView.tsx:456-461`). The message stays.

### 6. An edit while Med sends a comment is marked sent (rule 7)

Chart: [SentComments bug 1](SentComments-statechart/bug-1.png).

- **Main:** a comment is sent when a message's `createdAt` is after the
  comment's `updatedAt` (`host/server.ts:1497-1506`). The host reads the
  comment (`:1585-1593`), then waits for the session's process
  (`:1604-1625`), a resume (`:1627-1631`) and the inbox
  (`host/agent-inbox.ts:284-287`). Only then does it stamp `createdAt`
  (`host/agent-inbox.ts:296`). An edit in that wait is older than the
  message. The agent gets the old text, and the edit leaves the drafts.
- **Reproduced:** yes. `tests/host/sent-comments.test.ts` holds the resume
  of a Claude session, edits the comment, then lets the send go on. The
  drafts were empty.
- **Fix (17b0add1):** each message keeps the version of each comment that it
  sent: the thread's newest `updatedAt`, from the same read as the agent's
  text (`host/saved-reviews.ts:1394-1409`, `:1508-1527`, `:1557-1562`,
  `host/server.ts:1595-1609`, `:1654`). A comment is a draft until a message
  holds its version (`host/server.ts:1497-1515`). A message from before this
  change has no versions, and its `createdAt` counts, as before. The new
  field `noteVersions` is optional (`shared/agent-inbox.ts:66`).

**6b. The thread showed other text than the agent got (rule 9).** Chart:
[SentComments bug 2](SentComments-statechart/bug-2.png). The thread's copy
came from the drafts (`host/server.ts:1585-1589`), and the agent's text from
a second read (`:1591-1593`). An edit between the two reads splits them. Not
replayed: there is no seam between the two reads. The same fix makes one
read, and the bug 6 test checks that the thread shows the text that the
agent got.

## What the models leave out

- EditorDrafts: one file and one other write. Reloads: a draft lives in
  memory, and the leave warning asks first. Vault and standalone files, which
  have their own stores and do not keep drafts after their view closes. The
  24-draft limit. Two workspaces on one checkout, which share a kept draft.
  Errors other than a changed file, such as permissions. How watch events
  merge.
- CommitTab: file contents. A stage takes the content on disk, not the diff
  on screen. Partial staging, renames, conflicts, unstage, push, hooks that
  change files, and a second commit.
- SentComments: one comment, one edit and one message. Replies and comments
  on the Notes use the same code. Held messages and `med review wait`, the
  Codex queue, failed delivery, and two windows that send one message. Two
  edits in the same millisecond have one version.

## Open questions

1. **Bug 3, the rename window.** Options: (a) keep it, as `ARCHITECTURE.md`
   says; (b) after the rename, compare the replaced file's metadata, and say
   that another program's write may be lost (it cannot come back); (c) a lock
   file, which other programs do not honour.
2. **A dirty draft and a changed file.** Save is refused, and Refresh is off
   while the draft is unsaved. Options: reload and discard the draft;
   overwrite (save against the new file); or a merge view.
3. **Close a workspace with unsaved drafts.** The fix keeps them for the
   page's life. Options: also ask before the close, or keep drafts across a
   reload.
4. **Commit all after a failed hook** leaves the files staged, unlike
   `git commit -a`. It was so before this branch.
5. **Content drift.** A commit takes the files' content when Git stages
   them, not the diff that the tab showed. Option: send the diff's ID and
   stop when it changed.
6. **Commit all with many files** now sends each path to Git, as a filtered
   Stage all did before. Past the system's argument limit, Git fails, and the
   commit stops with Git's error.
