# Review links and agent comments

med connects an agent's changes to a local review. A review can contain comparisons from several registered repositories. Its link has no access token. Comments are saved locally and can be copied together as Markdown for any agent.

## Start and connect

Build or install the Med executable, then register only repositories the user
has selected for review:

```sh
med add /path/to/workbench
med add /path/to/another-repo
med web
```

Use `node /path/to/workbench/apps/med/dist/cli.js` in place of `med` for a built
checkout. See `med docs vaults` for executable build and service setup.

An agent can register sources with `med add <path>`. `med service login on`
opens Med at the next login without restarting the running server;
`med service login off` removes it.

The default address is `http://127.0.0.1:4173`. An occupied port produces an error; med does not silently change the address. Use `--port` to choose another port. Keep the host running while using review links.

Open the launch URL once in the browser where you will review changes. med exchanges its token for a browser cookie and removes the token from the address. Links such as `http://127.0.0.1:4173/review/r_…` then work in new tabs in that browser. A different browser must open the launch URL once too. Do not put launch tokens in agent instructions or review links.

The CLI finds the running host through a private local connection file. The default state directory is `~/.local/state/med`; use `MED_STATE_DIR` or `--state-dir` to change it. The host and agent commands must use the same state directory and port. Saved reviews and comments survive restarts when that directory is retained. Managed registrations survive restart; a saved link does not grant access to an unrelated repository.

## Choose the correct repositories

An agent can inspect the user's registered repositories and worktrees:

```sh
node /Users/admin/workbench/apps/med/dist/cli.js review repos
```

In Workbench, med belongs to the Workbench repository. Use the Workbench root as `--repo`; `apps/med` is an app directory, not a separate Git repository.

This list is the user's review scope, not a request to include every listed repository. The agent should compare it with the task, its working directory, Git repository root, linked worktree paths, and the files it actually changed. Include only the repositories affected by the task. Use canonical local paths to distinguish separate clones with the same name or remote URL. A worktree belongs to its repository family but has its own working files.

The host discovers new linked worktrees when the catalogue refreshes. If the task changes an unrelated repository that is not registered, explain which one is missing. Ask the user before adding it to their review setup. Do not scan the home directory, add every nearby checkout, or include unrelated dirty files just to produce a link.

## Create a review

Record the starting commit before work, then use the exact start and end commits for the handoff:

```sh
node /Users/admin/workbench/apps/med/dist/cli.js review create \
  --title "Fix navigation" \
  --repo /Users/admin/workbench \
  --base <commit-before-work> \
  --head <commit-after-work>
```

The result is ready to paste into the final response:

```markdown
[Review changes here](http://127.0.0.1:4173/review/r_example)
```

Open Med windows add the new review to their workspace lists, marked new. Add `--open` to also show it in the window the user used last; with no window open, the command opens the link in the browser. Use `--open` when the user asked to see the review.

The base is the state before the task's changes, not the first changed commit. med resolves the endpoints and captures the comparison. It does not switch branches, stage files, or make commits. Do not commit solely to create a link unless the user has authorized commits.

### Titles and pull requests

`--title` names the review in Med's workspace list and the browser tab. The
list is narrow, so use 2–4 words that name what the task builds, such as
"Commit tab search" or "Parser recovery". Leave out the repository name and
words such as "review" or "changes". Use the same title for each iteration.

Once the review has a pull request, its header shows the PR title and links to
the PR. The workspace keeps the short title. Med reads the PR title with the
optional GitHub CLI (`gh`) when the link is added:

```sh
med review create --key feat/parser --title "Parser recovery" \
  --repo /path/to/feature-worktree --base origin/main --head HEAD --merge-base \
  --pr https://github.com/owner/repository/pull/123
```

Without an explicit link, a single-target review can infer it for commit/range
comparisons from a GitHub `origin` remote and the reviewed branch. The PR head
must match the reviewed commit exactly; that head is pinned before capture.
Detached checkouts, older commits, other remotes, and ambiguous cases should
use `--pr`. Use `--no-pr` to skip automatic lookup. Missing `gh`,
authentication, offline connections, and lookup timeouts do not block review
creation; the header then shows the short title. Without `--title`, med uses
the PR title or a repository/comparison label. This lookup does not fetch Git
refs, check out branches, or change the selected comparison.

A manifest supplies `"title"` and optional `"pullRequestUrl"` (an HTTPS PR URL).
These values are saved with the review and remain available offline and after
restart. A review spanning several repositories should use a task title and
only attach a PR link if it represents the whole review.

### Keep one review per task

Add `--key <name>` to name your task, such as its branch. Create the review
again with the same key after each round of work: Med adds an iteration to that
review instead of a new workspace. The workspace is marked new again, and the
new comparison and brief become current. Earlier briefs stay as numbered
iterations on the Brief tab, and comments stay on their comparisons.

