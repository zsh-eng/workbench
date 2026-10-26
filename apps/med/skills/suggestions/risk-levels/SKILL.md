---
name: risk-levels
description: Set a change's risk level from the paths it touches, and state the review it needs before you hand it off.
---

# Risk levels

The paths decide the level, not the agent's confidence. List the levels for
the repository once, then state the level in each hand-off:

| Level  | Paths (example)                                     | Review                                               |
| ------ | --------------------------------------------------- | ---------------------------------------------------- |
| Low    | docs, copy, tests only, additive code behind a flag | Checks green; the reader reads the explainer         |
| Medium | ordinary product code, caching, shared UI, the CLI  | The reader reads the diff once                       |
| High   | migrations, sync, auth and tokens, deploy config    | A deep review, and the user's OK on the exact commit |

- Take the highest level of any changed path.
- Say the level and why in the first line of the hand-off:
  "Risk: High (`migrations/0042_add_index.sql`)".
- An agent's approval never counts as the user's. An OK covers one commit.
- Deploys need the user's OK at every level.
