---
name: med
description: Hand off code changes for review in Med, the user's local review app. Use when you finish a coding task, or a round of one, in a Git repository and the `med` command exists. Creates a review link with a guide that splits the change into segments with comments on lines, keeps one review per task, and links the pull request once it exists. Also use when the user asks to bring an earlier Claude Code or Codex session into Med: it finds sessions of any age and makes one a Med thread.
---

# Hand off changes in Med

Med shows your changes to the user as a local review. You create the review with
the `med` command and put its link in your final message. The user reads your
guide one segment at a time, comments on lines, and sends the comments back to
you from Med.

## In a Med thread

When `MED_SESSION` is `owned`, Med started you in a thread. `MED_THREAD_KEY`
and `MED_THREAD_REPO` give the default `--key` and `--repo`, so leave them out:
`med review create --working --title "<2-4 words>" --guide -`. Med sends the
user's messages to you as new turns, so do not run `med review wait`.

The thread's **Changes** tab shows the checkout's Git changes live; Med saves
nothing for them. Its **Review** tab shows what you hand off, as numbered
versions. In a checkout that other sessions or people also change, such as a
shared main checkout, show only your own files with `--paths`:

```sh
med thread show --paths src/parse.ts src/recover/ --guide - <<'GUIDE'
<your guide>
GUIDE
```

