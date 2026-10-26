---
name: med
description: Hand off code changes for review in Med, the user's local review app (the `med` command), and act on the comments that come back. Use when you finish a change, or a round of one, in a Git repository, or when the user mentions Med.
---

# Hand off changes in Med

Med shows your change to the user as a local review. They comment on lines
and send the comments back to you.

## Hand off

1. `med review repos` lists the registered repositories. Include only the
   ones your task changed, and pass each one's root as `--repo`. If one is
   missing, name it and ask the user before you run `med add`.
2. Create one review per task. Reuse the same `--key` (such as the branch)
   for every round: each create adds a version. The `--title` has 2–4 words
   naming what the task builds, without the repository name or words such as
   "review" and "changes". Pick the comparison that holds exactly your work:
   - uncommitted work: `--working`; in a checkout that others also change,
     add `--paths <your files>`;
   - commits on main: `--base <commit before your work> --head HEAD`;
   - a feature branch: `--base main --head HEAD --merge-base`;
   - stacked branches or pull requests: one review with
     `--stack <bottom> ... <top>` (`--set` for independent parts), and
     `--guide` takes a JSON array, one guide or `null` per part;
   - several repositories: one review from `--manifest <file>`
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

3. The guide: group by intent; use the fewest segments (usually 1–5); order
   core change, supporting code, tests, then lockfiles, generated files and
   formatting last; put every changed file in exactly one segment; summaries
   say why in 1–3 sentences; comment only where it saves the reader time
   (`kind`: note, suggestion, risk, question).
4. Fix what the printed guide check reports:
   `med review update --key <key> --guide -`.
5. Put the printed link in your final message. Never invent a link or print
   Med's token. Don't commit, switch branches, or fetch only to make a link.
6. After you open a pull request: `med review update --key <key> --pr <url>`.

## When comments come back

- In a Med thread (`MED_SESSION=owned`) the user's messages arrive as new
  turns, and `MED_THREAD_KEY` and `MED_THREAD_REPO` are the default `--key`
  and `--repo`. Do not run `med review wait`.
- Otherwise, after the hand-off run `med review wait --key <key>` as a
  background command; its output is the user's message.

Comments point at the captured version, so check the current source first.
Apply them, hand off the next version with the same key, and wait again until
the user says the task is done.

## Threads and sessions

`med thread list | open | close`, and `med thread find` / `adopt` to bring an
earlier session into Med (`med thread --help`). Act only on threads the user
names.
