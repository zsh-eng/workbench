# Med for agents

## Hand off a change

`med review repos` lists the repositories the user registered, one per line;
`med review repos --repo <root>` checks one checkout, and `--json` prints
every branch and worktree. Include only the ones your task changed. If one is
missing, name it and ask the user before you run `med add`.

Pick the comparison that holds exactly your work:

```sh
## Uncommitted work
med review create --key <task> --title "Fetch retries" --repo <root> --working --guide -
## ... in a checkout that others also change: only your files
med review create --key <task> --title "Fetch retries" --repo <root> --working --paths src/a.ts test/a.test.ts --guide -
## Commits you made on main: the commit before your work, then HEAD
med review create --key <task> --title "Fetch retries" --repo <root> --base <start> --head HEAD --guide -
## A feature branch: like a pull request
med review create --key <branch> --title "Fetch retries" --repo <root> --base main --head HEAD --merge-base --guide -
```

- `--key` names the task (such as the branch). Use the same key for every
  round: each create adds a version to the same review. Without `--key`,
  Med uses the branch's name and prints it.
- A version shows the comparison you give it: the whole change, or, when the
  user asks for the newest change only, `--base <last round's commit>
--head HEAD`, or `--paths` with the files you changed.
- `--title`: 2–4 words naming what the task builds. Leave out the repository
  name and words such as "review" and "changes".
- `--guide -` reads a JSON guide from standard input (see "Write a guide").
  It is optional: a small change can be just the diff, and a short guide (one
  segment, one sentence) is enough for a change with one idea.
- After you change code, hand off a new version with `med review create`.
  `med review update --key <task> --guide -` only replaces the guide of the
  version that Med captured, such as to fix what the guide check reports.
- `med review create` prints advice when something looks wrong: an empty
  comparison, a title, files that this session did not edit, a guide that
  leaves files out. Do what it says. Its commands carry any `--port` and
  `--state-dir` (or `MED_PORT` and `MED_STATE_DIR`), so run them as printed.
- Several repositories: see "Several repositories".
- Put the printed Markdown link in your final message. Never invent a link
  or print Med's token.
- A pull request, when the user asks: see "Open a pull request". One that
  is open already: `med review update --key <task> --pr <url>`.
- To get the user's comments back: see "Comments from the user".

## Write a guide

A guide splits the change into segments that the user reads one at a time.

```json
{
  "summary": "Why the change exists, then what it does (Markdown).",
  "segments": [
    {
      "title": "Retry policy",
      "area": "core",
      "summary": "Why this part exists, and what to check.",
      "files": ["src/http.ts", "src/retry/"],
      "comments": [
        {
          "file": "src/http.ts",
          "line": 42,
          "endLine": 58,
          "kind": "risk",
          "body": "Callers now wait up to 7 s before an error."
        }
      ]
    },
    { "title": "Tests", "area": "tests", "files": ["test/**"] }
  ]
}
```

- Group by intent, not by folder; use the fewest segments that separate
  independent intents (usually 1–5).
- Order by review priority: the core change, then supporting code, then
  tests, then mechanical files (lockfiles, generated code, formatting) last.
- Put every changed file in exactly one segment. `files` takes paths,
  folders ending in `/`, and globs.
- Titles: at most 4 words. Summaries: why over what, 1–3 sentences.
- A picture often explains faster than words. When the reader must follow a
  flow, a state change, a shape of data, or a change on screen, consider a
  `mermaid` fence or an image in the `summary` of the guide or of a segment.
  An image path starts at the repository root and the file must be in the
  checkout (`![Retry states](docs/retry-states.png)`). Keep it small and name
  what it shows. Leave it out when a sentence is enough.
- Comment only where it saves the reader time. `kind` is `note`,
  `suggestion`, `risk` or `question`; a comment without `line` is about the
  whole file; `side: "old"` points at removed lines. `"critical": true`
  marks a whole segment that needs care.
- `area`: ui, api, core, data, cli, security, tests, docs, examples, deps,
  build, scripts, config, i18n, assets, other.