```sh
med review create --key feat/parser --title "Parser recovery" \
  --repo /path/to/worktree --base origin/main --head HEAD --merge-base --brief -
```

After you open the pull request, link it to the same review. The review header
then shows the PR title:

```sh
med review update --key feat/parser --pr https://github.com/owner/repository/pull/123
```

The next `review create` with the key also finds a matching PR on its own, as
described above. Keys use letters, digits, and `. / @ : + # _ -`.

### Link your session

Med records the agent sessions that worked on a review. The reviewer can
right-click the workspace and copy a command that resumes a session in its
directory, such as `cd '/path/to/worktree' && claude --resume <id>`.

- Claude Code sets `CLAUDE_CODE_SESSION_ID`; `review create` records that
  session on its own.
- Other sessions need `--session codex:<id>` or `--session claude:<id>`. Repeat
  the option for more than one. `review update --key <name> --session …` adds a
  session later.
- `--no-session` records no session from the environment.

Med reads the session's directory from its transcript in `~/.claude` or
`~/.codex`. When it finds no transcript, it records the command's directory. A
review keeps the 32 newest sessions.

A review with a session has a Session sidebar: the agent's thread, read from
its transcript and followed while the agent works. See [agent sessions](SESSIONS.md).

### Attach a brief

A brief explains the change to the reviewer. Write it in Markdown and cite code
with repository-relative links that end in line numbers:

```markdown
The parser now rejects empty input ([parse.ts:42-58](src/parse.ts:42-58)).
The tests cover both cases in [parse.test.ts:12](tests/parse.test.ts:12).
```

Attach it when you create the review. `--brief -` reads standard input:

```sh
med review create --title "Fix the parser" --repo /path/to/repo \
  --base <commit-before-work> --head <commit-after-work> --brief brief.md
```

The Brief tab shows each cited range as a short diff below the sentence that
cites it, and lists the changed files that the brief does not cite. Cite the
files that need attention; a reviewer reads the rest in Changes. Links accept
`path:line`, `path:start-end`, `path#Lstart-Lend`, absolute paths in the
repository, and GitHub blob URLs. Use `--brief` with `--manifest` too; links
resolve against the open target. A brief holds up to 100,000 characters. The
user can also paste your final message into Med with `⌘V`.

### Compare with a base branch

Both `--base` and `--head` accept branch names and other local Git refs. Run this command against the feature worktree:

```sh
node /path/to/workbench/apps/med/dist/cli.js review create \
  --title "Search filters" \
  --repo /path/to/feature-worktree \
  --base main --head HEAD
```

Use the repository's intended base branch, such as `main`, `develop`, or `origin/main`. Without `--merge-base`, med compares the two tips directly. It does not fetch remote refs. A remote-tracking ref such as `origin/main` uses its locally stored commit.

For a pull-request-style review, use the intended base branch and `--merge-base`. This compares the common ancestor with the feature tip and excludes changes made only on the base branch:

```sh
node /Users/admin/workbench/apps/med/dist/cli.js review create \
  --title "Search filters" --repo /path/to/feature-worktree \
  --base main --head HEAD --merge-base
```

Use `develop` when that is the integration branch. For a stacked change, use the preceding feature branch as the base. Choose the base separately for each repository. After merging or rebasing, create a new review. The host resolves the common ancestor and head to exact commits; an existing link keeps its captured comparison. Manifest ranges use `"mergeBase": true` for the same behavior. Without this flag, range comparisons remain direct endpoint comparisons. Remote-tracking refs use locally available history; med does not fetch automatically.

In the app, **Compare against** lists local branches and remote-tracking branches. It uses the common ancestor of the chosen base and the selected tip. Changing the comparison starts browsing; **Return to review** restores the original captured comparison. The saved review is unchanged. **Compare revisions…** remains available for exact, direct endpoint comparisons.

**Push** opens a dialog with the exact commit, repository, remote, and destination branch. Select an existing branch or type a new name, then select **Push to remote**. This pushes committed history only. med does not force, delete remote branches, or push tags. Repository push hooks still run. A rejected push reports how to proceed. A captured working comparison cannot be pushed as a commit.

### Capture working changes

For uncommitted changes:

```sh
node /Users/admin/workbench/apps/med/dist/cli.js review create \
  --title "Navigation draft" \
  --repo /path/to/worktree \
  --working
```

This captures the working comparison at creation time, including staged, unstaged, and untracked changes supported by the viewer. It also includes pre-existing changes. If other work is present, explain that scope and resolve any ambiguity with the user. A captured working comparison cannot infer which lines an agent authored.

For multiple repositories or multiple comparisons in one repository, write a manifest:

