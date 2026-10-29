# Agent reviews

An agent hands off its changes as a review in Med. You read its guide and its
diff, comment on lines, and send the comments back. A review can hold comparisons from
several repositories, and it stays on your machine.

## Set up

`med skills install` gives Claude Code and Codex the Med skill: a short
hand-off checklist (`SKILL.md`) and this guide's agent part (`guide.md`,
which `med docs agents` prints). Threads that Med starts need a few lines in
CLAUDE.md or AGENTS.md; see [set up agents](USAGE.md#set-up-agents). This page
is the full reference (`med docs reference`).

### A Med of your own

An agent that must not change the user's Med, such as one that tests a
review, runs its own with another state folder:

```sh
MED_STATE_DIR=/tmp/med-trial med web --no-open
MED_STATE_DIR=/tmp/med-trial med add ~/code/my-app
```

Its server never takes port 6330, the port of `~/.local/state/med`: without
`--port` or `MED_PORT`, it takes a free port and says which. Each command with
the same `--state-dir` or `MED_STATE_DIR` finds that server, and the commands
that Med prints carry `--port` and `--state-dir`. It lists only its own
threads; the palette's **Show sessions not kept in Med** shows the others.

## Choose the repositories

```sh
med review repos                      # one line per repository
med review repos --repo <checkout>    # is this checkout registered?
med review repos --json               # every branch and worktree
```

This lists the repositories that the user registered, one per line: the name,
the path, the main checkout's branch, and the number of linked worktrees. It
is the scope that reviews can use, not a list to include in full. `--repo`
says whether Med knows the checkout that holds a path, as a worktree of which
repository, or prints the `med add` line to ask the user about. `--json`
prints every branch and worktree, which is long for a large repository. An
agent compares the list with its task, its working directory and Git root, its
worktree paths, and the files that it changed, and includes only the
repositories that the task changed.
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
resolves both ends to commits and captures the comparison; it does not switch
branches, stage files, or commit. A comparison with no changes is refused,
and the error names the comparison that holds the work: on `main`, after a
session's commits, `--base HEAD~N`.

### Titles and pull requests

`--title` names the review in the workspace list and the browser tab. The list
is narrow, so use 2–4 words that name what the task builds, such as "Commit tab
search" or "Parser recovery". Leave out the repository's name and words such as
"review" and "changes". Keep the same title for each version. A title that
breaks these rules gets a warning with the `med review update --title`
command.

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
brief become current. Earlier versions stay in the version menu, and comments
stay on their comparisons. Keys use letters, digits, and
`. / @ : + # _ -`. Without `--key`, `create` uses the branch's name, when the
branch is not the repository's base branch, and prints it. `update --key`
also takes the review's ID (`r_…`).

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
[agent sessions](SESSIONS.md).

- Claude Code sets `CLAUDE_CODE_SESSION_ID`, and `review create` records that
  session by itself.
- A subagent has its parent's `CLAUDE_CODE_SESSION_ID`. Med looks for the
  command's call in the session's transcripts: when a subagent runs the
  command, or when Med cannot tell which agent runs it, Med records no
  session and says why. The review then has no Session pane, and Med prints
  no `med review wait` line, because nothing would send the subagent a
  message. `--session claude:<id>` records a session by hand; `med thread
show` in a subagent needs `--key`.
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
paths that match no changed file, comments outside their segment's files, and
segments of lockfiles or generated files before other segments.

```text
Guide check: put every changed file in exactly one segment.
- In no segment (Med shows them under "Other changes"): src/lexer.ts
Fix the guide, then run: med review update --key "parser-recovery" --guide <file>
```

To replace the guide of the current version, run
`med review update --key <name> --guide guide.json`. It does not capture the
code again: after you change code, hand off a new version with
`med review create` and the same key. When the checkout moved past the
capture, `update --guide` says so and prints that command. A later version
without a guide keeps the one before it. [The Guide](USAGE.md#the-guide) says
what the reader sees.

### Attach a brief

A brief is Markdown that Med keeps with the version. The Overview shows its
Proof, Findings, and Explainer sections (below); Med keeps the rest of its text
but no longer shows it ([Removed: Notes](USAGE.md#removed-notes)). Cite code
with repository-relative links that end in line numbers:

```markdown
The parser now rejects empty input ([parse.ts:42-58](src/parse.ts:42-58)).
The tests cover both cases in [parse.test.ts:12](tests/parse.test.ts:12).
```

Pass it with `--brief`, as a file or as `-` for standard input:

```sh
med review create --title "Fix the parser" --repo ~/code/parser \
  --base "$start" --head HEAD --brief brief.md
```

Cite the files that need attention; the reviewer reads the rest in Changes.

Links can be `path:line`, `path:start-end`, `path#Lstart-Lend`, absolute paths
in the repository, and GitHub blob URLs. With `--manifest`, links resolve
against the open target. A brief holds up to 100,000 characters.

Med reads these sections of a brief, a pinned reply, or the guide's summary,
and shows them on the Overview
([proof, findings, and later versions](USAGE.md#proof-findings-and-later-versions)):

```markdown
## Proof

- `bun run test`: 42 passed
- Screenshot: /tmp/shots/retry.png

### Not covered

- Safari

## Findings

- Important `src/http.ts:42` Retry ignores the abort signal. Fixed: the signal goes to each attempt.
- Nit `src/util.ts:3` Rename `t`. Won't fix: matches the upstream name.

## Generated

- `src/api/client/**`
```

Headings such as Checks, Tests, or Verification also mark proof; `[P1]`-style
tags read as Important (P0–P1) or Nit (P2–P3). Globs under Generated join
`--generated`.

### Draft a pull request

When the user asks for a pull request, draft its description in Med first.
Med shows the draft rendered, the user comments on it as on a brief, and
only the user opens the pull request, with **Create** in Med:

```sh
med pr template --repo ~/code/parser      # the repository's templates, each under its path
med pr draft --key fix/parser --file pr.md
```

- Fill the template that `med pr template` prints, such as
  `.github/pull_request_template.md` or a file of
  `.github/PULL_REQUEST_TEMPLATE/`. Without one, say why, what changed, and
  how you checked it. Leave out sections that do not apply.
- The file's first line, `# <title>`, is the pull request's title, unless
  `--title` gives one. `--base` names the branch to merge into; without it,
  gh uses the repository's default branch. `--repo` names the checkout
  (default: `MED_THREAD_REPO`, or the current one).
- Images can be local PNG, JPEG, GIF, or WebP files, relative to the file
  (`![Retry chart](shots/retry.png)`), or https links. Med keeps a copy of
  each local one, up to 8 images of 5 MB.
- Comments on the draft come back as the user's other comments do, marked
  `On: the pull request draft`. Revise the file and run `med pr draft` again
  with the same key: each run is the next revision.
- Never run `gh pr create` yourself. **Create** runs it from the checkout's
  branch, which must be on GitHub with all of its commits, and links the pull request to the
  review. GitHub takes images only as links, so a local image stays out of
  the body and the text names it, for the user to add on GitHub.

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
When `--base` has commits that `--head` does not have and neither
`--merge-base` nor `--no-merge-base` is given, `create` uses the merge base
and says so; `--no-merge-base` compares the two tips. In a manifest, set
`"mergeBase": true`; a manifest without it gets a warning.

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
and ask the user when the scope is unclear. After a `--working` hand-off
without `--paths`, Med names the changed files that the session's transcript
never edited, with the `update --paths` command for the others. Files that a
command wrote, such as a formatter's, count as not edited. A clean checkout is
refused.

```sh
med review create --title "Navigation draft" --repo ~/code/my-app --working \
  --paths src/nav.ts src/nav/
```

`--paths` takes files and folders, relative to the current folder or
absolute, and it also limits a range (`--base`, `--head`). Each name must be
in the repository. `med review update --key <name> --paths …` adds a new
version of the working changes with those paths.

### Mark generated files

Med folds lockfiles, build output, snapshots, and files with a "generated"
header after the other files, out of the line totals
([generated files](GENERATED.md)). For other files that a tool wrote, such as
a client from a code generator, name them with `--generated`:

```sh
med review create --title "API client" --repo ~/code/my-app --working \
  --generated 'src/api/client/' 'src/**/*.pb.ts'
```

`--generated` takes files, folders (ending in `/`), and globs, as a guide
names files; quote globs. `med review update --paths` and `med thread show`
take it too. It marks files of that version only. A file that the
repository's Git attributes unmark (`-linguist-generated`) stays unmarked.

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
med review create --manifest - < review.json
```

A manifest takes commit, range, working, staged, and unstaged comparisons;
patches and file pairs cannot be saved. `--manifest -` reads it from standard
input, so it needs no file; put the guide in it as `"guide"`. Keep a written
manifest out of the reviewed changes unless it belongs to the project. `med review create --help`
lists every option.

### Stacks and sets

Related pull requests or branches are one thread. `--stack` names them
bottom first; each is a layer, diffed against the layer below. A pull request
(a number such as `101`, `#101`, or its URL) is read with `gh` and is its own
diff, from the merge base with its base commit; a head that is not local is
fetched as `refs/pull/<n>/head`, never checked out. A branch is its changes
since the layer below; the bottom branch's since `--base` (the repository's
base branch by default). `--set` makes parts that do not depend on each other,
each since its own base.

```sh
med review create --repo . --title "Parser rewrite" --stack 101 102 103 104
med review create --repo . --stack parse-tokens build-ast typecheck --base main
med review create --repo . --set fix-docs fix-cli --guide guides.json
```

`--guide` takes a JSON array with a guide, or `null`, for each part. Each
part's pull request URL or branch is its key: `med review create --key <key>`
with one comparison hands off that part again, as a new version in which the
other parts keep their comparisons and comments; `med review update --key
<key> --guide -` sets its guide. A hand-off of one range joins an open thread
as its next layer when its base is that thread's top head and the same session
made both, or both are pull requests; the command then prints `Added layer N
of M`. See [stacks and sets](STACKS.md).

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

## Checks

`med review create` and `update` check the hand-off and print the next step.
Two cases refuse, because they cannot make a right review; the others warn
after the review is saved.

| Case                                                             | What Med does                                                                                                      |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `--repo` names a folder inside a repository                      | Uses the repository's root                                                                                         |
| The repository is not registered                                 | Refuses: ask the user, then `med add <root>`                                                                       |
| The comparison has no changes                                    | Refuses, and names the comparison that holds the work                                                              |
| `--base` has commits that `--head` lacks                         | Compares from the merge base; `--no-merge-base` keeps the tips                                                     |
| No `--key`, on a branch other than the base                      | Uses the branch as the key and prints it; `<repository>/<branch>` when a review of another repository has that key |
| The title is not 2–4 words, or names the repository              | Prints `med review update --title`                                                                                 |
| `--working` without `--paths` has files the session never edited | Names them and prints `med review update --paths` with the session's files                                         |
| `update --guide` after the checkout moved on                     | Prints `med review create` for the next version                                                                    |
| The guide puts lockfiles or generated files first                | The guide check names the segments                                                                                 |
| A Claude Code session outside a Med thread                       | Prints the `med review wait --key` line                                                                            |
| A subagent runs the command, or Med cannot tell                  | Records no session, says why, and prints no `med review wait` line                                                 |
| `review wait` outside Claude Code, as in Codex, or in a subagent | Fails at once: nothing would send it a message                                                                     |
| `review wait` in a Claude Code session that the review lacks     | Adds the session to the review, as `update --session` does, and says so                                            |
| `--port` or `--state-dir` is not the default                     | Each printed command carries them, so it reaches the same Med                                                      |

Med suggests review practices and enforces none by default. A repository can
opt in, so that `med review create` refuses a hand-off that lacks them and says
what to add; nothing is captured until it passes:

```sh
git config med.checks proof,explainer,findings   # any of the three
git config --unset-all med.checks                # off again
```

- `proof`: the brief has a Proof section with at least one check.
- `explainer`: the guide's summary or the brief explains the change.
- `findings`: no Important finding is left open.

`med skills suggest` lists the practices as small skills to copy
([review practices](PRACTICES.md#d-suggestion-pack)).

## AGENTS.md guidance

For agents without skills, add guidance to AGENTS.md instead. Confirm the
workflow and its repositories with the user before you add it. Adapt the
commands to their setup.

```markdown
When you hand off code changes, give a Med review link if Med is running.

- Run `med review repos` for the registered repositories, or `med review repos --repo <checkout>` for one. Include only the repositories that this task changed; if one is missing, ask the user before `med add`.
- Make one review per task: pass `--key` with the branch or task name, and reuse it every round. After you apply review comments, run `med review create` again with that key; `med review update --guide` only replaces the guide.
- Uncommitted work: `--working`, with `--paths` in a shared checkout. Commits on `main`: `--base <commit before your work> --head HEAD`. A feature branch: `--base main --head HEAD --merge-base`. Several repositories: `--manifest`.
- Use a `--title` of 2–4 words that names what the task builds. Pass a guide with `--guide -` (see `med docs agents`).
- Put the printed Markdown link in your final message, and act on the advice that the command prints. Never invent a URL or print Med's access token.
- After you open a pull request, run `med review update --key <name> --pr <url>`.
- Review comments refer to the captured comparison. Check the current source before you apply them.
```
