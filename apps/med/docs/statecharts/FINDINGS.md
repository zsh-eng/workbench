# Med: statecharts

Status, 25 October 2026: TLC checked each model, and each chart comes from
TLC's state graph. Bugs 1, 2 and 4 to 12 are fixed, and each fix has a
behavioural test that failed before it. Bug 3 is narrowed, not fixed: a save
now stops when another program writes during any of its checks, but a write
between the last check and the rename is still lost.

8 November 2026: `AgentQueue.tla` models the queue of messages to an agent
that Med runs. TLC found bugs 13 to 16. Bugs 15 and 16 are fixed, each with
a test that failed before the fix. Bugs 13 and 14 are open: both need the
agent to say which messages it read. `AgentQueue.tla` has no chart yet; TLC
ran it directly.

## What is modelled, and why

Three flows can lose or corrupt the reader's work, so they are modelled:

| Model              | What it holds                                                                                                                                                                                                                                      | Harm when it is wrong                                                                     |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `EditorDrafts.tla` | One working file in the editor: its draft, the host's checked save, the workspace that keeps the draft, the question before a close, Med's own close of a landed tab, a reload, and another writer.                                                | Lost text. A close that hides a draft. A save that replaces another's change.             |
| `CommitTab.tla`    | The Commit tab of one checkout: Space, Commit and Commit all, Git's answers, a hook that stops the commit, and another program that writes or stages files.                                                                                        | A commit that holds other files, or other content, than the tab showed.                   |
| `SentComments.tla` | One comment, Send to the agent, and an edit while the host sends it.                                                                                                                                                                               | The agent gets old text, and the edit leaves the drafts.                                  |
| `AgentQueue.tla`   | One Claude Code session that Med runs, and two messages, each sent now or queued for the turn's end: a turn with one round of tools, Send now, Esc, Stop, the process ending, and a restart of the host, which the process outlives in its holder. | A message lost, given twice, out of order, or in the turn that it was queued to wait for. |

These were read in the code, not modelled:

- Request generations and the invalidation of reads. They are guarded and
  tested, and the harm is a stale view, not lost data.
- Panes and layout.
- Saved-review files. They are written atomically under a lock.
- The note write queue. It has race tests.

[IMPLICIT.md](IMPLICIT.md) lists the other flows whose state is spread over
several flags, and which of them to model next.

- The page's outbox. Each message has an ID, and the host sends it once.
- Push. It pushes an exact commit, and the host checks HEAD.

Critique of the choice:

- The models are small: one file with three contents, three file names, one
  comment and one edit, one reload and one other write. TLC proves the rules
  only inside those bounds. Each bug here needs no more than that.
- The first `EditorDrafts.tla` counted text that the file on disk already
  had as unsaved. A probe run showed a false loss after Refresh. The model now
  owes only text that is not on disk.
- The first model had the editor's notice as a variable that never changed.
  It is now `Banner`, from what the editor shows.
- The fix model found a gap in the first fix: a draft that came back, then
  went back to its saved text, showed "Saved" with no notice (bug 2c).
