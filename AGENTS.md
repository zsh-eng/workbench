# Workbench agent guidelines

Use concise ASD-STE100 technical English for software explanations. After
changes, give a brief summary and a suggested order to review changed files.
Include line numbers when useful. Preserve unrelated edits.

## Workspace layout

- `apps/reader`: web Reader and deployed Cloudflare Worker. Follow its `AGENTS.md`.
- `apps/arctic`: native Arctic iOS app. Follow its `AGENTS.md`.
- `apps/spaced2`: Spaced flashcards and its Worker. Follow its `AGENTS.md`.
- `packages`: shared libraries and private server support. Do not import app code.
- Root guides document reusable patterns; keep them easy to read.

Read [Architecture](docs/ARCHITECTURE.md) before changes to data, caching, sync,
or performance. Read the owning app's architecture and tests as well. Read
[Dependencies](docs/DEPENDENCIES.md) before you add, replace, or remove a
dependency. Read [Elements](docs/ELEMENTS.md) before you add to an Elements
page or build a demo that plays, resets, or scrubs.

## Tools and checks

Use **bun** for JavaScript/TypeScript dependencies and scripts. Install from
this directory; keep one root `bun.lock`. Declare dependencies in their owner.
Use `bun run build` for the web app's type check and build; do not run `npx tsc`.

Choose checks for the affected app. For Reader, follow its test matrix. For
Arctic, use its WebView tests, Swift checks, and Xcode build as applicable.
Test interaction changes in a browser, simulator, or device. Use traces for
performance claims; report checks that remain open. Documentation-only changes
need a diff and link review, not a build.

Keep deployment resource names and production data separate from repository
names. Do not deploy or run remote migrations as a side effect of a refactor.

## Fast test loop

- Start the app's e2e server once per worktree, in the background, on your
  own port. For Reader: `E2E_PORT=<port> bun run e2e:serve`. Each
  `E2E_PORT=<port> bun run test:e2e <spec>` then reuses it.
- Run heavy jobs (Playwright, full vitest runs, builds) through the
  machine-wide lock, which allows two at a time: `bun run heavy <command>`.
  Reader's `test:e2e` uses it already.
- For screenshots, clips and timings, use the
  [agent kit](packages/agent-kit/README.md): `bun run kit shot|clip|time`. Do
  not write throwaway browser scripts or `zz-*.spec.ts` probes.
- Run a command that can take more than about 3 minutes in the background,
  with a timeout. Give each polling loop a deadline.
- Batch independent file reads into one turn: parallel tool calls, or one
  command that prints several ranges.
- Do not run a passing spec again unless the code changed. Use
  `--repeat-each` only to find a flaky test.

## Test design

- Prefer integration and end-to-end tests for behavior. Exercise production
  wiring and assert observable results.
- Avoid unit tests by default. Add them only for important regressions that
  integration tests cannot catch.
- Do not test intermediate behavior, private helpers, trivial accessors, or
  framework behavior. Do not repeat the same coverage at each layer.
- Use the smallest fixture that proves the behavior. Mock dependencies outside
  the tested path when needed; do not mock the mechanism under test.

## Local process cleanup

Track servers, watchers, test browsers, and build processes started for a task.
Stop them when the task no longer needs them. Keep shared app services and
processes used by other active tasks running. Before stopping a process, check
its command, working directory, and parent process. Stop your warm e2e server
when the task ends.
