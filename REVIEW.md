# Review instructions

Tag each finding Important, Nit or Pre-existing, with a file:line citation.
Claims about behaviour cite the source, not names. Start the summary with
the counts ("2 Important, 1 Nit, 0 Pre-existing") or say "Nothing to fix."

## What Important means here

- Lost or corrupted user data: highlights, notes, reading progress, card history.
- Sync or migration breaks: client and server that can't talk, a migration
  that isn't backward compatible, a sync payload changed on one side only.
- Production names, bindings, data, secrets or tokens in code, fixtures or tests.
- A deploy, remote migration or production config change made as a side effect.
- A behaviour the hand-off claims but no check exercises (no browser or
  simulator run for an interaction change, no trace for a performance claim).

Style, naming and refactors are Nit at most.

## Cap the nits

Report at most 3 Nits.

## Do not report

- What `bun run build` and lint already catch.
- `bun.lock`, build output, screenshots and clips, `apps/med/docs/explorations/`.

## Always check

- `packages/` does not import app code.
- Dependency changes follow docs/DEPENDENCIES.md and are declared by their owner.
- Data, caching, sync and performance changes keep docs/ARCHITECTURE.md invariants.
- Tests follow AGENTS.md "Test design"; no `zz-*` probes are left behind.
- For changes under `**/migrations/`, `packages/local-sync`, `wrangler*.jsonc`,
  deploy scripts or auth, state the production effect in the summary.

## Re-reviews

Review only the diff since the last review. Don't repeat a posted finding.
Name the bug class so every instance gets fixed. After 3 rounds, say so and
ask the author to reconsider the approach.