- `CloseAsks` and `SaveKeepsOtherChanges` read history variables, which stay
  true after the bad step. The chart labels say so ("a workspace closed
  without asking", "another program's change was replaced"), so that a
  later state with that history does not share a label with a clean one.

## Files

- A bug model (`<Name>.tla`) describes main at d53abaa8, before the fixes.
  A fix model (`fix/<Name>.tla`) describes this branch after the fixes, and
  cites its lines. Paths in the models start at `apps/med/src`.
  `AgentQueue.tla` describes this branch at 70f8731c, and its fix model
  3b3bd77f.
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

Each run exits 1 and says "Broken but not expected", because each bug model
breaks rules that its fix model keeps. Copy the outputs back, then run
`bunx oxfmt docs/statecharts` in `apps/med`. Quote counts only from
`summary.json`.

`AgentQueue.tla` ran in TLC alone, one rule at a time, in a scratch copy of
this folder (Java from mise):

```sh
java -jar tla2tools.jar -config AgentQueue.cfg -workers 6 -deadlock AgentQueue.tla
```

Its `.cfg` sets `Gaps`. `TRUE` lets the host stop between a write to the
agent and the inbox's record of it, Stop or an end of the process leave
lines unread, and Med write to a holder that has gone. `FALSE` leaves those
steps out, and shows what holds apart from bugs 13 and 14. `-deadlock` is
needed: a run that has given both messages has no step left.

## Results

From each `summary.json`, and from TLC's run of each fix model:

| Model        | Bug model states | Bug model transitions | Fix model states | Chart states | Chart transitions | Chart status                                                  |
| ------------ | ---------------- | --------------------- | ---------------- | ------------ | ----------------- | ------------------------------------------------------------- |
| EditorDrafts | 83996            | 405198                | 253112           | 87 of 162    | 95 of 1053        | 17 work, 97 fixed, 19 still wrong, 29 wrong only with the fix |
| CommitTab    | 71283            | 189801                | 33816            | 123 of 602   | 132 of 2790       | 409 work, 193 fixed, 0 still wrong, 0 wrong only with the fix |
| SentComments | 150              | 203                   | 131              | 14           | 19                | 10 work, 4 fixed, 0 still wrong, 0 wrong only with the fix    |

`AgentQueue.tla`, from TLC's runs: one run for each rule that breaks, since
TLC stops at the first broken rule, and one full run for the rules that
hold.

| Model | `Gaps` | Rules broken      | Distinct states of the full run     |
| ----- | ------ | ----------------- | ----------------------------------- |
| Bug   | TRUE   | 13, 14, 16 and 17 | 1,452,828: rule 15 holds            |
| Bug   | FALSE  | 16 and 17         | 354,520: rules 13, 14 and 15 hold   |
| Fix   | TRUE   | 13 and 14         | 1,761,642: rules 15, 16 and 17 hold |
| Fix   | FALSE  | None              | 404,290: all five hold              |

- `--cover` draws a path to each state, not each transition.
- Each guard in each model cites a line (`uncited` is empty).
- The 19 states that are still wrong, and the 29 that are wrong only with
  the fix, all break rule 3 and no other rule. That is bug 3. The 29 are
  states that only the fix has, such as the question before a close or a
  draft that waits in the window after a reload, in which the same rename
  window can still lose another program's write.
- TLC 1.7.4 stopped with an error in reading its own trace file
  (`ArrayIndexOutOfBoundsException`, or `EOFException` in other orders of the
  actions) in two of the tool's one-worker runs: `CloseAsks` in the bug
  model and `SaveKeepsOtherChanges` in the fix model. Runs with more workers
  stop the same way at times. The paths that TLC printed are complete, and
  the charts are still correct: both rules read a history variable that
  stays true, and each label of a state with that history says so. A run of
  the full chart without `--cover` showed each label with "another program's
  change was replaced" as still wrong, wrong only with the fix, or a label of
  the bug model only, and each label with "a workspace closed without
  asking" as fixed.

## Rules

| #   | Rule                                                                                                                                      | Invariant                   | Before            | After             |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ----------------- | ----------------- |
| 1   | Your unsaved text stays until you choose Discard draft.                                                                                   | `UnsavedTextKept`           | Broken: bugs 1, 7 | Holds             |
| 2   | Once Med has caught up, the editor tells you when the file on disk is not the text that it opened or saved.                               | `ChangeShown`               | Broken: bug 2     | Holds             |
| 3   | A save never replaces a change that another program made to the file.                                                                     | `SaveKeepsOtherChanges`     | Broken: bug 3     | Broken (expected) |
| 4   | When no save runs, the dot shows unsaved exactly when your text differs from the file as Med last read or saved it.                       | `DotTellsTruth`             | Holds             | Holds             |
| 5   | Closing a workspace with an unsaved draft asks you first. Med does not close one on its own.                                              | `CloseAsks`                 | Broken: bug 8     | Holds             |
| 6   | A commit holds exactly the files that the Commit dialog counted when you pressed Commit.                                                  | `CommitHoldsWhatYouCounted` | Broken: bugs 4, 5 | Holds             |
| 7   | A commit holds each file as the tab showed it when you pressed Commit.                                                                    | `CommitHoldsWhatYouSaw`     | Broken: bug 11    | Holds             |
| 8   | A Commit all that does not commit leaves nothing staged that was not staged when you pressed Commit, apart from another program's stages. | `CommitAllLeavesTheIndex`   | Broken: bug 10    | Holds             |
| 9   | Your commit message stays until a commit with it is made.                                                                                 | `MessageKept`               | Holds             | Holds             |
| 10  | A comment leaves your drafts only when the agent's message has its newest text.                                                           | `SentIsNewest`              | Broken: bug 6     | Holds             |
| 11  | Once the agent's message has a comment's newest text, the comment is not in your drafts.                                                  | `NewestLeavesDrafts`        | Holds             | Holds             |
| 12  | The thread shows each sent comment as the agent's message has it.                                                                         | `ThreadShowsSent`           | Broken: bug 6b    | Holds             |
| 13  | The agent reads each message at most once.                                                                                                | `Once`                      | Broken: bug 13    | Broken (expected) |
| 14  | A message that the thread shows as delivered reached the agent, or waits in its input.                                                    | `Reaches`                   | Broken: bug 14    | Broken (expected) |
| 15  | Med never gives the agent a message before an earlier one that waits for the same step. Send now on a later message makes it go first.    | `InOrder`                   | Holds             | Holds             |
| 16  | Med does not give a queued message while it shows the turn that ran when the user queued it.                                              | `QueueWaits`                | Broken: bug 15    | Holds             |
| 17  | A message that waits reaches the agent, unless the session stopped or a cut turn waits for the reader.                                    | `Taken`                     | Broken: bug 16    | Holds             |

Bugs 9 and 12 break no modelled rule: bug 9 is a choice that the editor did
not offer, and bug 12 is a limit of the operating system. For rules 13 to 17,
"After" is the fix model with `Gaps = TRUE`; with `Gaps = FALSE` the fix
model keeps all five.

## Bugs

"Main" lines are at d53abaa8. "Fix" lines are at the head of this branch.

### 1. An unsaved draft closes with its workspace (rule 1)

Chart: [EditorDrafts bug 3](EditorDrafts-statechart/bug-3.png). TLC's path:
open the file, type, close the workspace. Other ways in: Med unloads a
hidden workspace, Med closes a landed tab, or a close while a save runs.

- **Main:** the drafts live in a store for each `App` (`web/App.tsx:520`),
  which unmounts when its workspace closes (`web/data/workspaces.ts:340-345`)
  or leaves memory past 6 workspaces or 16 tabs
  (`web/components/Workspaces.tsx:104`, `:107`, `:1862-1866`).
- **Reproduced:** yes, in `tests/browser/workspaces.test.tsx`.
- **Fix (7965aafe, 1e06390a):** a workspace that closes or leaves memory
  gives its unsaved drafts to the window (`web/data/editor-drafts.ts:308-315`,
  `web/App.tsx:525-527`). The next editor that opens the file takes the
  draft back, with its undo history (`web/data/editor-drafts.ts:257-288`).

### 2. The editor never says that the file changed on disk (rule 2)

Chart: [EditorDrafts bug 1](EditorDrafts-statechart/bug-1.png). TLC's path:
open the file, another program writes it, Med checks the file.

- **Main:** the editor's messages are the save error, the clipboard, syntax
  and discard ones (`web/components/FileEditor.tsx:806-837`). Only the
  read-only view shows `stale` (`web/components/FullFileView.tsx:546-553`).
- **Reproduced:** yes. `tests/browser/navigation-integration.test.tsx`, "the
  editor says when another program changes its file".
- **Fix (05d0073f, 4ff05501, 31a0e49f):** the editor says "The file changed
  on disk" while no save runs and the watch found a change, or the file read
  again differs from the draft's (`web/components/FileEditor.tsx:238-252`,
  `:873-900`).

