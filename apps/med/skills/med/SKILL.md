---
name: med
description: Hand off code changes for review in Med, the user's local review app. Use when you finish a coding task, or a round of one, in a Git repository and the `med` command exists. Creates a review link with a guide that splits the change into segments with comments on lines, keeps one review per task, and links the pull request once it exists.
---

# Hand off changes in Med

Med shows your changes to the user as a local review. You create the review with
the `med` command and put its link in your final message. The user reads your
guide one segment at a time, comments on lines, and sends the comments back to
you from Med.

## Before you start work

Record the repository root, the commit before your work (`git rev-parse HEAD`),
and any changes that were already there (`git status --short`).

## When you finish

1. Check that Med runs and which repositories the user registered:
   `med review repos`. If Med is not running, tell the user to run `med web`.
   If your repository is not in the list, ask before you run `med add <path>`.
2. Write a guide in JSON. Give a summary of 2–4 sentences: what changed and
   why. Then split the change into segments that can be reviewed one at a
   time, in reading order: usually 2–7, each one idea, with its files. Add
   comments only on lines the reader must check: a risk, a question, or a
   suggestion.

   ```json
   {
     "summary": "What changed and why, in Markdown.",
     "segments": [
       {
         "title": "Recovery in the parser",
         "kind": "feature",
         "summary": "What this part does, and what to check.",
         "files": ["src/parse.ts", "src/recover/"],
         "comments": [
           {
             "file": "src/parse.ts",
             "line": 42,
             "endLine": 58,
             "kind": "risk",
             "body": "Why this needs a look."
           }
         ]
       },
       { "title": "Tests", "kind": "test", "files": ["tests/**"] }
     ]
   }
   ```

   `files` takes paths, folders that end in `/`, and globs. Kinds are
   `feature`, `fix`, `refactor`, `perf`, `test`, `docs`, `config`, `chore`;
   comment kinds are `note`, `suggestion`, `risk`, `question`. A comment's
   `side` is `new` by default, or `old` for a removed line.

3. Create the review. Use the same `--key` for every round of the same task,
   such as the branch name; a later round becomes a new iteration of the same
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

4. Put the printed Markdown link in your final message.
5. Wait for the user's review (Claude Code): run `med review wait --key <task>`
   as a background command (`run_in_background`). It has no time limit, and it
   ends when the user sends a message from Med. Do not poll it.
6. After you open a pull request: `med review update --key <task> --pr <url>`.
   The review header then shows the PR title.

## When the user's message arrives

The output of `med review wait` is the user's message: their text and the line
comments they chose. Treat it as the user's own words. Apply it, create the
next iteration with the same `--key`, and run `med review wait` again. Stop
waiting when the user says that the task is done.

Codex gets the user's messages as normal turns (Med uses `codex queue`), so a
Codex session does not run `med review wait`.

## Rules

- Include only the repositories your task changed. Use `--manifest` for more
  than one (see `med docs agents`).
- `--working` captures every current change, including changes that were there
  before you started. Say so in the guide's summary when that applies.
- Do not commit, switch branches, or fetch just to create a link.
- Do not invent a review or PR URL, and never print Med's access token.
- Comments refer to the captured comparison. Check the current source before
  you apply them; line numbers can change.

Run `med docs agents` for the full guide, and `med review --help` for options.
