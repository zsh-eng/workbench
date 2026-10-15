# Agent reviews

An agent hands off its changes as a review in Med. You read its brief, comment
on lines, and send the comments back. A review can hold comparisons from
several repositories, and it stays on your machine.

## Set up

```sh
med skills install
```

This writes a Med skill for Claude Code (`~/.claude/skills/med`) and Codex
(`~/.agents/skills/med`). The skill is a short version of this guide, and an
agent reads it only when it hands off changes, so it costs little context.
`med skills show` prints the skill, and `med skills uninstall` removes it.
Install it again after you update Med. For agents without skills, see
[AGENTS.md guidance](#agentsmd-guidance).

For threads that Med starts, add these lines to your CLAUDE.md or AGENTS.md,
such as `~/.claude/CLAUDE.md` or `~/.codex/AGENTS.md`. The first install prints
them, and `med skills instructions` prints them again. Edit them as you like;
Med adds nothing to an agent's prompt.

```markdown
## Med

When `MED_THREAD_KEY` is set, Med started you in a thread. When a piece of work
is ready for review, run `med review create --working --title "<2-4 words>"
--guide -` with a JSON guide on standard input; the med skill and
`med docs agents` give the guide's format. In a checkout that other sessions
also change, add `--paths` with your files. Med sends the user's messages to
you as new turns, so do not run `med review wait`.
```

Review commands talk to the running server, so start Med with `med web`. They
find it through a private connection file in the state folder,
`~/.local/state/med` by default. If you change the folder (`--state-dir` or
`MED_STATE_DIR`) or the port (`--port`, default 6330), use the same values for
the server and for the agent's commands. A command without `--port` uses the
one server that runs from the state folder if no server runs on 6330. Saved reviews and their comments last
as long as the state folder.

Open the server's launch URL once in the browser where you review. Med changes
its token for a browser cookie and removes the token from the address; review
links such as `http://127.0.0.1:6330/review/r_…` then work in new tabs. Another
browser must open the launch URL once too. Never put the launch token in agent
instructions or review links.

## Choose the repositories

```sh
med review repos
```

This lists the repositories and worktrees that the user registered: the scope
that reviews can use, not a list to include in full. An agent compares it with
its task, its working directory and Git root, its worktree paths, and the files
that it changed, and includes only the repositories that the task changed.
Canonical paths tell apart clones with the same name or remote. A worktree
belongs to its repository but has its own working files. Pass the repository's
root as `--repo`, not a folder inside it.

Med finds new linked worktrees when it refreshes the list. If the task changed
a repository that is not registered, the agent says which one, and asks before
it runs `med add`. It does not scan the home folder, add nearby checkouts, or
include unrelated changes to make a link. A saved link does not grant access to
other repositories.

## Create a review

Record the commit before the work starts, then hand off the exact start and
end:

```sh
start=$(git rev-parse HEAD)
# … the agent works and commits …
med review create --title "Fix navigation" --repo ~/code/my-app \
  --base "$start" --head HEAD
```

The command prints a link to paste into the final message:

```markdown
[Review changes here](http://127.0.0.1:6330/review/r_example)
```

Open Med windows add the review to their workspace lists, marked new. `--open`
also shows it in the window that the user used last, or opens the link in the
browser when no window is open. Use `--open` when the user asked to see the
review.

The base is the state before the task, not the first changed commit. Med
resolves both ends to commits and captures the comparison. It does not switch
branches, stage files, or commit; do not commit only to make a link unless the
user allows commits.

### Titles and pull requests

`--title` names the review in the workspace list and the browser tab. The list
is narrow, so use 2–4 words that name what the task builds, such as "Commit tab
search" or "Parser recovery". Leave out the repository's name and words such as
"review" and "changes". Keep the same title for each version.

`--pr` links the review to its pull request. The header then shows the pull
request's title, and the workspace keeps the short title. Med reads the title
with the GitHub CLI (`gh`) when the link is added.

```sh
med review create --key feat/parser --title "Parser recovery" \
  --repo ~/code/parser --base origin/main --head HEAD --merge-base \
  --pr https://github.com/owner/repository/pull/123
```

Without `--pr`, a review of one commit or range finds its pull request from a
GitHub `origin` remote and the reviewed branch, when the pull request's head is
exactly the reviewed commit. Detached checkouts, older commits, other remotes,
and unclear cases need `--pr`; `--no-pr` turns the lookup off. The lookup does
not fetch, check out, or change the comparison. If `gh` is missing, signed out,
offline, or slow, Med creates the review with the short title. Without
`--title`, Med uses the pull request's title or names the repository and
comparison.

A manifest sets `"title"` and, optionally, `"pullRequestUrl"` (an HTTPS pull
request URL). Med saves both, so they work offline. A review of several
repositories needs a task title, and a pull request link only if one pull
request covers it all.

### Keep one review per task

`--key` names the task, such as its branch. Create the review again with the
same key after each round of work: Med adds a version to that review instead
of a new workspace. The review is marked new again, and its new comparison and
brief become current. Earlier briefs stay as numbered versions on the Notes
tab, and comments stay on their comparisons. Keys use letters, digits, and
`. / @ : + # _ -`.

```sh
med review create --key feat/parser --title "Parser recovery" \
  --repo ~/code/parser --base origin/main --head HEAD --merge-base --brief -
```

After you open the pull request, link it to the review:

```sh
med review update --key feat/parser --pr https://github.com/owner/repository/pull/123
```

The next `review create` with the key also finds a matching pull request by
itself. While a thread is an open tab, Med also links the first open pull
request from its branch that `gh pr list --head <branch>` finds.

### Link your session

Med records the agent sessions that worked on a review. Its Session pane shows
the agent's thread, read from the transcript and followed live; see
[agent sessions](SESSIONS.md). The user can right-click the workspace to copy a
command that resumes a session in its folder, such as
`cd '/path/to/worktree' && claude --resume <id>`.

- Claude Code sets `CLAUDE_CODE_SESSION_ID`, and `review create` records that
  session by itself.
- Other sessions need `--session codex:<id>` or `--session claude:<id>`. Repeat
  the option for more sessions; `review update --key <name> --session …` adds
  one later.
- `--no-session` records no session from the environment.

Med reads a session's folder from its transcript in `~/.claude` or `~/.codex`.
Without a transcript, it records the command's folder. A review keeps its 32
newest sessions.

### Attach a guide

A guide splits the review into segments that the reader checks one at a time.
Write it in JSON: a short summary of the whole change, then up to 40 segments.
Each segment has a title, an optional area, a summary in Markdown, its files,
and your comments.

```json
{
  "summary": "Errors no longer stop the parse, so the editor can show all of them at once.",
  "segments": [
    {
      "title": "Parser recovery",
      "area": "core",
      "summary": "`parse` skips to the next statement after an error.",
      "files": ["src/parse.ts", "src/recover/"],
      "comments": [
        {
          "file": "src/parse.ts",
          "line": 42,
          "endLine": 58,
          "kind": "risk",
          "body": "Callers that stop at the first error now see all of them."
        },
        { "file": "src/recover/index.ts", "body": "The new entry point." }
      ]
    },
    { "title": "Tests", "area": "tests", "files": ["tests/**"] }
  ]
}
```

#### How to split a change

These rules come from pulls.review's grouping prompt (see
[upstream/PULLS-REVIEW.md](../upstream/PULLS-REVIEW.md)), adapted to an agent
that wrote the change itself.