**2b. A save's answer hid a change.** A save's answer set `stale` to false
after a change that came during the save (main
`web/data/file-workspace.ts:506-515`). Fix (05d0073f): the workspace reads
the disk again after each save (`web/data/file-workspace.ts:531-543`).

**2c. A kept draft, undone to its saved text, showed "Saved".** The fix model
found it. Fix (4ff05501): the editor compares any draft with the file read
again.

### 3. A save can replace another program's change (rule 3)

Chart: [EditorDrafts bug 5](EditorDrafts-statechart/bug-5.png). TLC's path:
type, save, the host checks twice, another program writes, the host renames.

- **Main:** the last check reads the file and its metadata
  (`host/repository/browse.ts:451-460`). Then `parentSafe` waits (`:461`),
  and `rename` replaces the file (`:463`). A write during `parentSafe` was
  lost.
- **Reproduced:** yes, for the wait in `parentSafe`.
  `tests/host/browse-save-window.test.ts` writes the file at each folder
  check of a save. Before the fix, the save replaced the write.
- **Narrowed (85c04dbe):** the content and folder checks come first
  (`host/repository/browse.ts:451-453`). The metadata check comes last, and
  now compares the size too: inode, device, size, modification time and
  change time, against the ones from before the save (`:456-464`). Then
  come the access check, which does not wait, and `rename` (`:465-466`). No
  await is between the last check and the rename, but a write in that gap
  is still lost: POSIX has no rename that compares first. No lock file:
  other programs do not honour it.

