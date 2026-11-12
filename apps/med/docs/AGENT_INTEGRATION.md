# Agent reviews

An agent hands off its changes as a review in Med. You read its guide and its
diff, comment on lines, and send the comments back. A review can hold comparisons from
several repositories, and it stays on your machine. [The words](USAGE.md#the-words)
defines the words that Med uses, such as hand-off, key, and guide.

## Set up

`med skills install` gives Claude Code and Codex the Med skill. It is a short
`SKILL.md` that runs `med skills show`, which prints the hand-off checklist of
the installed Med; `med docs agents` prints this guide's agent part.
`med skills status` says if an agent's skill is out of date. Threads that Med starts need a few lines in
CLAUDE.md or AGENTS.md; see [set up agents](usage/saved-reviews.md#set-up-agents). This page
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
that Med prints carry `--port` and `--state-dir`. It keeps its settings in
`settings.json` in that folder, and does not pull base branches. It lists only its own
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

With `--json`, the command prints one JSON object instead: the review's `id`,
`key`, `version`, `url`, and `title`; `layer` when it joined a stack; `notes`, the lines that
it prints after the link; and `advice`, the lines that it otherwise writes to
standard error. The `url` has no access token.

A failed command exits with 2 for wrong usage, 3 when the review, thread, or
source that it names does not exist, and 4 when no Med server runs for it.
Other failures exit with 1.

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
guide become current. The Review opens on what is new since the user last
looked; earlier versions stay as snapshots, and comments stay on their
comparisons. Keys use letters, digits, and
`. / @ : + # _ -`. Without `--key`, `create` uses the branch's name, when the
branch is not the repository's base branch, and prints it. `update --key`
also takes the review's ID (`r_…`).

A version shows the comparison that you give it, so choose what the reader
needs. Usually that is the whole task's change, from the same base each
round. When the user asks for only the newest change, or a round reads better
alone, compare from the commit that the last round ended on
(`--base <commit> --head HEAD`), or show only the files that you changed this
round (`--working --paths <files>`). A review can be part of a change.

```sh
med review create --key feat/parser --title "Parser recovery" \
  --repo ~/code/parser --base origin/main --head HEAD --merge-base --guide -
```

After you open the pull request, link it to the review:

```sh
med review update --key feat/parser --pr https://github.com/owner/repository/pull/123
```

The next `review create` with the key also finds a matching pull request by
itself. While a thread is an open tab, Med also links the first open pull
request from its branch that `gh pr list --head <branch>` finds.

### Link your session

A review is linked to the agent session that handed it off, and is listed in
that session's thread. The thread's Session pane shows the agent's
conversation, read from the transcript and followed live; see
[agent sessions](SESSIONS.md).

- Claude Code sets `CLAUDE_CODE_SESSION_ID`, and `review create` links that
  session by itself.
- A subagent has its parent's `CLAUDE_CODE_SESSION_ID`. Med looks for the
  command's call in the session's transcripts: when a subagent runs the
  command, or when Med cannot tell which agent runs it, Med links no
  session and says why. The review is then a thread of its own, because
  nothing would send the subagent a message. `--session claude:<id>` links a
  session by hand.
- A Codex session, or another one, needs `--session codex:<id>` or
  `--session claude:<id>`; `review update --key <name> --session …` moves a
  review to that session's thread.
- `--no-session` links no session from the environment.

Med reads a session's folder from its transcript in `~/.claude` or `~/.codex`.
Without a transcript, it uses the command's folder.

### Answer a comment

The user's message gives each comment as a heading with its short ID, the
file and lines, the diff hunk, and the user's words, with the replies under
it:

````markdown
## 6f1c9e · src/summary.ts:14

```diff
@@ -12,3 +12,3 @@
-  return `${ms} ms`;
+  return `${Math.round(ms / 60000)} min`;
```

Round half a minute up.
````

To answer one in its thread, where the user reads it, run `med reply` with
the ID, and the answer on standard input (or after the ID):

```sh
med reply 6f1c9e <<'END'
Minutes drop the seconds. Keep them for runs under a minute?
END
```

The ID is the first 6 characters of the comment's ID, or more when another
comment of the review starts the same way. Med finds the review by the
comment, trying the thread's review first (`MED_THREAD_KEY`); `--key` names
the review when two reviews have such a comment. `med review reply` is the
same command. Med shows the answer under the comment with your agent's name,
as the session that runs the command (or else the review's session).
It does not make the comment unsent, and the next message that holds the
thread shows the answer as yours. A comment on a passage of the guide has no
ID and takes no reply; answer it in your message.
Use a reply for a question the user asked on a line, or to say why you left a
change out; your final message still says what you did.

### Attach a guide

A guide is optional: say only what the change needs. A small change that
explains itself can be just the diff, and a change with one idea needs one
segment with a sentence. A larger change gets a guide that splits it into
segments that the reader checks one at a time.
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
- A picture often explains faster than words. When the reader must follow a
  flow, a state change, a shape of data, or a change on screen, consider a
  `mermaid` fence or an image in a summary. An image path starts at the
  repository root, and the file must be in the checkout
  (`![Retry states](docs/retry-states.png)`). Keep it small, say what it
  shows, and leave it out when a sentence is enough.
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

Pass it with `--guide`, as a file or as `-` for standard input.

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
without a guide keeps the one before it. [The Guide](usage/guide.md) says
what the reader sees.

### Proof, findings, and generated files

The guide's summary is Markdown. Cite code with repository-relative links
that end in line numbers, such as `[parse.ts:42-58](src/parse.ts:42-58)`;
links can be `path:line`, `path:start-end`, `path#Lstart-Lend`, absolute
paths in the repository, and GitHub blob URLs. Med reads these sections of
the summary and shows them on the Overview
([proof, findings, and later hand-offs](usage/guide.md#proof-findings-and-later-hand-offs)):

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

### Open a pull request

Open one only when the user asks. `med pr template --repo <root>` prints the
repository's templates, such as `.github/pull_request_template.md` or a file
of `.github/PULL_REQUEST_TEMPLATE/`, each under its path. Fill it; without
one, say why, what changed, and how you checked it, and leave out sections
that do not apply. Push the branch, open the pull request with `gh pr create`,
and link it to the review:

```sh
med review update --key fix/parser --pr https://github.com/owner/repository/pull/123
```

Once it is linked, the thread shows the pull request live, with its checks
and comments. Med also links a pull request that opens later on the review's
branch, while the thread is a tab.

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
names files; quote globs. `med review update --paths` takes it too. It marks files of that version only. A file that the
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

## Tabs and archived threads

A thread is an agent session, with the reviews that it handed off; a review
that no session handed off is a thread of its own. Its ID is the session's
key, such as `claude-5f0c2a8e-…`, or the review's ID (`r_…`). The threads
that the user has open are tabs, in Med's sidebar. The others are archived:
Med does not watch them. Your session's thread opens as a tab when you hand
off with `med review create`. When the user asks you to open, close, or list
threads, use `med thread`:

```sh
med thread list                          # the tabs: ID, state, repository/branch, title
med thread list --archived               # closed threads and found sessions, newest first
med thread open claude-5f0c…             # opens an archived thread as a tab
med thread close claude-5f0c…            # archives a tab; its agent keeps working
med thread close --key "$MED_THREAD_KEY" --remove-worktree
med thread reopen                        # opens the tab that closed last
med thread delete claude-5f0c…           # deletes the thread with its reviews and their comments
med thread pr claude-5f0c… https://github.com/owner/repo/pull/333
                                         # adds the pull request as one more review of the thread
```

`med thread pr` asks the host to check out the pull request in a worktree of
its own, as a link pasted in Med does, and saves its review in the thread;
`--key` names the thread too. It prints the review's ID and the worktree.
A pull request that is a review of another session's thread stays there.

The lines have tabs between the fields. The state is, as `⌘0` ranks them,
`needs-you` (a permission request, a question, or work that stopped), `done`
(its work finished since the user last looked at it), `working`, or `idle`;
when archived, `closed`. `--json` prints the threads with all their details, and
the state as `attention`. A thread's `turn` tells what the user sees at the end of its session:
when the last turn ended, whether it asked a question, and `checks`, the last
run of each test, type check, linter, or build in the turn, such as
`{ "name": "bun test", "status": "passed", "pass": 5, "fail": 0 }`. Its
`changes` count the files and lines. `--key` names a thread by its review's key. `--remove-worktree` also
removes the linked worktree that Med made for the thread, when Git can do that
without force; the branch stays. Close or delete only the threads that the
user names.

## Wait for other threads

The Superagent, or a script, can wait for other threads' agents instead of
asking `med thread list` again and again. `med thread wait` follows the host's
list of tabs and ends when one of the threads comes to need the user or
finishes its work:

```sh
med thread send claude-5f0c… "Run the tests again."
med thread wait claude-5f0c…             # until it needs the user or finishes
med thread wait --until idle             # until no other tab works
```

Name the threads by ID or `--key`; without them, it waits on every tab but
your own thread. `--until needs-you`, `done`, or `idle` waits for only that;
`idle` means that none of them works. Only a change counts: a thread that
needed the user already does not end the next wait. A message that Med sent
counts as work until the turn that reads it ends, so send, then wait. With no
work under way, the wait ends at once.

It prints why it ended, then each thread's line as `list` prints it; `--json`
gives `ended`, `reason` (`needs-you`, `done`, `idle`, `nothing`, or
`timeout`), and each thread's `state`. `--timeout <seconds>` (default 100,
inside a shell tool's two minutes) ends the wait as a check-in: the first line
says so, and the command exits 0, so wait again to go on. The exit status is 3
when a thread that you name is not a tab, and 4 when no Med runs.

## Find and adopt sessions

Med finds the Claude Code and Codex sessions of the last 7 days in the
registered repositories by itself, also when no agent hands them off
([found sessions](SESSIONS.md#found-sessions)). One whose agent works opens as
a tab; the others are archived (`med thread list --archived`). When the user
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

`med thread adopt <session>` keeps the session in Med, as **Keep in Med**
does: its thread stays in the list however old it gets, and shows the session
and the live Changes of the checkout where it works. It captures nothing; the
thread has a Review once the agent hands one off
([Show work in a thread](#show-work-in-a-thread)). Give the session as
`find` prints it, as an ID or its first 6 or more characters, or as the path
of its transcript. The command prints the thread's ID and a Markdown link; put
the link in your reply.

```sh
med thread adopt claude:2f0c4a91-6b0e-4d55-9a57-1f3e8c2d7b10
# Thread claude-2f0c4a91-…: [Explain the tide prediction model](http://127.0.0.1:6330/review/claude-2f0c4a91-…)
```

- A new thread opens as a tab. A session that a thread holds gives that
  thread, and opens it as a tab when it is archived.
- When no session matches, or more than one does, the command fails and says
  so; for more than one, it lists them.
- A session can work anywhere: one outside the registered repositories is a
  thread too, with no Changes until it works in one. `--title` names the
  thread, and `--open` shows it.

## Show work in a thread

A thread has two views of its work. **Changes** are the checkout's Git
changes as they are now: on a branch, its commits since the base branch and
its uncommitted changes. Med saves nothing for them. **Review** is what the
agent shows the user: each hand-off is a saved version, and comments attach
to the version that they are on.

`med review create` adds a version to a review of your session's thread:
the session that runs the command is linked to the review, so the review
joins its thread. In a Med thread, `MED_THREAD_KEY` is the default key, so
each hand-off is the next version of the thread's review. `--session
codex:<id>` or `claude:<id>` links another session, and `--no-session` none,
which makes the review a thread of its own. A subagent has its parent's
session ID, so Med links no session for it and says why.

`med review update --key <key> --paths …` adds a version of those files'
working changes.

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
[standalone files](usage/edit-files.md#standalone-files-and-dropped-previews).

Markdown files open rendered, and the rendered view shows drafts before they
are saved. Med renders GFM, `mermaid` fences, `$…$` and `$$` math,
and colored code. A blank line starts a paragraph. Relative images resolve
from the document, within its folder or repository; keep secrets and unrelated
paths out of image references. See
[Read and edit Markdown](usage/markdown.md) and the
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
| A subagent runs the command, or Med cannot tell                  | Records no session, and says why                                                                                   |
| `--port` or `--state-dir` is not the default                     | Each printed command carries them, so it reaches the same Med                                                      |

Med suggests review practices and enforces none by default. A repository can
opt in, so that `med review create` refuses a hand-off that lacks them and says
what to add; nothing is captured until it passes:

```sh
git config med.checks proof,explainer,findings   # any of the three
git config --unset-all med.checks                # off again
```

- `proof`: the guide's summary has a Proof section with at least one check.
- `explainer`: the guide's summary explains the change.
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