```json
{
  "title": "Update reader integration",
  "targets": [
    {
      "repo": "/path/to/reader-repository",
      "comparison": { "kind": "range", "base": "<reader-before>", "head": "<reader-after>" }
    },
    {
      "repo": "/path/to/other-repository",
      "comparison": { "kind": "range", "base": "<spaced-before>", "head": "<spaced-after>" }
    }
  ]
}
```

```sh
node /Users/admin/workbench/apps/med/dist/cli.js review create --manifest /path/to/review.json
```

A manifest accepts commit, range, working, staged, and unstaged comparisons. Patch and arbitrary file-pair inputs are not saved-review targets. Use `review create --help` for connection options. Keep generated manifests outside the reviewed changes unless they are intended project files.

## Review and return comments

A link opens its first target. The compact review bar shows a target selector when the review has more than one target, including different comparisons on the same branch. Open **Review** for the full title, repository path, comparison, and capture time. The normal history and file browser remain available. Use **Return to review** to restore the captured comparison after browsing elsewhere. Working files shown in the file browser remain live; the saved diff and its expanded context are captured content.

Add comments to lines or line ranges in the saved diff. The comment card shows **You** and the selected lines: **L** for the old side, **R** for the new side. Write the comment, then select **Comment** or press Cmd/Ctrl+Enter. **Cancel** or Escape closes the draft. Saved cards keep the same text layout, with **Reply**, **Edit**, and **Delete** below the text. Clicking away, **Cancel**, or Escape clears the line selection. With a comment draft open, selecting another line range moves the editor to that range. Comment additions, edits, and deletions appear immediately while med saves them in the background. If saving fails, med restores the affected content and reports the error; unsaved comment text remains available for retry. **Copy comments** waits for pending writes before exporting.

**Copy comments** collects comments from all comparisons and tabs visited within that review, including inactive tabs and commits selected from history. The first comment on another comparison captures its source for later export. The original review targets remain unchanged. It uses the same field names as Codex diff comments: **File**, **Workspace**, **Side**, **Lines**, **Diff hunk**, and **Comment**. Each comment also includes the exact comparison endpoints, capture type, and repository, target, and comment IDs. Replies refer to their parent comment. Diff excerpts include the selected lines and up to three nearby patch rows on each side. If the saved patch does not cover the selection, the export uses clearly labelled captured source lines instead. It never reads current working files for this context. After a successful copy, the copy icon changes to a checkmark briefly. Copying does not delete comments. Paste the text into the agent that should handle it.

Use **Clear** next to **Copy comments**, then **Confirm clear**, to remove comments from this review across its targets. Other saved reviews are unchanged. If comments changed after the confirmation was opened, med rejects the stale clear request. Clearing comments does not delete the captured review or change source files.

After an agent revises the code, create a new review link for the new comparison. The previous link and comments retain their original context.

## Agent skill

`med skills install` writes a Med skill for Claude Code (`~/.claude/skills/med`)
and Codex (`~/.agents/skills/med`). The skill is a short version of this guide.
An agent reads it only when it hands off changes, so it costs little context.
With the skill installed, AGENTS.md needs no Med guidance. `med skills show`
prints it; `med skills uninstall` removes it. Run `med skills install` again
after an update.

## Suggested AGENTS.md guidance

For agents without skills, add guidance to AGENTS.md instead.

**Confirm this workflow and its repository scope with the user before adding this guidance to their AGENTS.md.** Reading this documentation is not authorization to edit that file. Adapt the executable path and connection settings to the user's installation.

Suggested text:

```markdown
When handing off code changes, provide a med review link if the user's med host is running.

- At the start, record the relevant repositories/worktrees, starting commit IDs, and any pre-existing changes.
- Use `node /path/to/workbench/apps/med/dist/cli.js review repos` to discover the user's registered review scope.
- Match the task's actual working directories to that list. Include only repositories changed for this task. Do not include every registered repository.
- For work directly on `main`, use the recorded pre-task commit and completed commit as exact before/after endpoints. Comparing `main` with `HEAD` after committing on `main` would be empty. For uncommitted work, use `--working` and explain any pre-existing changes included in the snapshot.
- For a feature review, use that repository's intended base branch (`main`, `develop`, or another agreed ref). Use `--base <branch> --head HEAD --merge-base` to exclude changes made only on the base branch. For stacked changes, use the previous feature branch as the base. Recalculate after merging the base branch and create a new link. Do not guess the same base for every repository or fetch without authorization.
- Use a `--title` of 2–4 words that names what the task builds; the workspace list is narrow. Once a PR exists, Med shows its title in the review header. Supply `--pr` when known; do not invent a PR URL.
- Use `review create` for one target, or `review create --manifest` for several repositories or comparisons. Include its Markdown link in the final response.
- Pass `--key <branch-or-task-name>` and reuse it for later rounds of the same task, so the user keeps one workspace. After opening a PR, run `review update --key <name> --pr <url>`.
- Pass the final explanation with `--brief -` when it cites changed lines. Write links as `[label](repo-relative/path:line)` or `path:start-end`.
- Do not commit, switch branches, add unrelated repositories, or edit AGENTS.md just to generate a link. Follow the user's authorization for those actions.
- If the host is unavailable or a relevant repository is missing, state what is needed. Do not invent a URL or print the host's access token.
- Treat pasted review comments as scoped to its named repositories and captured comparison. Check current source before applying it; line numbers may have changed.
```

