# Usage

**Usage**, at the foot of the sidebar (or `/usage`), shows what your agents
spent over a range of days: **Today**, **7 days**, **This month**, **Last
month**, or **Custom** with two dates. The address keeps the range, such as
`/usage?range=last-month` or `/usage?from=2026-10-01&to=2026-10-15`.

- The total, the requests, the tokens, and the share of prompt tokens that a
  cache served.
- Each day's spend as a column, split by agent. Hover or focus a column for
  its amounts. A range past three months shows months.
- The tokens by kind: input that no cache served, cache writes, cache reads,
  and output.
- **Agents** and **Models**: requests, tokens, and spend, largest first. A
  model that more than one agent ran names them, such as Opus 5.5 in Claude
  Code and in Pi.

## What it counts

- Claude Code's transcripts on this Mac (`~/.claude/projects`), with their
  subagents'. Claude Code copies requests into other files: a resumed or
  forked session starts with its original's, and a subagent's file can be in
  two sessions' folders. A request counts once, by its message ID.
- Codex's rollouts (`~/.codex/sessions`, and `archived_sessions`), each
  response by its usage record or its running total.
- The ACP sessions that Med ran, such as Antigravity's and Pi's, from Med's
  file of each session's updates (`<state>/sessions/<id>.jsonl`): each
  `token_usage` update names its agent. Pi sessions and Antigravity sessions
  that Med did not run are not counted.

Days are the Mac's days. Each request pays the list prices of its day, as in
a thread's spend ([Spend and context](../SESSIONS.md#spend-and-context)). A
model without Med's price takes the agent's own where it gives one, as Pi
does, and the page names it; a model with neither counts its tokens, not its
cost.

The first read of a range reads every file that changed since the range
started, which for a month of heavy Claude Code use is a few gigabytes and a
few seconds. After that Med reads only what changed, so a range asked again
answers at once. Med keeps each file's requests as numbers, and stops keeping
a file that leaves the range.
