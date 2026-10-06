# Testing med

Follow the test-design guidance in the repository [AGENTS.md](../../../AGENTS.md).
Start with the smallest integration or end-to-end test that can detect the
regression through observable behavior. Do not add the same assertion to a
helper test, controller mock, component mock, and browser test.

From the Workbench root:

```sh
bun run test:med
bun run --cwd apps/med test:e2e
bun run check:med
```

`test:med` runs host integrations, browser interactions, then the remaining
focused unit regressions. `test:e2e` builds med and runs the real CLI and browser
against temporary repositories. `check:med` also checks formatting, lint, and
types. The push tests use temporary local bare remotes.

## Test boundaries

| Behavior                                                                | Test path                                           | What remains real                                                                       |
| ----------------------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Review links, cross-tab comments, copy, clear, push, and base selection | `scripts/validate-review-links.mjs`                 | Built CLI, browser, controller, HTTP host, Git, saved files, and local remote           |
| Repository and worktree navigation                                      | `scripts/validate-multi-repo.mjs`                   | Built app, repository discovery, and file/search requests                               |
| Comment races and failed writes                                         | `tests/integration/saved-review-controller.test.ts` | Controller, parser, HTTP host, Git, and disk; delay only the external response boundary |
| CLI discovery, authentication, and saved capture                        | `tests/integration/review-cli.test.ts`              | CLI command implementation, HTTP peers, and local state files                           |
| Git authorization, merge bases, hooks, and push rejection               | `tests/host/git-actions.test.ts`                    | HTTP routes, Git commands, hooks, and temporary repositories                            |
| Vim selection and copy                                                  | `tests/browser/full-file.test.tsx`                  | File renderer, key handlers, selection, and clipboard                                   |
| Commit time and hover display                                           | `tests/browser/history.test.tsx`                    | Rendered history and Base UI; advance the clock instead of calling timer callbacks      |

Browser tests may supply file bytes or a response outside the tested path. They
must not replace the selection, tooltip, copy, or other mechanism they test.
Host tests must assert the response, saved data, or remote ref instead of an
internal method call.

## Focused exceptions

Keep lower-level regressions only when they cover an important gap that the
integration paths cannot reliably expose. Existing examples include malformed
saved records, file locking, byte limits, export fencing and source excerpts,
parser/anchor edge cases, and syntax-token boundaries. Use small synthetic
inputs for these cases rather than large repository snapshots.

The cleanup removes mocked happy paths already covered by the built app,
callback-only comparison tests, direct Vim/time-helper tests, and trivial
store/state/accessor assertions. Keep regression intent when moving a test;
do not use a lower test count as the goal.

## Language rendering parity

`bun run test:highlighting` compares production Java/C++ file and diff output
against pinned Shiki. `bun run compare:highlighting --fixtures-only` adds browser
screenshots. See [the parity and performance guide](validation/JAVA_CPP_HIGHLIGHTING.md)
for the larger corpus, exact mismatch reports, and production UI benchmarks.

## File-opening performance

`node scripts/benchmark-language-ui.mjs --native-only` builds and measures the
production file viewer. Add `--profile` to write Chrome performance traces.
See [file-opening measurements](validation/FILE_OPENING.md) for phase definitions,
before/after results, and comparison of retained builds.

`bun run test:markdown-links` exercises relative-link clicks through the built
CLI, Markdown worker, browser, and file APIs: working and historical repository
files, standalone tabs, URL encoding, parent paths, missing targets, and root
boundaries. Vault relative links are covered by `bun run test:service`.

`bun run test:restart` runs a copy of the build and changes it: a newer page
offers Reload, a broken server build keeps the server running, and a working
rebuild restarts it with a new process. Build first.

`bun run test:navigation` uses an isolated headless Chromium and temporary
repositories to check repository-scoped file picking, filter composition,
identical paths in different repositories, keyboard focus, file integrity,
cursor alignment while scrolling, and diff search contexts. It does not use
the user's native browser or add registrations to their Med service.
