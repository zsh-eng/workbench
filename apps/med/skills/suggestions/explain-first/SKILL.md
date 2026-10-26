---
name: explain-first
description: When you hand off a change, explain why it exists and what to read first, before the diff.
---

# Explain first

The reader understands a diff faster when they know its intent. Before the
diff, write an Explainer of at most 10 lines:

```markdown
## Explainer

Why: sync failed on flaky networks, so retries now back off.
Read first: `src/http.ts:40-70`, the retry policy.
Then: the tests, then the lockfile.
Risk: callers now wait up to 7 s before an error.
```

- Why before what. Name the problem in the user's words.
- Name the one place to read first, with `path:line`.
- Say what changed in behaviour, and what did not.
- Add a diagram only when the change moves data between parts.
- In Med, put it in the guide's `summary`, or in the brief with
  `med review create --brief -`.
