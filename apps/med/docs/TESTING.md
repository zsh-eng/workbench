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

`test:med` runs host integrations with the remaining focused unit regressions
(`test:node`), then browser interactions. `test:e2e` builds med and runs the real
CLI and browser against temporary repositories. `check:med` also checks
formatting, lint, and types. The push tests use temporary local bare remotes.

## Keeping the suite fast

The suite is bound by this Mac's processors, not by waiting, so a test's cost
is what it makes the host or the browser do.

- Wait for a condition, not for a time. A host test that reads the thread
  list's states starts its host with `statusMs: 100`, not the 1.5 s of a real
  window; a rule that a module decides alone, such as where a process record
  says a session is open, is tested on that module and not through a cache.
- A file runs on one worker, so a long file holds the run. Large areas keep
  their setup in a fixture module (`owned-fixture.ts`, `app-fixture.tsx`,
  `session-fixture.tsx`, …) and their tests in files by topic.
- The browser files of a worker share one page (`isolate: false`), so the app
  loads once per worker. `tests/browser/setup.ts` gives each file the first
  page's size and empty storage. A test sets the viewport it measures, and
  restores what it replaces on `globalThis`, such as `fetch` or the timers.

## Test boundaries

| Behavior                                                                | Test path                                           | What remains real                                                                         |
| ----------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Review links, cross-tab comments, copy, clear, push, and base selection | `scripts/validate-review-links.mjs`                 | Built CLI, browser, controller, HTTP host, Git, saved files, and local remote             |
| Repository and worktree navigation                                      | `scripts/validate-multi-repo.mjs`                   | Built app, repository discovery, and file/search requests                                 |
| The Pull request tab in each state of a pull request, and Create        | `scripts/validate-pull-request-live.mjs`            | Built CLI, browser, HTTP host, Git, and a local remote, on gh's output as GitHub gives it |
| First-run welcome, discovery, CLI adds, and login item                  | `scripts/validate-welcome.mjs`                      | Built CLI, browser, WebGL shader, fixture home folder, Git, and the service registry      |
| View settings after the browser closes and the server restarts          | `scripts/validate-view-settings.mjs`                | Built CLI and server, a browser profile on disk, the same port, and a fixture session     |
| Comment races and failed writes                                         | `tests/integration/saved-review-controller.test.ts` | Controller, parser, HTTP host, Git, and disk; delay only the external response boundary   |
| CLI discovery, authentication, and saved capture                        | `tests/integration/review-cli.test.ts`              | CLI command implementation, HTTP peers, and local state files                             |
| Git authorization, merge bases, hooks, and push rejection               | `tests/host/git-actions.test.ts`                    | HTTP routes, Git commands, hooks, and temporary repositories                              |
| Vim selection and copy                                                  | `tests/browser/full-file.test.tsx`                  | File renderer, key handlers, selection, and clipboard                                     |
| Commit time and hover display                                           | `tests/browser/history.test.tsx`                    | Rendered history and Base UI; advance the clock instead of calling timer callbacks        |

Browser tests may supply file bytes or a response outside the tested path. They
must not replace the selection, tooltip, copy, or other mechanism they test.
Host tests must assert the response, saved data, or remote ref instead of an
internal method call.

Tests and validations never reach GitHub. Host tests pass a fake gh
(`tests/fixtures/gh/fake-gh.mjs`). Each `scripts/validate-*.mjs` calls
`useFakeGh` from `scripts/fake-gh.mjs` before it starts Med: a stand-in `gh`
comes first on PATH, with a scratch `GH_CONFIG_DIR` and no GitHub token, for
`dist/cli.js` and `MED_EXECUTABLE` alike. The stand-in answers only the fixed
answers that a script sets, such as the pull request and its comments in
`validate-review-links.mjs`. At the end, `fakeGh.check()` fails the run when a
call had no fixed answer.

A fixture of what gh prints must match real GitHub, as a tidy fixture hid a real
bug: GitHub leaves lines null for pending comments. Check its shape with
read-only `gh` calls first. `tests/fixtures/gh/live-pull-requests.mjs` keeps the
shapes that those calls showed, and says which ones a tidy fixture would hide.

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

## File-opening performance

`node scripts/benchmark-language-ui.mjs --native-only` builds and measures the
production file viewer. Add `--profile` to write Chrome performance traces.
See [file-opening measurements](validation/FILE_OPENING_SECOND_PASS.md) for phases,
results, and comparison of retained builds.

`bun run test:markdown-links` exercises relative-link clicks through the built
CLI, Markdown worker, browser, and file APIs: working and historical repository
files, standalone tabs, URL encoding, parent paths, missing targets, and root
boundaries. Vault relative links are covered by `bun run test:service`.

## Title bar screenshots

`scripts/kit/titlebar.ts` is an agent kit `--before` module: the installed
app with its title bar hidden, as Chrome lays out the window on macOS. A test
browser cannot install the app, so it gives the page Chrome's geometry (a 38
pixel strip; `MED_TITLEBAR_HEIGHT` tries another, such as 33 for Windows) and
draws the traffic lights. `scripts/kit/titlebar-guides.ts` measures the centre
line of each part of the top row in the screenshot, prints them, and draws
them. The browser test in `tests/browser/quiet-chrome.test.tsx` checks the
same geometry on 38, 44 and 33 pixel strips. Against a Med on your own port
and state folder:

```sh
bun run kit shot "<Med URL with #token=…>" --desktop --size 1280x800 --scale 2 \
  --before apps/med/scripts/kit/titlebar.ts --steps apps/med/scripts/kit/titlebar-guides.ts
```

`bun run test:restart` runs a copy of the build and changes it: a newer page
offers Reload, a broken server build keeps the server running, and a working
rebuild restarts it with a new process. Build first.

`bun run test:navigation` uses an isolated headless Chromium and temporary
repositories to check repository-scoped file picking, filter composition,
identical paths in different repositories, keyboard focus, file integrity,
cursor alignment while scrolling, and diff search contexts. It does not use
the user's native browser or add registrations to their Med service.