- Group by intent, not by folder. One feature that touches several modules is
  one segment.
- Use the fewest segments that still separate independent intents, usually
  1–5. Split a segment of more than about 15 files by sub-area.
- Put tests, fixtures, and stories in their own segment, after the code they
  cover.
- Order by review priority: the core change first, supporting changes next,
  mechanical changes (lockfiles, generated files, formatting) last.
- Put every changed file in exactly one segment. Commits hint at your intents,
  but group by the final change, not by commit: fixup commits often mix
  concerns.
- Summaries say why over what, in 1–3 sentences. Titles have at most 4 words.
- Comment only where it saves the reader time: non-obvious logic, a subtle
  change in behavior, a risk. Do not explain the obvious; most files need no
  comment. Use `risk` for what needs extra care (security, data loss, hard to
  revert, easy to get wrong). Set `"critical": true` on a segment only when the
  whole segment does; the Guide marks it "Needs care".

#### Fields

- `files` takes paths, folders that end in `/`, and globs with `*` and `**`.
  Files that no segment names show in a last "Other changes" segment.
- `area` says which part of the system a segment touches: `ui`, `api`, `core`,
  `data`, `cli`, `security`, `tests`, `docs`, `examples`, `deps`, `build`,
  `scripts`, `config`, `i18n`, `assets`, or `other`.
