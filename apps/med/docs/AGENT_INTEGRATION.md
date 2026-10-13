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
agent reads it only when it hands off changes, so it costs little context. With
the skill, AGENTS.md needs no Med guidance. `med skills show` prints the skill,
and `med skills uninstall` removes it. Install it again after you update Med.
For agents without skills, see [AGENTS.md guidance](#agentsmd-guidance).

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
"review" and "changes". Keep the same title for each iteration.

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
same key after each round of work: Med adds an iteration to that review instead
of a new workspace. The review is marked new again, and its new comparison and
brief become current. Earlier briefs stay as numbered iterations on the Notes
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
itself.

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
Each segment has a title, an optional kind, a summary in Markdown, its files,
and your comments on lines.

```json
{
  "summary": "The parser recovers from a bad token and reports every error.",
  "segments": [
    {
      "title": "Recovery in the parser",
      "kind": "feature",
      "summary": "`parse` skips to the next statement after an error.",
      "files": ["src/parse.ts", "src/recover/"],
      "comments": [
        {
          "file": "src/parse.ts",
          "line": 42,
          "endLine": 58,
          "kind": "risk",
          "body": "Callers that stop at the first error now see all of them."
        }
      ]
    },
    { "title": "Tests", "kind": "test", "files": ["tests/**"] }
  ]
}
```

- `files` takes paths, folders that end in `/`, and globs with `*` and `**`.
  Put the segments in reading order. Files that no segment names show in a
  last "Other changes" segment.
- Kinds are `feature`, `fix`, `refactor`, `perf`, `test`, `docs`, `config`, and
  `chore`.
- A comment has `file`, `line`, an optional `endLine`, `side` (`new` by
  default, or `old` for removed lines), `kind` (`note`, `suggestion`, `risk`,
  or `question`), and a `body` in Markdown. Comment on what the reader must
  check, not on every change.
- A guide holds up to 200 comments and 200,000 characters.

Pass it with `--guide`, as a file or as `-` for standard input. Only one of
`--brief` and `--guide` can read standard input.

```sh
med review create --key parser-recovery --title "Parser recovery" \
  --repo ~/code/parser --base main --head HEAD --merge-base --guide - < guide.json
```

The Guide tab opens first. Its Overview shows the summary, the segments, and
the range's commits. A segment shows its summary and only its files, with your
comments on their lines; `j` and `k` step between segments, `v` marks the top
file viewed, and `⇧V` marks the segment viewed and goes on. Viewed marks stay
in the browser until a file changes. A commit of the range shows on its own,
with its message.

To replace the guide of the current iteration, run
`med review update --key <name> --guide guide.json`. A later iteration without
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
lines an agent wrote. If other work is present, say so, and ask the user when
the scope is unclear.

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

## Review in Med

A review opens on its latest iteration; the keys at the top of **Notes** show
the others. Hover the title in the review bar for the time Med saved the review
and its repository. When an iteration has more than one comparison, such as
several repositories, a **Review target** picker in the bar chooses one.
History and files stay available, and **Return to review** brings back the
captured comparison. The saved diff
and its context are captured; files that you open from the file tree are live.

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
paste them. **Send to Claude** (or **Send to Codex**) opens the Session pane,
with your text and the comments that you have not sent. Select the comment
count to choose comments. A GitHub comment's reply button, or **Add all to**
the agent in the pull request panel, adds GitHub comments. Press `⌘↵` or **Send**.

- **Claude Code** takes the message with `med review wait --key <task>`, which
  the skill runs in the background after it creates the review. The command
  waits with no time limit, prints the message, and ends; Claude Code then
  wakes the agent. The pane shows **Waiting for you** while the agent waits. A
  message sent earlier stays in Med until the agent waits.
- **Codex** gets the message in its queue (`codex queue`), and the thread's
  next turn reads it first, as a user message. Med finds `codex` on the PATH,
  in the ChatGPT app, or at `MED_CODEX_PATH`.

The thread shows each sent message as waiting, taken, or queued. A sent comment
leaves the drafts until you edit it or reply to it.

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

For Markdown, the user can open **Preview** beside the editor; it shows drafts
before they are saved. Med renders GFM, `mermaid` fences, `$…$` and `$$` math,
and colored code. A blank line starts a paragraph. Relative images resolve
from the document, within its folder or repository; keep secrets and unrelated
paths out of image references. See
[Markdown preview](USAGE.md#markdown-preview) and the
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
open the review on another computer. Med does not delete old reviews, so clear
comments that you no longer need.

- A review starts with up to 16 targets and keeps up to 128 captures, including
  comparisons that got comments later.
- Each target captures up to 500 changed files and 24 MiB of patch and source.
  A larger comparison is an error; narrow it.
- Med stores up to 64 MiB for each review, 128 reviews, 512 MiB in total, and
  500 comments for each review.
- Copied comments are limited to 8 MiB. Med reports an error instead of cutting
  comments; narrow line ranges or remove comments first.
- Binary and very large files keep their diff metadata but give no text
  context for comments.