`med thread show` adds a version to your session's thread (the thread of
`MED_THREAD_KEY`, or the thread that holds this Claude Code session). It also
takes `--base <ref>` (the branch's changes since it left `<ref>`), `--commit`,
`--working`, `--manifest`, and `--brief`. `med review create --working` and
`med review update` take `--paths` too.

Med folds lockfiles, build output, and snapshots out of the user's way. When a
tool wrote other files, such as a code generator's output, add
`--generated <path|glob>...` (quote globs) to `med thread show`,
`med review create`, or `med review update --paths`.

## Before you start work

Record the repository root, the commit before your work (`git rev-parse HEAD`),
and any changes that were already there (`git status --short`).

## When you finish

1. Check that Med runs and which repositories the user registered:
   `med review repos`. If Med is not running, tell the user to run `med web`.
   If your repository is not in the list, ask before you run `med add <path>`.
2. Write a guide in JSON. It splits your change into segments that the user
   reads one at a time:
   - Group by intent, not by folder. One feature that touches several modules
     is one segment.
   - Use the fewest segments that still separate independent intents, usually
     1–5. Split a segment of more than about 15 files by sub-area.
   - Put tests, fixtures, and stories in their own segment, after the code
     they cover.
   - Order by review priority: the core change first, supporting changes next,
     mechanical changes (lockfiles, generated files, formatting) last.
   - Put every changed file in exactly one segment. Your commits hint at your
     intents, but group by the final change, not by commit.
   - Summaries say why over what, in 1–3 sentences of Markdown. Titles have at
     most 4 words.
   - Comment only where it saves the reader time: non-obvious logic, a subtle
     change in behavior, a risk. Do not explain the obvious; most files need
     no comment. Use the `risk` kind for what needs extra care (security, data
     loss, hard to revert, easy to get wrong), and `"critical": true` only
     when a whole segment does.

   ```json
   {
     "summary": "Why the change exists, then what it does, in Markdown.",
     "segments": [
       {
         "title": "Parser recovery",
         "area": "core",
         "summary": "Why this part exists, and what to check.",
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

   `files` takes paths, folders that end in `/`, and globs. Areas say which
   part of the system a segment touches: `ui`, `api`, `core`, `data`, `cli`,
   `security`, `tests`, `docs`, `examples`, `deps`, `build`, `scripts`,
   `config`, `i18n`, `assets`, `other`. Comment kinds are `note`,
   `suggestion`, `risk`, `question`. A comment without `line` is about the
   whole file. `side` is `new` by default (new-file line numbers), or `old`
   for a removed line.

3. Create the review. Use the same `--key` for every round of the same task,
   such as the branch name; a later round becomes a new version of the same
   review. Use a `--title` of 2–4 words that names what the task builds.

   Uncommitted work:

   ```sh
   med review create --key <task> --title "Parser recovery" \
     --repo <repository-root> --working --guide - <<'GUIDE'
   <your guide>
   GUIDE
   ```

   Committed work on a branch:

   ```sh
   med review create --key <task> --title "Parser recovery" \
     --repo <repository-root> --base main --head HEAD --merge-base --guide -
   ```

   Commits made on `main` during the task need exact endpoints:

   ```sh
   med review create --key <task> --title "Parser recovery" \
     --repo <repository-root> --base <commit-before-work> --head HEAD --guide -
   ```

   Related pull requests or branches, such as a stack where each pull
   request is based on the one before it, are **one** thread: one stack, not
   one review each. Name them bottom first; Med reads pull requests with `gh`,
   fetches missing heads without a checkout, and diffs each layer against the
   layer below:

   ```sh
   med review create --key <task> --title "Parser rewrite" \
     --repo <repository-root> --stack 101 102 103 104 --guide guides.json
   med review create --key <task> --title "Parser rewrite" \
     --repo <repository-root> --stack parse-tokens build-ast --base main
   ```

   `--guide` then takes a JSON array with one guide, or `null`, for each
   layer. Use `--set` in place of `--stack` for independent changes of one
   task, each against its own base. To hand off one layer again, run
   `med review create` with that layer's pull request URL or branch as
   `--key`; `med review update --key <that key> --guide -` sets its guide.

4. Med checks the guide against the changed files and prints what it leaves
   out or names twice. Fix those, then run
   `med review update --key <task> --guide -` with the fixed guide.
5. Put the printed Markdown link in your final message.
6. Wait for the user's review (Claude Code, not in a Med thread): run
   `med review wait --key <task>` as a background command
   (`run_in_background`). It has no time limit, and it ends when the user
   sends a message from Med. Do not poll it.
7. After you open a pull request: `med review update --key <task> --pr <url>`.
   The review header then shows the PR title.

## When the user's message arrives

The output of `med review wait` is the user's message: their text and the line
comments they chose. Treat it as the user's own words. Apply it, create the
next version with the same `--key`, and run `med review wait` again. Stop
waiting when the user says that the task is done.

Codex gets the user's messages as normal turns (Med uses `codex queue`), so a
Codex session does not run `med review wait`.

## Tabs, history, and earlier sessions

The threads that the user has open are tabs in Med's sidebar; the others are
history. When the user asks, list, open, or close them:

```sh
med thread list [--history]              # ID, state, repository/branch, title
med thread open <id>                     # from history, as a tab
med thread close <id> | --key <key>      # to history; the agent keeps working
```

Med finds the Claude Code and Codex sessions of the last 7 days by itself.
For an older one, or one that the user cannot find, search for it, then make
it a thread:

```sh
med thread find tide prediction          # newest first: session, time, folder, title
med thread adopt claude:<session-id>     # prints the thread's ID and link
```

`find` matches each word in the title, the first prompt, the folder, or the ID;
add `--json` for details. `adopt` also takes the first 6 or more characters of
an ID, or a transcript's path. It fails when no session or more than one
matches; then choose one from `find`. Use `--repo <checkout>` when the session's
folder is not in a registered repository. Put the printed link in your reply.
The thread captures nothing: it shows the checkout's live Changes, and a
Review once you run `med thread show`.

The user can message an adopted Claude Code session from Med. When no process
runs the session, Med resumes it with the message as a new turn. While a
terminal runs it, the message waits until that session runs `med review wait`
or ends, or until the user forks it with Continue in Med.

## Rules

- Include only the repositories your task changed. Use `--manifest` for more
  than one (see `med docs agents`).
- Review several stacked pull requests as one `--stack`. Separate
  `med review create` calls for them clutter the user's tabs; Med joins a
  hand-off whose base is another open thread's head only when the same
  session made both, or both are pull requests.
- `--working` captures every current change, including changes that were there
  before you started. Keep only your files with `--paths`, or say so in the
  guide's summary when that applies.
- Do not commit, switch branches, or fetch just to create a link.
- Do not invent a review or PR URL, and never print Med's access token.
- Comments refer to the captured comparison. Check the current source before
  you apply them; line numbers can change.

Run `med docs agents` for the full guide, and `med review --help` for options.