- A comment has `file`, an optional `line` and `endLine`, `side` (`new` by
  default, with new-file line numbers, or `old` for removed lines), `kind`
  (`note`, `suggestion`, `risk`, or `question`), and a `body` in Markdown. A
  comment without `line` is about the whole file. Put each comment in the
  segment that holds its file.
- A guide holds up to 200 comments and 200,000 characters.

Pass it with `--guide`, as a file or as `-` for standard input. Only one of
`--brief` and `--guide` can read standard input.

```sh
med review create --key parser-recovery --title "Parser recovery" \
  --repo ~/code/parser --base main --head HEAD --merge-base --guide - < guide.json
```

After it saves the review, the command checks the guide against the changed
files and prints what to fix: files in no segment, files in more than one,
paths that match no changed file, and comments outside their segment's files.

```text
Guide check: put every changed file in exactly one segment.
- In no segment (Med shows them under "Other changes"): src/lexer.ts
Fix the guide, then run: med review update --key "parser-recovery" --guide <file>
```

The **Review** tab opens on the Guide. Its Overview shows the summary, the
segments, and the range's commits. A segment shows its summary and only its files, with your
comments on their lines; comments on whole files, and on lines the diff does
not show, follow the summary. `j` and `k` step between segments, `v` marks the
top file viewed, and `⇧V` marks the segment viewed and goes on. Viewed marks
stay in the browser until a file changes. A commit of the range shows on its
own, with its message.

To replace the guide of the current version, run
`med review update --key <name> --guide guide.json`. A later version without
a guide keeps the one before it.

### Attach a brief

A brief explains the change to the reviewer. Write it in Markdown, and cite
code with repository-relative links that end in line numbers:

```markdown
The parser now rejects empty input ([parse.ts:42-58](src/parse.ts:42-58)).
The tests cover both cases in [parse.test.ts:12](tests/parse.test.ts:12).
```

Pass it with `--brief`, as a file or as `-` for standard input:

```sh
med review create --title "Fix the parser" --repo ~/code/parser \
  --base "$start" --head HEAD --brief brief.md
```

The Notes tab shows the brief first. Under each sentence that cites a range,
the range shows as a short diff, and the tab lists the changed files that the
notes do not cite. Cite the files that need attention; the reviewer reads the
rest in Changes. Replies that the user pins from your session follow the brief,
so cite files there the same way.

Links can be `path:line`, `path:start-end`, `path#Lstart-Lend`, absolute paths
in the repository, and GitHub blob URLs. With `--manifest`, links resolve
against the open target. A brief holds up to 100,000 characters. The user can
also paste your final message into Med with `⌘V`.

### Compare with a base branch

`--base` and `--head` take branch names and other local refs. Run the command
on the feature's worktree, with the repository's real base branch, such as
`main`, `develop`, or `origin/main`:

```sh
med review create --title "Search filters" --repo ~/code/my-app-feature \
  --base main --head HEAD --merge-base
```

With `--merge-base`, Med compares the common ancestor with the feature's tip,
as a pull request does, and leaves out changes made only on the base branch.
Without it, Med compares the two tips. In a manifest, set `"mergeBase": true`.

