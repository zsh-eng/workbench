---
name: proof-first
description: Before you hand off a change, list the checks you ran with their results, the media, and what the checks do not cover.
---

# Proof first

A claim without proof is a report, not a result. End each hand-off with a
Proof section, before the explanation:

```markdown
## Proof

- `bun run test`: 42 passed
- `bun run build`: passed
- Screenshot: /tmp/shots/retry.png

### Not covered

- Safari; offline for more than 5 minutes
```

- One item per check: the command in backticks, then its result as the tool
  printed it (counts, or the exit code).
- Run the checks again after the last edit. Do not report an earlier run.
- An interaction change needs a browser, simulator, or device run; a
  performance claim needs a trace.
- Name the checks you did not run, and why. "Not covered" is the list the
  reviewer reads first.
- In Med, pass it with `med review create --brief -`; Med shows Proof first.
