---
name: med
description: Hand off code changes for review in Med, the user's local review app (the `med` command), and act on the comments that come back. Use when you finish a change, or a round of one, in a Git repository, or when the user mentions Med.
---

# Hand off changes in Med

Med shows your change to the user as a review. They comment on lines and send
the comments back to you.

1. Make one review per task. Use the same `--key` (such as the branch) for
   every round: each `med review create` adds a version.
2. Each version shows the comparison you give it. Usually that is the whole
   task's change. When the user asks for only the newest change, or a round
   reads better alone, compare from the last round's commit
   (`--base <commit> --head HEAD`) or keep to the files you changed
   (`--paths`).
3. Say only what the change needs. A small change can be just the diff: leave
   out `--guide`. A change with parts gets a guide (below); one segment with a
   one-sentence summary is a whole guide.
4. After you apply the user's comments, hand off again with
   `med review create` and the same key. `med review update --guide` only
   replaces the guide of a version that Med already captured.
5. End your turn with the link. The user's comments come back as your next
   message: in a Med thread (`MED_SESSION=owned`) as a new turn; elsewhere
   Med resumes your session with them, or the user pastes them in while
   another app has it open. A subagent gives the link to its parent agent.
6. Put the printed link in your final message. Never invent a link or print
   Med's token.
7. If `med review repos --repo <root>` says that a repository you changed is
   not registered, name it and ask the user before you run `med add`.
8. Act on the advice that `med review` prints, such as a guide check, and run
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

A guide, when the change needs one: group by intent; use the fewest segments (usually 1–5); order
core change, supporting code, tests, then lockfiles, generated files and
formatting last; put every changed file in exactly one segment; summaries say
why in 1–3 sentences; comment only where it saves the reader time (`kind`:
note, suggestion, risk, question). Summaries are Markdown: where a picture
explains a flow, a state change, or a screen faster than words, consider a
`mermaid` fence or an image from the checkout. To fix what the guide check
reports for the version that you just made:
`med review update --key <key> --guide -`.

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
task is done. The version can be the whole change again or only what you
changed for the comments (step 2), as the user asks.

Each comment in the message starts with its ID, as `## 6f1c9e · path:line`.
To answer one in its thread, where the user reads it (a question they asked on
a line, or why you left a change out), run `med reply 6f1c9e <<'END'` with the
answer, then `END`. Your final message still says what you did.

## Threads and sessions

`med thread list | open | close`, and `med thread find` / `adopt` to bring an
earlier session into Med (`med thread --help`). Act only on threads the user
names. `med docs agents` is the full guide.
