# Med design explorations

Branch `med-explorations`, started 2026-10-15 from Med v0.4.2 (c79ef915).

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

Each experiment answers one of these. Each is a few commits on this branch,
with its own write-up, so you can keep it, change it, or drop it alone.

## The experiments

| #   | Experiment | Write-up | Status |
| --- | ---------- | -------- | ------ |
| 1   | Every agent, wherever it runs | [every-agent.md](every-agent.md) | In progress |
| 2   | Inbox | [inbox.md](inbox.md) | Planned |
| 3   | Turn blame | [turn-blame.md](turn-blame.md) | In progress |
| 4   | Change map | [change-map.md](change-map.md) | In progress |
| 5   | Land | [land.md](land.md) | In progress |
| 6   | Quieter chrome | [quiet.md](quiet.md) | Planned |
| 7   | Instant start | [instant-start.md](instant-start.md) | Planned |
| —   | Architecture review | [architecture.md](architecture.md) | In progress |

## Watch and try

The video plays every experiment on one demo world: a small repository,
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
