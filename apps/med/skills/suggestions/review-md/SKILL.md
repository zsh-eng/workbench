---
name: review-md
description: Write a REVIEW.md for a repository, so that reviewers (people, /code-review, Code Review) tag findings the same way and skip what does not matter.
---

# REVIEW.md

Add `REVIEW.md` at the repository root. Keep it short; fill the brackets
from the repository, and ask the user what counts as Important.

```markdown
# Review instructions

Tag each finding Important, Nit or Pre-existing, with a file:line citation.
Claims about behaviour cite the source, not names. Start the summary with
the counts ("2 Important, 1 Nit, 0 Pre-existing") or say "Nothing to fix."

## What Important means here

- Lost or corrupted user data: [the data this repository keeps].
- [Client and server, or migrations, that stop working together].
- Secrets, tokens, or production names in code, fixtures or tests.
- A behaviour the hand-off claims but no check exercises.
  Style, naming and refactors are Nit at most.

## Cap the nits

Report at most 3 Nits.

## Do not report

- What the build and the linter already catch.
- [Lockfiles, build output, generated files].

## Re-reviews

Review only the diff since the last review. Don't repeat a posted finding.
After 3 rounds, say so and ask the author to reconsider the approach.
```