- Med does not fetch. A ref such as `origin/main` uses its local commit.
- For a stacked change, use the previous feature branch as the base.
- Choose the base for each repository on its own.
- After a merge or a rebase, create the review again. A saved link keeps the
  comparison that it captured.

### Capture working changes

```sh
med review create --title "Navigation draft" --repo ~/code/my-app --working
```

`--working` captures the staged, unstaged, and untracked changes as they are
now, including changes that were there before the task. Med cannot tell which
lines an agent wrote. If other work is present, such as in a checkout that
other sessions share, keep only your files with `--paths`; otherwise say so,
and ask the user when the scope is unclear.

```sh
med review create --title "Navigation draft" --repo ~/code/my-app --working \
  --paths src/nav.ts src/nav/
```

`--paths` takes files and folders, relative to the current folder or
absolute, and it also limits a range (`--base`, `--head`). Each name must be
in the repository. `med review update --key <name> --paths …` adds a new
version of the working changes with those paths.

### Several repositories

For more than one repository, or more than one comparison in a repository,
write a manifest:

```json
{
  "title": "Reader sync",
  "targets": [
    {
      "repo": "/Users/you/code/reader",
      "comparison": { "kind": "range", "base": "main", "head": "HEAD", "mergeBase": true }
    },
    {
      "repo": "/Users/you/code/sync-server",
      "comparison": { "kind": "working" }
    }
  ]
}
```

```sh
med review create --manifest review.json
```

A manifest takes commit, range, working, staged, and unstaged comparisons;
patches and file pairs cannot be saved. Keep a generated manifest out of the
reviewed changes unless it belongs to the project. `med review create --help`
lists every option.

## Tabs and history

The threads that the user has open are tabs, in Med's sidebar. The others are
history: Med does not watch them. A thread that you hand off with
`med review create` opens as a tab. When the user asks you to open, close, or
list threads, use `med thread`:

```sh
med thread list                          # the tabs: ID, state, repository/branch, title
med thread list --history                # closed threads and found sessions, newest first
med thread open r_6d1f…                  # opens a thread from history as a tab
med thread close r_6d1f…                 # sends a tab to history; its agent keeps working
med thread close --key "$MED_THREAD_KEY" --remove-worktree
med thread reopen                        # opens the tab that closed last, at its place
med thread delete r_6d1f…                # deletes the thread with its Review versions and comments
```

The lines have tabs between the fields. The state is `working`, `needs-you`,
`idle`, or, in history, `closed`. `--json` prints the threads with all their
details. A thread's `turn` tells what the user sees at the end of its session:
when the last turn ended, whether it asked a question, and `checks`, the last
run of each test, type check, linter, or build in the turn, such as
`{ "name": "bun test", "status": "passed", "pass": 5, "fail": 0 }`. Its
`changes` count the files and lines. `--key` names a thread by its review's key. `--remove-worktree` also
removes the linked worktree that Med made for the thread, when Git can do that
without force; the branch stays. Close or delete only the threads that the
user names.

## Find and adopt sessions