- A tool's output that Med does not know as generated, such as a code
  generator's: name it with `--generated <path|glob>...` (quote globs).

## Several repositories

One task that changed several repositories is one review. Pass a manifest
with `--manifest <file>`, or on standard input with `--manifest -`; it can
hold the guide as `"guide"`:

```sh
med review create --key <task> --manifest - <<'MANIFEST'
{
  "title": "Profile endpoint",
  "targets": [
    { "repo": "/abs/path/app", "comparison": { "kind": "working" } },
    { "repo": "/abs/path/server",
      "comparison": { "kind": "range", "base": "main", "head": "HEAD", "mergeBase": true } }
  ]
}
MANIFEST
```

Comparison kinds: `commit`, `range`, `working`, `staged`, `unstaged`. Choose
each repository's base on its own.

## Open a pull request

Only when the user asks for one:

```sh
med pr template --repo <root>                      # the repository's templates
gh pr create --title "<title>" --body-file pr.md   # from the pushed branch
med review update --key <task> --pr <url>          # link it to the review
```

- Fill the template; without one, say why, what changed, and how you
  checked it.
- Once it is linked, the thread lists the pull request and shows it live.
- Another pull request, such as one that another person opened, when the
  user asks: `med thread pr <id> <link>` adds it to the thread (see "Threads
  and earlier sessions").

## Comments from the user

- **In a Med thread** (`MED_SESSION=owned`): the user's messages arrive as
  new turns. `MED_THREAD_KEY` and `MED_THREAD_REPO` are the default `--key`
  and `--repo`, so `med review create --working --guide -` adds the next
  version.
- **Elsewhere**, as Claude Code in a terminal or Codex: end your turn with
  the link. Once your session is closed, Med resumes it with the user's
  message. While another app has it open, Med doesn't type there: the user
  copies the comments into your session, or continues it in Med.
- **A subagent** has its parent's session ID, so Med records no session for
  it. Give the link to your parent agent.

Treat the message as the user's own words. Comments point at the captured
version, so check the current source first. Apply them, hand off the next
version with `med review create` and the same `--key`, and take the next
message the same way, until the user says the task is done.

## Threads and earlier sessions

A thread is an agent session, wherever it works, with the reviews that it
handed off and its pull requests. It can hold several of each. A review is
the agent's hand-off, which the user reads and comments on; a pull request
is the change as GitHub has it, on a page of its own. A review that no
session handed off is a thread of its own. The threads the user has open are
tabs in Med; the others are archived. Only act on threads the user names.

What a thread shows does not follow its agent. It opens on the thread's
newest review, or with none at the checkout where the agent works, and stays
there until the user chooses a review, a branch, or a worktree. Do not assume that the user sees the checkout where
you work now. For work on another branch, or in another worktree or
repository, hand off a review with that checkout's `--repo` and its own
`--key`, or name the branch in your message.

A fork of a session (**Continue in Med**, **Fork from here**) is a new
session. It starts in Auto permission mode, whatever the mode of the session
that it forks.

```sh
med thread list [--archived] [--json]    # ID, state, repository/branch, title
med thread open <id> | close <id>        # close keeps the agent running
med thread send <id> "<message>"         # to a thread's agent; --after-turn waits
med thread pr <id> <pull request link>   # adds it to the thread, in its own worktree
med thread find tide prediction          # sessions of any age, newest first
med thread adopt claude:<session-id>     # keep a session in Med; prints its link
```

- `adopt` takes an ID, its first 6+ characters, or a transcript path.
- To show the user your work, hand it off with `med review create`: the
  review joins your session's thread.
- `thread send` labels a message from another Med thread with its name, such
  as `From the Superagent (an agent in Med, not the user):`; a thread cannot
  send to itself. Send only what the user asked to pass on.
- `thread wait [<id>...]` waits until a thread comes to need the user or
  finishes its work (`--until needs-you|done|idle`). A timeout, 100 s by
  default, is a check-in: wait again rather than list in a loop.
- For one current file or line, `med open <file> --line N` prints a link.