### 4. Commit all also commits a file that came after the dialog (rule 6)

Chart: [CommitTab bug 2](CommitTab-statechart/bug-2.png). TLC's path: press
Commit, an agent writes a new file, Med stages, Git commits a, b and n.

- **Main:** Commit all ran `git add --all` with no path
  (`host/repository/commit-flow.ts:252`), and sent the key of that answer
  (`web/components/CommitView.tsx:453`), so the host's key check passed.
- **Reproduced:** yes. `tests/browser/commit-view.test.tsx`, "Commit all
  commits the files that its dialog counted…".
- **Fix (e4524038, e9552169):** Commit all sends the counted paths, and the
  host stages only those (`host/repository/commit-flow.ts:333-349`).

### 5. A commit goes on after Git's staged files changed (rule 6)

Charts: [CommitTab bug 5](CommitTab-statechart/bug-5.png) (a stage fails)
and [CommitTab bug 4](CommitTab-statechart/bug-4.png) (another program
stages a file).

- **Main:** the commit waited for a stage on its way, then sent the key of
  whatever Git had staged (`web/components/CommitView.tsx:391-405`,
  `:452-453`).
- **Reproduced:** yes, both, in `tests/browser/commit-view.test.tsx`.
- **Fix (e4524038, e9552169):** the tab compares Git's staged files with the
  counted ones before it commits (`web/components/CommitView.tsx:508-511`),
  and the host compares them again with the files that the tab sent
  (`host/repository/commit-flow.ts:443-455`). Both stop with "The staged
  files changed since you pressed Commit. Check them, then commit again."
  The message stays.

### 6. An edit while Med sends a comment is marked sent (rule 10)

Chart: [SentComments bug 1](SentComments-statechart/bug-1.png).

- **Main:** a comment is sent when a message's `createdAt` is after the
  comment's `updatedAt` (`host/server.ts:1497-1506`). The host stamps
  `createdAt` after it waits for the session's process, a resume and the
  inbox (`host/agent-inbox.ts:296`). An edit in that wait is older than the
  message.
- **Reproduced:** yes. `tests/host/sent-comments.test.ts`.
- **Fix (17b0add1):** each message keeps the version of each comment that it
  sent, from the same read as the agent's text
  (`host/saved-reviews.ts:1394-1409`, `:1508-1527`, `:1557-1562`,
  `host/server.ts:1595-1609`, `:1654`). A comment is a draft until a message
  holds its version (`host/server.ts:1497-1515`).

**6b. The thread showed other text than the agent got (rule 12).** Chart:
[SentComments bug 2](SentComments-statechart/bug-2.png). The thread's copy
and the agent's text came from two reads. The same fix makes one read.

### 7. A reload loses an unsaved draft (rule 1)

Chart: [EditorDrafts bug 4](EditorDrafts-statechart/bug-4.png). TLC's path:
open the file, type, reload the page.

- **Main:** the drafts are in memory only (`web/data/editor-drafts.ts:20`).
  The page asks before it leaves, but after a reload the draft is gone.
- **Reproduced:** yes. `tests/browser/workspaces.test.tsx`, "an unsaved
  draft outlasts a reload, and says when its file changed".
- **Fix (1e06390a):** each unsaved draft is in the browser's local storage
  under its workspace, its repository and its path, 500 ms after typing
  stops (`web/data/editor-drafts.ts:37-39`, `:199-218`). After a reload each
  workspace takes back at most 24 of its drafts, newest first (`:96-116`,
  `:237-241`). A draft that comes back still gets the changed-on-disk notice,
  because it keeps the file that it started from. The page asks before it
  leaves only when storage did not take a draft (`:169-175`,
  `web/components/Workspaces.tsx:564-570`). The undo history does not
  outlast a reload. Unit tests: `tests/data/editor-drafts.test.ts`.
