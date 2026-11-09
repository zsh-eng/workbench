# Review changes

1. Choose branch, working, staged, or unstaged changes in the comparison menu
   above the diff. Branch changes are the commits since the base branch and
   the uncommitted changes; a branch other than the base opens on them.
   **Base branch…** chooses another base for them, and **Compare
   revisions…** in the review's menu chooses a range. A range compares
   snapshots; it does not add patches across merged branches.
2. Select a changed path to go to it in the diff. Double-click it to open the
   whole file.
3. Open unchanged files from the file picker or the Files pane. Each file opens
   in a tab of its own, beside Changes, and stays until you close it. A branch
   without a worktree opens its committed content.

To comment, drag the gutter **+** across lines, or select line numbers and
press `c`. A comment shows its Markdown rendered, such as code and lists, and
keeps your line breaks; `$HOME` and `$3` stay text, and only `$$` starts math.
**Edit** shows the text as you wrote it, and the agent gets that text. Hover
the **+/−** totals in the review's header to split them into code, tests,
docs, config and data, and generated files.

A comment can ask as well as tell. The agent reads each one in the thread, as
one conversation: it answers a question in the comment's thread and changes
nothing for it, and it does what a request asks.

In a whole file, `⌥B` shows blame in the gutter; hover a label for the date and
message. When the cursor rests on a line, its author, age, and commit subject
show after the text. Click the short hash to copy the full hash. **Hide line
blame at the cursor** in the palette turns this off.

## Generated files and dependencies

Lockfiles, build output (`dist/`, `.vite/`), snapshots, minified files, and
files with a "generated" or "do not edit" header are **generated files**
([rules](../GENERATED.md)). Changes and Review show them last, in a folded
**Generated** group, and the headline **+/−** does not count them. Each line
of the group names the file's kind, what changed ("12 indirect dependencies
updated", "3 snapshots: 1 changed, 2 added"), the agent command that wrote it
("written by `bun add zod`"), and the file that it comes from. Click the
group's row to add the files to the stream. Choosing a generated file in
Changed files, a search, or a link opens the group. In Changed files, the
generated files are in a second tree under a folded **Generated** row.

Two warnings show on a generated file: **Edited by hand**, when an agent
session of the thread edited it directly, and **No manifest changed**, for a
lockfile without a changed manifest (correct after `bun update`).

A changed `package.json` gives a **Dependencies** card at the top of the
stream: each added, removed, or changed package, its old and new version, and
**major** when the major version goes up. **Look up licences and dates** adds
the licence and the release date of each version from deps.dev. This sends
package names and versions to deps.dev, so it is off until you turn it on;
the host keeps the answers. A licence change and a release less than a week
old show in the warning colour.

An agent can mark other files that a tool wrote when it hands off a Review
(`med review create --generated <glob>`). To change a file's mark yourself,
use Git attributes; they win over the agent's mark. A committed
`.gitattributes` applies for everyone; `.git/info/attributes` applies only to
your clone:

```gitattributes
src/schema.ts linguist-generated
bun.lock -linguist-generated
```

## Review in Med

A thread's pane has the tabs **Review**, **Changes**, and **Commit**. It opens
on **Review**, at the latest version, once the agent has shown one, and on
**Changes** before that. The menu above the diff chooses a version. Hover the title in the review bar for the time
Med saved the review and its repository. A version with more than one
comparison, such as one for each repository, lists each one in the menu.
History and files stay available, and the **Review** tab brings back the saved
comparison. The saved diff and its context are captured; files that you open
from the file tree, and **Changes**, are live.

- **Comment.** Select lines in the diff. The card shows the lines, **L** for
  the old side and **R** for the new. Write, then press **Comment** or `⌘↵`;
  **Cancel** or Escape closes the draft. Saved comments have **Reply**,
  **Edit**, and **Delete**. Med shows each change at once and saves it in the
  background; if a save fails, Med restores the comment, reports the error, and
  keeps your text.
- **Copy comments** copies, as Markdown, the comments on every comparison that
  you visited in the review, including commits from the history. It uses the
  field names of Codex diff comments: **File**, **Workspace**, **Side**,
  **Lines**, **Diff hunk**, and **Comment**, plus the comparison's ends, the
  capture type, and IDs. Replies name their parent. Each excerpt has the
  selected lines and up to three rows on each side, from the saved patch, or
  from labelled captured source when the patch does not cover them; it never
  reads current files. Copying waits for saves to finish and does not delete
  comments.
- **Clear**, then **Confirm clear**, removes the review's comments from all
  its targets. If the comments changed after you opened the confirmation, Med
  refuses the clear. Clearing does not delete the review or change files.
