---
name: med
description: Hand off code changes for review in Med, the user's local review app. Use when you finish a coding task, or a round of one, in a Git repository and the `med` command exists. Creates a review link with a brief that cites the changed lines, keeps one review per task, and links the pull request once it exists.
---

# Hand off changes in Med

Med shows your changes to the user as a local review. You create the review with
the `med` command and put its link in your final message. The user reads your
brief, comments on lines, and pastes the comments back to you.

## Before you start work

Record the repository root, the commit before your work (`git rev-parse HEAD`),
and any changes that were already there (`git status --short`).

## When you finish

1. Check that Med runs and which repositories the user registered:
   `med review repos`. If Med is not running, tell the user to run `med web`.
   If your repository is not in the list, ask before you run `med add <path>`.
2. Write a brief in Markdown. Explain what changed and why, and cite code with
   repository-relative links that end in line numbers, such as
   `[parse.ts:42-58](src/parse.ts:42-58)`. Cite the files that need attention.
3. Create the review. Use the same `--key` for every round of the same task,
   such as the branch name; a later round becomes a new iteration of the same
   review. Use a `--title` of 2–4 words that names what the task builds.

   Uncommitted work:

   ```sh
   med review create --key <task> --title "Parser recovery" \
     --repo <repository-root> --working --brief - <<'BRIEF'
   <your brief>
   BRIEF
   ```

   Committed work on a branch:

   ```sh
   med review create --key <task> --title "Parser recovery" \
     --repo <repository-root> --base main --head HEAD --merge-base --brief -
   ```

   Commits made on `main` during the task need exact endpoints:

   ```sh
   med review create --key <task> --title "Parser recovery" \
     --repo <repository-root> --base <commit-before-work> --head HEAD --brief -
   ```

4. Put the printed Markdown link in your final message.
5. After you open a pull request: `med review update --key <task> --pr <url>`.
   The review header then shows the PR title.

## Rules

- Include only the repositories your task changed. Use `--manifest` for more
  than one (see `med docs agents`).
- `--working` captures every current change, including changes that were there
  before you started. Say so in the brief when that applies.
- Do not commit, switch branches, or fetch just to create a link.
- Do not invent a review or PR URL, and never print Med's access token.
- Comments the user pastes back refer to the captured comparison. Check the
  current source before you apply them; line numbers can change.

Run `med docs agents` for the full guide, and `med review --help` for options.