- **Found while fixing:** a workspace with 24 unsaved drafts took a waiting
  draft out of the window and then failed to open it, so the draft was
  lost. The store now makes room before it takes the draft
  (`web/data/editor-drafts.ts:259-263`). Test: "a full workspace leaves a
  draft that waits in the window where it is".

### 8. Closing a workspace with an unsaved draft does not ask (rule 5)

Chart: [EditorDrafts bug 2](EditorDrafts-statechart/bug-2.png). TLC's path:
open the file, type, close the workspace. Med's own close of a landed tab is
another way in.

- **Main:** close checks nothing (`web/components/Workspaces.tsx:608-611`),
  and Med closes a landed tab with no check for drafts (`:1401-1422`).
- **Reproduced:** yes. `tests/browser/workspaces.test.tsx`, "closing a tab
  with an unsaved draft asks first…" and "a tab whose work has landed stays
  open while it has an unsaved draft".
- **Fix (1e06390a, 9b5ea001):** a close that you choose asks "“title” has
  unsaved changes in path. Close it?", with Close and Cancel
  (`web/components/Workspaces.tsx:1160-1183`, `:1224-1233`). The palette's
  close asks too (`web/App.tsx:3663`). Med does not close a landed tab with
  unsaved drafts (`web/components/Workspaces.tsx:1474-1499`). The count
  includes drafts that wait in the window (`web/data/editor-drafts.ts:158-167`).

### 9. An unsaved draft and a changed file: no way to see or choose

Not a rule of the model: rule 2 holds once the notice shows. Before the fix,
Save was refused and Refresh was off while the draft was unsaved.

- **Reproduced:** yes. `tests/browser/navigation-integration.test.tsx`, "a
  draft whose file changed on disk shows the change, then keeps your version
  or takes the file".
- **Fix (31a0e49f):** the editor reads the file and shows a read-only diff
  of the change on disk, with **Keep my version** (save over the file as
  read now) and **Use the file on disk** (discard the draft)
  (`web/components/FileEditor.tsx:171`, `:238-252`, `:426-452`, `:878-886`).
  The fix model has both choices (`KeepMine`, `UseDisk`). Keep my version is
  a checked save against the file as Med read it, so a later write still
  stops it.

### 10. Commit all after a failed hook leaves the files staged (rule 8)

Chart: [CommitTab bug 1](CommitTab-statechart/bug-1.png). TLC's path: press
Commit, Med stages the files, a hook stops the commit.

- **Main:** Commit all staged in the checkout's index, and a stopped commit
  left the files staged. `git commit -a` leaves the index as it was.
- **Reproduced:** yes. `tests/host/commit-flow.test.ts`, "Commit all stages
  in a copy of the index, so a failed hook leaves the index as it was", and
  `tests/browser/commit-view.test.tsx`, "Commit all after a hook fails…".
- **Fix (e9552169):** Commit all copies the index, stages the counted paths
  in the copy, and commits with `GIT_INDEX_FILE` set to the copy
  (`host/repository/commit-flow.ts:338-367`, `:391-412`). After the commit,
  the index takes the committed paths from HEAD (`:383`, `:416-438`). If Git
  holds the index for more than about two seconds, Med says that the commit
  is made and to run `git reset`. The message stays.

### 11. A commit takes content that the tab did not show (rule 7)

Chart: [CommitTab bug 3](CommitTab-statechart/bug-3.png). TLC's path: press
Commit, an agent writes a again, Med stages, Git commits the agent's a.

- **Main:** a commit took each file as Git staged it, not as the tab showed
  it.
- **Reproduced:** yes. `tests/host/commit-flow.test.ts`, "a commit stops
  when a file is not what the tab showed of it", and
  `tests/browser/commit-view.test.tsx`, "a file that an agent changes after
  the tab showed it stops the commit…".
- **Fix (e9552169):** the tab sends what it showed of each file: the blob ID
  on the diff's index line, or, for an untracked file in Commit all, the
  SHA-256 of its text (`web/components/CommitView.tsx:190-225`, `:497-517`).
  The host compares them with Git's staged blobs, or the file's text
  (`host/repository/commit-flow.ts:456-469`), and stops with "A file changed
  after the tab showed it. Check the changes, then commit again." The
  message stays.

