---
name: med
description: Hand off code changes for review in Med, the user's local review app (the `med` command), and act on the comments that come back. Use when you finish a change, or a round of one, in a Git repository, or when the user mentions Med.
---

# Hand off changes in Med

Med shows your change to the user as a review. They comment on lines and send
the comments back to you.

1. Make one review per task. Use the same `--key` (such as the branch) for
   every round: each `med review create` adds a version.
2. Attach a guide with `--guide -` (below).
3. After you apply the user's comments, hand off again with
   `med review create` and the same key. `med review update --guide` only
   replaces the guide of a version that Med already captured.
4. Run `med review wait` only when `med review create` printed its line
   (Claude Code outside Med): run it as printed, as a background command;
   its output is the user's message. Everywhere else, end your turn with the
   link: in a Med thread (`MED_SESSION=owned`) the user's messages arrive as
   new turns, Codex reads them from its queue at its next turn, and a
   subagent gives the link to its parent agent.
5. Put the printed link in your final message. Never invent a link or print
   Med's token.
6. If `med review repos --repo <root>` says that a repository you changed is
   not registered, name it and ask the user before you run `med add`.
7. Act on the advice that `med review` prints, such as a guide check, and run
   its commands as printed: they carry any `--port` and `--state-dir`.

## Create the review

Include only the repositories that your task changed. The `--title` has 2–4
words naming what the task builds. Pick the comparison that holds exactly
your work:

- uncommitted work: `--working`; in a checkout that others also change, add
  `--paths <your files>`;
- commits on main: `--base <commit before your work> --head HEAD`;
- a feature branch: `--base main --head HEAD --merge-base`;
- stacked branches or pull requests: one review with
  `--stack <bottom> ... <top>` (`--set` for independent parts), and `--guide`
  takes a JSON array, one guide or `null` per part;
- several repositories: one review from `--manifest <file|->`
  (`med docs agents` shows the format).

```sh
med review create --key feat/retry --title "Fetch retries" \
  --repo <root> --working --guide - <<'GUIDE'
{"summary": "Why, then what.", "segments": [
  {"title": "Retry policy", "area": "core", "summary": "Why this part.",
   "files": ["src/http.ts"],
   "comments": [{"file": "src/http.ts", "line": 42, "kind": "risk",
                 "body": "Callers now wait up to 7 s."}]},
  {"title": "Tests", "area": "tests", "files": ["test/**"]}]}
GUIDE
```

The guide: group by intent; use the fewest segments (usually 1–5); order
core change, supporting code, tests, then lockfiles, generated files and
formatting last; put every changed file in exactly one segment; summaries say
why in 1–3 sentences; comment only where it saves the reader time (`kind`:
note, suggestion, risk, question). To fix what the guide check reports for
the version that you just made: `med review update --key <key> --guide -`.

## Draft a pull request

When the user asks for a pull request, do not run `gh pr create`. Run
`med pr template --repo <root>`, fill the template in a Markdown file whose
first line is `# <title>`, with images as local files beside it or https
links, and run `med pr draft --key <key> --file <file>`. The user comments
on the draft in Med; revise the file and run it again. The user opens the
pull request with Create in Med. `med docs agents` has the details.

After a pull request is open elsewhere: `med review update --key <key> --pr <url>`.

## When comments come back

In a Med thread, `MED_THREAD_KEY` and `MED_THREAD_REPO` are the default
`--key` and `--repo`. Comments point at the captured version, so check the
current source first. Apply them and hand off the next version with
`med review create` and the same key, as step 4 says, until the user says the
task is done.

## Threads and sessions

`med thread list | open | close`, and `med thread find` / `adopt` to bring an
earlier session into Med (`med thread --help`). Act only on threads the user
names. `med docs agents` is the full guide.