## Limits

Saved reviews are local to the machine running med. A localhost link will not open the same review on another person's computer. Managed source registration is persistent; saved review records and comments are persistent. Clear comments when they are no longer needed.

One review can start with up to 16 targets and retain up to 128 captures in total, including other comparisons where comments were added. Capture is bounded to 500 changed files and 24 MiB of patch/source content per target. The store permits 64 MiB per saved record, 128 records, 512 MiB total saved data, and 500 comments per review. Comment export is limited to 8 MiB. It reports an error instead of truncating comments; narrow selected line ranges or remove unneeded comments before copying. A capture limit produces an error; narrow the comparison. Binary or oversized files retain diff metadata but cannot supply text context for comments. There is no automatic deletion of old saved reviews.

## Link to a current file

For a current file, including files outside registered repositories, use:

```sh
node /path/to/workbench/apps/med/dist/cli.js open /absolute/path/Example.java --line 42 --column 8
```

The running host validates the file and the command prints an encoded Markdown
link. Writable files open in Vim Normal mode; `--edit` remains compatible but is no
longer required. Opening a link does not edit the file or register its parent
directory. The link opens live disk content; use
`review create` for a captured comparison. Dropped previews cannot supply disk
links because the browser does not supply their absolute paths.

If the user confirms adding med guidance to AGENTS.md, include this distinction:
provide a review link for changes and a file link for a specific current file or
line. Use only task-relevant paths. Keep access tokens out of both links.

For Markdown, **Preview** opens a live rendered pane beside the source. The
preference persists in the browser. An `open /absolute/path/note.md --edit` link
opens the Vim editor; the user can choose Preview without changing the URL.
Draft text appears in the preview before it is saved. Use `:w` or **Save** to
write it to disk. Browser reload does not retain unsaved drafts.

Markdown uses GFM paragraph rules: a single newline is a soft break within a
paragraph; a blank line starts another paragraph. Use fenced `mermaid` blocks
for diagrams, `$…$` for inline math, and `$$` blocks for display math. Fenced
code uses Med's syntax colors. Relative image paths resolve from the document:
standalone files permit images in the same folder or its descendants; repository
files permit images within that repository and use the displayed commit when
applicable. Do not add secrets or unrelated paths to image references. Dropped
Markdown cannot resolve local images because the browser does not supply a disk
path; open the original file by path for that use. HTTPS images can render in
both modes. Raw HTML is not executed.

A complete sample is `apps/med/docs/examples/reading-queue.md`. To hand it off:

```sh
node /path/to/workbench/apps/med/dist/cli.js open \
  /path/to/workbench/apps/med/docs/examples/reading-queue.md --edit
```

Toggle Markdown Preview with **Cmd+Shift+V** on macOS or **Ctrl+Shift+V** on
Windows/Linux from anywhere in the app while a Markdown file is active. The toolbar button
shows the shortcut on hover. Contents and heading links scroll only the preview.
Source scrolling follows fractional line positions with continuous interpolation
and a short ease-out; reduced-motion mode moves directly to the target.

## Saved source registration and offline guides

`med add /path/to/repo` registers a repository with the running managed server,
starting it when needed. `med web` opens the saved sources. `med list` shows
repositories and vaults; `med review repos` remains the authority for the active
Git review scope. Include only sources changed for the current task.

`med add /path/to/vault` detects `.obsidian`; use `--type vault` for a plain
Markdown folder. The server watches links and provides browser backlinks and
image embeds. Ask the user before registering extra repositories or vaults.
Do not register a private vault merely to benchmark: use a copy outside Git and
keep its content and index out of source control. See [vault commands](VAULTS.md).

`med docs agents`, `med docs usage`, and `med docs vaults` print embedded guides
without a server. Confirm the user's workflow and source scope before adding
these instructions to their AGENTS.md. Never include launch tokens in links.

### Review totals

The saved-review bar shows **Review +/−** for all original targets, using their
captured comparison endpoints. It stays fixed when browsing individual commits
or adding comments there. The diff toolbar shows the currently selected
comparison's totals. Multiple targets are summed as comparisons; overlapping
targets can count the same line more than once. For PRs and stacked changes, use
the intended base branch with `--merge-base` so merged upstream work is excluded.
These totals count added/deleted text lines, not binary file size.