### 12. Very many files hit the argument limit

Not modelled.

- **Main:** Stage, unstage and Commit all passed each path on Git's command
  line, and the request body had a 128 KB limit.
- **Reproduced:** yes. `tests/host/commit-flow.test.ts`, "stages and
  unstages more paths than one command line holds": first 413, then
  `E2BIG`.
- **Fix (f47a243f):** paths go to Git on standard input with
  `--pathspec-from-file=- --pathspec-file-nul`
  (`host/repository/commit-flow.ts:258-263`). The stage and commit routes
  take up to 32 MB (`shared/git-actions.ts`, `shared/routes.ts`,
  `host/routes.ts`).

### 13. A host that stops between a delivery and its record gives a message twice (rule 13)

TLC's path: the user sends a message to the idle session, the host stops
before it writes the inbox's file, the agent reads the message, and when the
host is back the page sends it again. Lines are at 70f8731c.

- **Code:** both ways in write the agent's line first, then the inbox's
  file: a queued message (`host/agent-inbox.ts:211`, then `:216-229` and the
  rename at `:62-69`), and one sent to an idle session with the ones that
  waited (`:315`, then `:317-327`). A message sent to an idle session is not
  in the file before that, so when the page sends it again with its ID,
  `once()` (`:240`) does not find it. A queued one stays `pending` in the
  file, and the host gives it again when it starts
  (`host/server.ts:521-522`). `close()` does not wait for the inbox's writes
  (`host/server.ts:3820-3825`).
- **How likely:** the window is one file write and a rename, a few
  milliseconds, and the host has to stop in it: a crash, a kill, or a quit
  while a message goes.
- **Not fixed.** A fix: record a batch as `sending`, with its line's text,
  before the write. When the host starts, look for that line among the
  lines that the holder's log says Med wrote (the `i` entries that
  `host/owned-sessions.ts:805` replays). There, it was delivered; not there,
  it waits again. With no holder left, nothing can say, so it waits, and the
  thread asks the reader.

### 14. A message shows as delivered that the agent never read (rule 14)

TLC's path: the turn ends, the process ends, the host reads the turn's end
but not yet the exit, the user sends a message, and the host writes it to
the holder that has gone.

- **Code:** the inbox marks a message delivered once Med has written its
  line (`host/agent-inbox.ts:227`). Claude Code reads a line written during
  its tools when they end (`host/queued-messages.ts:11-14`). Stop
  (`host/owned-sessions.ts:1103-1107`), or the process ending, before then
  loses it. A line to a holder that has gone is lost without an error
  (`host/held-agent.ts:183`).
- **How likely:** Stop during a long tool call after Send now is the likely
  way in. The thread shows the message as sent, and Claude's transcript has
  no `queued_command` for it.
- **Not fixed.** Med needs to know what the agent read. Two signals:
  Claude Code's `--replay-user-messages`, which echoes each user message
  from its input on its output, or the transcript's `queued_command`
  attachment, which the thread reads already
  (`shared/agent-session-claude.ts:581`). With either, the inbox would keep
  a written message as `written` until the agent reads it, and one still
  `written` when the process ends would wait again. To check first: when
  Claude Code echoes a message that it reads at its tools' end, and what
  Codex (`turn/steer`) and ACP agents confirm.

### 15. A turn that begins meanwhile takes the messages queued for its end (rule 16)

TLC's path, with `Gaps = FALSE`: Send now during the tools, and Esc before
they end, so Claude Code keeps the line for its next turn. The turn's end
makes the release read idle. Before it has the inbox's lock, the agent
starts its next turn with that line, Med shows that turn, and the user
queues a message for its end. The release gives it anyway.

- **Code (70f8731c):** between turns, the release read the state once,
  before it waited for the inbox's lock, and then gave every waiting message
  (`host/queued-messages.ts:44-47`). During a turn it checks again inside
  the lock (`:60-67`, `host/agent-inbox.ts:206`).
- **Reproduced:** yes. `tests/host/queued-messages.test.ts`, "a turn that
  begins while Med gives the waiting messages keeps the ones queued for its
  end".
