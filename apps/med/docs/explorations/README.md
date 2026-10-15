# Med design explorations

The experiments started on branch `med-explorations` on 2026-10-15, from Med
v0.4.2 (c79ef915). This folder keeps the experiments that Med kept.

## The question

What would make Med the one place where you direct your agents, understand
what they did, and ship it?

Med 0.4 is a good review tool with agent threads beside it. The work it
supports has changed: you run several agents at once, in worktrees, in Claude
Code and Codex as well as in Med. The hard parts are no longer reading one
diff. They are:

1. **Knowing what needs you.** Which agent waits for an answer, which one is
   done, which one is still working, and what it does now.
2. **Understanding why.** Each line of an agent's diff comes from a request in
   a conversation. Med shows the two side by side but does not connect them.
3. **Seeing the whole change.** A 70-file change is hard to read from the top
   of an alphabetical list.
4. **Shipping it.** Landing a thread takes many steps outside Med.

Each experiment answered one of these with a few commits and its own write-up,
so that each one could be kept, changed, or dropped alone.

## Decisions (2026-10-15)

Kept:

| #   | Experiment                    | Write-up                           |
| --- | ----------------------------- | ---------------------------------- |
| 1   | Every agent, wherever it runs | [every-agent.md](every-agent.md)   |
| 6   | Quieter chrome                | [quiet.md](quiet.md)               |
| 7   | Attempts                      | [attempts.md](attempts.md)         |
| —   | Architecture review           | [architecture.md](architecture.md) |

Also kept:

- **Thread status.** Each thread tells what its agent does now, what it said
  last, whether it asks you, and the work that its base branch does not have.
  The sidebar shows a working agent's activity in place of its branch, and
  **Needs you** for a turn that ended on a question.
- **The architecture review's two proofs of concept:** the thread store, and
  one route table for the Commit tab's routes.
- **The fix for Viewed** in a file header: a click marks the file viewed.
- **The exploration harness:** the demo world (`world.mjs`, `week-view.mjs`)
  and the recorded stage (`stage.mjs`, `run.mjs`, the scenes).

Dropped: experiment 2 (Inbox), 3 (Turn blame), 4 (Change map), and 5 (Land).
Their code, write-ups, screenshots, and scenes stay on branch
`med-explorations`. A separate design, open tabs and cold history, is to take
the place of the Inbox.

## Watch and try

The video plays the kept experiments on one demo world: a small repository,
`tide`, with four agents' worktrees and the Claude Code and Codex transcripts
that made their changes.

```sh
cd apps/med
bun run build
node scripts/explorations/run.mjs --only 00,01   # screenshots of some scenes
node scripts/explorations/run.mjs --record       # the whole video, 2x
```

`scripts/explorations/world.mjs` builds the world under a scratch HOME, so
Med shows `~/code/tide`. Nothing touches your own state or repositories.