- **Compare against** compares the selected tip with its common ancestor on a
  local or remote-tracking branch. This browses; the saved review does not
  change. **Compare revisions…** compares two exact ends.
- **Push to remote** (the push button) opens a dialog with the exact commit,
  repository, remote, and branch. Choose a branch or type a new name, then
  select **Push to origin**.
  Med pushes committed history only; it does not force, delete remote
  branches, or push tags. Push hooks run, and a rejected push says what to do.
  A captured working comparison cannot be pushed.

With more than one comparison, **Total** in the review bar counts the lines of
all of them, from their captured ends, and stays fixed while you browse. The diff toolbar counts
the selected comparison. Targets that overlap can count a line twice; for pull
requests and stacked changes, use `--merge-base` so that merged work is left
out. Binary files count no lines.

### Send comments to the agent

A review with an agent session sends comments to that session, so you do not
paste them. The session's message box holds your text and the comments that
you have not sent. They wait above it as one line: **Send 2 comments** sends
them on their own, and the comment count opens the list, where a checkbox
chooses which, and a comment's file and text show it at its line in Changes. A GitHub comment's reply button, or **Add all to**
the agent in the pull request panel, adds GitHub comments. Press `⌘↵` or **Send**.

When Med started the session and runs it, one comment can go on its own: hold
the pointer over it and select the agent's mark (**Send to Claude**). The
comment then says **Sent to Claude** until you change it or reply. The agent
can answer a comment in its thread (`med reply <id>`): its answer shows
under your comment with the agent's name, and leaves the comment sent. Reply
to it as to any comment; your reply makes the thread unsent again.

Med sends only to a session that it runs:

- **A session that Med started** in a thread gets the message as a new turn.
  `MED_THREAD_KEY` and `MED_THREAD_REPO` give its `--key` and `--repo`.
- **A session that no process runs**, such as Claude Code or Codex after its
  terminal closed, resumes in Med with the message as its next turn, and Med
  runs it from then on. Med finds `codex` on the PATH, in the ChatGPT app, or
  at `MED_CODEX_PATH`.
- **A session open in a terminal or another app** is for reading in Med. Its
  message box is shut, and one line says where it is open. **Continue in
  Med** forks it into a session that Med runs; or **Copy comments** and paste
  them into the session there
  ([messages to adopted sessions](../SESSIONS.md#messages-to-adopted-sessions)).

**Copy comments** (the copy button with the comments' number in the review's
header, or ⌘K) copies every comment as the same text that a message holds,
for any agent. Copying marks nothing sent.

The thread shows each sent message as taken, or queued while the agent works.
A sent comment leaves the drafts until you edit it or reply to it. Each message keeps the version of
each comment that it sent, from the same read as the agent's text, so an
edit while Med sends stays a draft.

### Comment on a file

In a thread, you can comment on any file that you open, not only on the
change: press `gc` on a line, or on lines selected in Visual mode, or click
the **+** beside a line. A plain box opens under the lines. The round arrow
(`⌘↵`) sends the comment to the agent now, or at its next step while it works;
the clock (`⌥↵`) waits for its turn to end; the comment mark adds it to the
thread's message with the other comments. `Esc` or **×** cancels. The comment
stays under its last line, as on a page that people comment on together; its
**Reply**, **Resolve**, and **Delete** show when the pointer is on it. The agent gets the file's path, the lines
as they were, and your text; it answers in the comment's thread
(`med reply <id>`) and, when it has done what you asked, resolves it
(`med reply <id> --resolve`). A resolved comment says who resolved it;
**Reopen** opens it again, and so does your reply. A comment covers at most
400 lines. Without a session that Med runs, the
comment waits in the message box, to send or copy with the others.

### All comments

The comment button at the end of the review's header, with the count of open
comments, lists the thread's comments: those on the diff's lines and those on
files' lines, newest first. Each shows its file and lines, its time, its
first two lines, and who answered it. A dot marks one that waits to be sent.
The filter shows the resolved ones too, and the copy button copies them all
for an agent elsewhere. Click one to open it at its lines.

## Full-file change markers

A whole file opened from a diff marks added lines with green gutter bars and
deleted lines with red bars. A deletion with no remaining row shows as a red
tick at its gap. Blue bars mark working-file additions and replacements. Hover
a marker for its comparison.

Markers use the selected comparison only when its captured text matches the
file on screen; otherwise they compare live content with HEAD. **Open before
version of current file** and **Open after version of current file**, in
`⌘K`, show the exact commit versions. A stale view drops its markers until you
refresh: **Refresh contents** in its notice, or **Refresh current file** in
`⌘K`.