- **Fix (3b3bd77f):** between turns too, the release checks inside the lock
  that the agent is still idle, with no cut turn
  (`host/queued-messages.ts:48-63`). The change that began the turn asks the
  watcher again, and the turn's rule applies.

### 16. A message queued as a delivery ends waits with no one to give it (rule 17)

TLC's path, with `Gaps = FALSE`, after a restart: the release gives a
message and reads the inbox, which has nothing left. The user queues a
message for the turn's end. Its send calls `watch`, which finds the release
running and asks it to look again. The release then stops the watcher on
what it read, the turn ends, and nothing gives the message.

- **Code (70f8731c):** the release stopped the watcher when its read found
  nothing (`host/queued-messages.ts:69`), and its `finally` looked again
  only while the watcher was there (`:88-93`). The read can miss a message
  whose write lands while the file is read: Node reads a file in several
  steps.
- **Reproduced:** yes. `tests/host/queued-messages.test.ts`, "a message
  queued while a delivery ends still goes when the turn ends". The message
  stayed `pending` while the agent was idle, until another message took it
  along.
- **Fix (3b3bd77f):** a change while a release runs always makes it look
  again; only a release with no change during it, and nothing left, stops
  the watcher (`host/queued-messages.ts:102-114`).

## What the models leave out

- EditorDrafts: one file and one other write. Vault and standalone files,
  which have their own stores. The 24-draft limit, and a browser that
  refuses to store a draft. Two workspaces on one checkout, which share a
  draft that waits. The undo history, which does not outlast a reload.
  Errors other than a changed file, such as permissions. How watch events
  merge. The diff's content.
- EditorDrafts, the host's save: the model has the last check and the rename
  as two steps, and another program can write between them. That is bug 3.
- CommitTab: the host's checks and `git commit` are one step. Another
  program that stages a file between the host's last check and `git commit`
  can still add it to a commit that is not Commit all. Partial staging,
  renames, conflicts, unstage, push, hooks that change files, and a second
  commit. A file that the tab did not show, such as a binary one, has no
  content check.
- SentComments: one comment, one edit and one message. Replies and comments
  on the Notes use the same code. Failed delivery, and two windows that send
  one message. Two edits in the same millisecond have one version.
- AgentQueue: Codex and ACP agents (steering, and no messages during a
  turn). Take back (Edit and Remove), which runs under the same lock.
  Images. The `starting` status. A turn that Claude Code begins on its own.
  More than one round of tools in a turn. Two sessions, and Fork in Med,
  which gives the waiting messages to a fork (`host/server.ts:1600-1606`).
  The holder's log replays in one step. A write that fails other than to a
  holder that has gone. The model assumes that Claude Code keeps a line that
  it has not read when Esc stops the turn, and reads it as its next prompt;
  that is not checked against Claude Code.
- AgentQueue, rule 16: it is about Med's view, which comes after the
  agent's. When a line sent now reaches Claude Code after its tools, or Esc
  stops the turn first, Claude Code starts its next turn with that line. A
  Queue message that Med gives when it reads the old turn's end can then
  join the new turn at its tools' end. The user saw that message wait for
  the turn's end, and it came after it, so the rule allows it. Only the
  agent saying when it takes a line, as for bug 14, would close this.

## Decisions

The open questions of the first pass were settled as follows:

1. **The rename window (bug 3):** kept and documented. The save checks the
   file's metadata just before the rename and stops when it changed. No lock
   files.
2. **An unsaved draft and a changed file (bug 9):** a read-only diff, with
   Keep my version and Use the file on disk. No merge editor.
3. **Closing a workspace with unsaved drafts (bugs 7, 8):** Med asks first,
   keeps drafts across a reload in local storage, keeps the 24-draft limit,
   and a kept draft still says when its file changed.
4. **Commit all after a failed hook (bug 10):** the index stays as it was,
   as with `git commit -a`. The message stays.
5. **Content drift (bug 11):** the commit holds what the tab showed, or
   stops with a message, and the message stays.
6. **Very many files (bug 12):** paths go to Git on standard input.

Open, for the reader:

7. **Bugs 13 and 14:** which signal says what the agent read
   (`--replay-user-messages`, or the transcript's `queued_command`), and
   what the thread shows for a message that Med wrote and the agent has not
   read yet. Both bugs need this before **Queue** reaches files and the desk.
