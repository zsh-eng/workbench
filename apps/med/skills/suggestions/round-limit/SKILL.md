---
name: round-limit
description: Count review rounds; on a re-review read only the new diff, and after 3 rounds stop and rethink the approach.
---

# Round limit

A change that needs a fourth round usually has the wrong approach, not four
small bugs.

- Count the rounds: each hand-off after review comments is one.
- On a re-review, read only the diff since the last review. Do not repeat a
  finding that you already posted; name its bug class so that every instance
  gets fixed.
- After round 3, do not patch again. Write down why the rounds keep finding
  problems, propose a different approach in a few lines, and ask the user
  before you go on.
- In Med, each round is a version (`med review create` with the same key);
  Med shows the files that changed since your last review.
