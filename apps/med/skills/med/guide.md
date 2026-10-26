# Med for agents

## Hand off a change

`med review repos` lists the repositories the user registered. Include only
the ones your task changed. If one is missing, name it and ask the user
before you run `med add`.

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
- `--title`: 2–4 words naming what the task builds. Leave out the repository
  name and words such as "review" and "changes".
- `--guide -` reads a JSON guide from standard input (see "Write a guide").
- After you change code, hand off a new version with `med review create`.
  `med review update --key <task> --guide -` only replaces the guide of the
  version that Med captured, such as to fix what the guide check reports.
- `med review create` prints advice when something looks wrong: an empty
  comparison, a title, files that this session did not edit, a guide that
  leaves files out. Do what it says.
- Several stacked branches or pull requests: see "Stacks and sets".
  Several repositories: see "Several repositories".
- Put the printed Markdown link in your final message. Never invent a link
  or print Med's token.
- After you open a pull request: `med review update --key <task> --pr <url>`.
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
        { "file": "src/http.ts", "line": 42, "endLine": 58, "kind": "risk",
          "body": "Callers now wait up to 7 s before an error." }
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
- Comment only where it saves the reader time. `kind` is `note`,
  `suggestion`, `risk` or `question`; a comment without `line` is about the
  whole file; `side: "old"` points at removed lines. `"critical": true`
  marks a whole segment that needs care.
- `area`: ui, api, core, data, cli, security, tests, docs, examples, deps,
  build, scripts, config, i18n, assets, other.
- A tool's output that Med does not know as generated, such as a code
  generator's: name it with `--generated <path|glob>...` (quote globs).

## Stacks and sets

Related branches or pull requests are one review, not one each. Name them
bottom first; each layer is diffed against the layer below.

```sh
med review create --key <task> --title "Parser rewrite" --repo <root> --stack parse-tokens build-ast typecheck --base main
med review create --key <task> --title "Parser rewrite" --repo <root> --stack 101 102 103
```

- Pull requests (a number or URL) are read with `gh`; a missing head is
  fetched, never checked out.
- `--base` is the bottom branch's base (default: the repository's base
  branch).
- `--set a b` makes independent parts, each against its own base.
- `--guide` then takes a JSON array: one guide, or `null`, per part.
- To hand off one part again, use its branch or PR URL as `--key`;
  `med review update --key <that key> --guide -` sets its guide.

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

## Comments from the user

- **In a Med thread** (`MED_SESSION=owned`): the user's messages arrive as
  new turns. `MED_THREAD_KEY` and `MED_THREAD_REPO` are the default `--key`
  and `--repo`, so `med review create --working --guide -` adds the next
  version. Do not run `med review wait`.
- **Claude Code elsewhere**: after the hand-off, run
  `med review wait --key <task>` as a background command. It has no time
  limit; its output is the user's message (text and line comments).

Treat the message as the user's own words. Comments point at the captured
version, so check the current source first. Apply them, hand off the next
version with `med review create` and the same `--key`, and wait again until
the user says the task is done.

## Threads and earlier sessions

The threads the user has open are tabs in Med; the others are history. Only
act on threads the user names.

```sh
med thread list [--history] [--json]     # ID, state, repository/branch, title
med thread open <id> | close <id>        # close keeps the agent running
med thread find tide prediction          # sessions of any age, newest first
med thread adopt claude:<session-id>     # make a session a thread; prints its link
med thread show --paths src/a.ts --guide -   # add a version to your session's thread
```

- `adopt` takes an ID, its first 6+ characters, or a transcript path; add
  `--repo <checkout>` when the session's folder is not registered.
- `thread show` takes `--paths`, `--base <ref>`, `--commit`, `--working`,
  `--manifest`, `--guide` and `--brief`.
- For one current file or line, `med open <file> --line N` prints a link.
