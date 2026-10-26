---
name: adversarial-review
description: Review a finished diff with several fresh-context bug hunters, one bug class each, then keep only the findings that a vote confirms.
---

# Adversarial review

Use it on a diff that is ready for a person. Reviewers asked to find gaps
over-report, so a vote filters them.

1. Start 3 reviewers in fresh context (new subagents, not forks). Give each
   the diff, the plan, the repository's REVIEW.md, and one bug class: data
   loss and migrations; concurrency and caching; behaviour that the hand-off
   claims but no check exercises.
2. Each reviewer reports findings as `Important`, `Nit`, or `Pre-existing`,
   with `path:line` and the evidence (the source, not names).
3. Give the merged list to 2 fresh voters. A finding stays when both agree
   that it is real and that its severity is right.
4. Fix the Important findings. Close each finding as Fixed, Intentional, or
   Won't fix, with a reason:

```markdown
- Important `src/http.ts:42` Retry ignores the abort signal. Fixed: the signal goes to each attempt.
- Nit `src/util.ts:3` Rename `t`. Won't fix: matches the upstream name.
```

Start the summary with the counts: "1 Important, 1 Nit, 0 Pre-existing".