Med finds the Claude Code and Codex sessions of the last 7 days in the
registered repositories by itself, also when no agent hands them off
([found sessions](SESSIONS.md#found-sessions)). One whose agent works opens as
a tab; the others are in history (`med thread list --history`). When the user
asks for an older session, or one that Med did not find, find it and make it
a Med thread.

`med thread find <words>` lists the sessions on this computer of any age,
newest first: those whose title, first prompt, folder, or ID has each word.
Each line has the session, the time of its last change, its folder, and its
title, with tabs between them. A session that a thread holds ends with the
thread's ID. `--json` gives all the details, and `--limit` the number of lines
(default 20).

```sh
med thread find tide prediction
# claude:2f0c…	2026-09-12 16:40	~/code/tide	Explain the tide prediction model
```

`med thread adopt <session>` makes the session a Med thread, as **Keep in Med**
does: the thread shows the session and the live Changes of the session's
checkout. It captures nothing; the thread has a Review once the agent shows
one ([Show work in a thread](#show-work-in-a-thread)). Give the session as
`find` prints it, as an ID or its first 6 or more characters, or as the path
of its transcript. The command prints the thread's ID and a Markdown link; put
the link in your reply.

```sh
med thread adopt claude:2f0c4a91-6b0e-4d55-9a57-1f3e8c2d7b10
# Thread r_6d1f…: [Explain the tide prediction model](http://127.0.0.1:6330/review/r_6d1f…)
```

- A new thread opens as a tab. A session that a thread holds gives that
  thread, and opens it as a tab when it is in history.
- When no session matches, or more than one does, the command fails and says
  so; for more than one, it lists them.
- When the session's folder is not in a registered repository, or no longer
  exists, choose the checkout with `--repo <path>`. `--title` names the thread,
  and `--open` shows it.

## Show work in a thread

A thread has two views of its work. **Changes** are the checkout's Git
changes as they are now: on a branch, its commits since the base branch and
its uncommitted changes. Med saves nothing for them. **Review** is what the
agent shows the user: each hand-off is a saved version, and comments attach
to the version that they are on.

`med thread show` adds a version to the Review of your session's thread. In a
Med thread, `MED_THREAD_KEY` names the thread; in a Claude Code session, Med
finds the thread that holds the session (adopt it first). `--key` or
`--session codex:<id>` names another thread.

```sh
med thread show --paths src/nav.ts src/nav/ --guide - <<'GUIDE'
<your guide>
GUIDE
```

- `--paths <path>...` shows the uncommitted changes of these files or folders.
  Use it in a checkout that other sessions or people also change, such as a
  shared main checkout. With `--base <ref>`, it shows the files' changes since
  the branch left `<ref>`.
- `--base <ref>` shows the branch's commits since it left `<ref>`, and its
  uncommitted changes; with `--head <ref>`, only the commits to `<head>`.
- `--commit <ref>` shows one commit, `--working` all uncommitted changes, and
  `--manifest <path>` the targets of a manifest.
- `--guide` and `--brief` attach a guide or a brief to the version.

The command prints the version and the thread's link. `med review create
--key <thread-key>` with a comparison also adds a version, and
`med review update --key <key> --paths …` adds one of those files' working
changes.

## Review in Med

A thread's pane has the tabs **Review**, **Changes**, and **Commit**. It opens
on **Review**, at the latest version, once the agent has shown one, and on
**Changes** before that. The menu above the diff chooses a version; the keys
at the top of **Notes** do too. Hover the title in the review bar for the time
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
- **Ask** (`a`) asks the thread's agent about the selected lines, in a fork of
  its session in plan mode. The thread does not get the question or the
  answer. **Keep as comment** saves both as a comment on the lines
  (`Question: …`, then the agent's name and its answer); the agent gets it with
  the other comments.
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
paste them. **Send to Claude** (or **Send to Codex**) opens the Session pane,
with your text and the comments that you have not sent. Select the comment
count to choose comments. A GitHub comment's reply button, or **Add all to**
the agent in the pull request panel, adds GitHub comments. Press `⌘↵` or **Send**.

- **A session that Med started** in a thread gets the message as a new turn.
  It does not run `med review wait`; in such a session, the command exits at
  once. `MED_THREAD_KEY` and `MED_THREAD_REPO` give its `--key` and `--repo`.
- **Claude Code** in a terminal or app takes the message with
  `med review wait --key <task>`, which the skill runs in the background after
  it creates the review. The command
  waits with no time limit, prints the message, and ends; Claude Code then
  wakes the agent. The pane shows **Waiting for you** while the agent waits. A
  message sent earlier stays in Med until the agent waits. The command confirms
  each message that it prints; a message that no wait confirms within 10
  seconds, as when the waiting process stopped, goes to the next wait. When
  the Claude Code process ends with messages still waiting, Med resumes the
  session and sends them.
- **A Claude Code session that no process runs**, such as an adopted one
  after its terminal closed, resumes in Med with the message as its next
  turn, and Med runs it from then on. A session open in a terminal or another
  app that does not run `med review wait` gets its messages when that session
  ends, or in a fork with **Continue in Med**
  ([messages to adopted sessions](SESSIONS.md#messages-to-adopted-sessions)).
- **Codex** gets the message in its queue (`codex queue`), and the thread's
  next turn reads it first, as a user message. Med finds `codex` on the PATH,
  in the ChatGPT app, or at `MED_CODEX_PATH`.

The thread shows each sent message as waiting (for the agent, or for its
session in a terminal or another app to close), taken, or queued. A sent comment leaves the
drafts until you edit it or reply to it.

## Link to a current file

A review captures a comparison. To point at a file as it is now, including a
file outside registered repositories, print a file link:

```sh
med open ~/code/my-app/src/Example.java --line 42 --column 8
```

The server checks the file, and the command prints a Markdown link. The link
opens live content from disk; writable files open in the Vim editor. Opening
the link does not change the file or register its folder. A dropped preview has
no path on disk, so it cannot have a link. See
[standalone files](USAGE.md#standalone-files-and-dropped-previews).

Markdown files open rendered, and the rendered view shows drafts before they
are saved. Med renders GFM, `mermaid` fences, `$…$` and `$$` math,
and colored code. A blank line starts a paragraph. Relative images resolve
from the document, within its folder or repository; keep secrets and unrelated
paths out of image references. See
[Read and edit Markdown](USAGE.md#read-and-edit-markdown) and the
[sample note](examples/reading-queue.md).

## AGENTS.md guidance

For agents without skills, add guidance to AGENTS.md instead. **Confirm the
workflow and its repositories with the user before you add it.** Reading this
guide does not allow you to edit their AGENTS.md. Adapt the commands to their
setup.

```markdown
When you hand off code changes, give a Med review link if Med is running.

- At the start, record the repositories and worktrees, their starting commits, and any changes that were already there.
- Run `med review repos` for the registered repositories. Include only the repositories that this task changed.
- For commits on `main`, use the recorded starting commit and the final commit; comparing `main` with `HEAD` is then empty. For uncommitted work, use `--working`, and say which changes were already there.
- For a feature branch, use the repository's base branch with `--base main --head HEAD --merge-base`, or the previous branch for a stacked change. Choose the base for each repository. Do not fetch without permission.
- Use a `--title` of 2–4 words that names what the task builds. Pass `--pr` when a pull request exists; never invent its URL.
- Use `med review create` for one target and `--manifest` for several. Put the printed Markdown link in your final message.
- Pass `--key` with the branch or task name, and reuse it for later rounds. After you open a pull request, run `med review update --key <name> --pr <url>`.
- Pass a guide with `--guide -`: a summary, segments in reading order with their files, and comments on the lines that need attention (see `med docs agents`).
- For one current file or line, give a `med open` link instead.
- Do not commit, switch branches, add repositories, or edit AGENTS.md only to make a link.
- If Med is not running or a repository is missing, say what is needed. Never invent a URL or print Med's access token.
- Review comments refer to the captured comparison. Check the current source before you apply them; line numbers can change.
```

## Limits

Reviews are local to the computer that runs Med; a localhost link does not
open the review on another computer. Med keeps a closed thread's Review
versions and comments for 30 days, then a short record of it (title,
repository, branch, sessions) for 180 days after the close.

- A review starts with up to 16 targets and keeps up to 128 captures, including
  comparisons that got comments later.
- Each target captures up to 500 changed files and 24 MiB of patch and source.
  A larger comparison is an error; narrow it.
- Med stores up to 64 MiB for each review and 500 comments for each review.
  Over 512 MiB in total, Med first removes the captures of the threads that
  closed first, and keeps their short records; it refuses a new capture only
  when the tabs alone use more.
- Copied comments are limited to 8 MiB. Med reports an error instead of cutting
  comments; narrow line ranges or remove comments first.
- Binary and very large files keep their diff metadata but give no text
  context for comments.
