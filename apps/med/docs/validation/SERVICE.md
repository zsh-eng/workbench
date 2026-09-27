# Persistent service and standalone validation

Validated locally on macOS with the built Node CLI and the compiled Bun
executable. `scripts/validate-service.mjs` creates a small synthetic vault and Git
repository outside the checkout, drives production CLI/API/browser paths, then
stops its server and removes its fixture.

Checks: concurrent startup chooses one owner; registrations update a running
host; the normal Git viewer opens commit and working diffs and refreshes after
external file edits; wiki links, image embeds, and backlinks render; external edits refresh the
index and UI; the folder tree, preview/pinned/closable tabs, Cmd+K command palette,
Cmd+Shift+K file picker with previews, and sidebar toggle use shared controls;
dirty drafts survive file switches, reject closing, and save to disk;
removal preserves files; stop and
restart retain registration. The standalone run serves embedded browser assets
from a directory outside the checkout. No private vault text is in fixtures.

```sh
bun run build
bun run test:service
bun scripts/build-executable.ts /private/tmp/med-standalone/med
MED_EXECUTABLE=/private/tmp/med-standalone/med bun run test:service
```

Screenshots are written to ignored `.benchmarks/service/`. Index-engine timings
remain in [VAULT_INDEX.md](VAULT_INDEX.md); these are not browser latency claims.

The macOS LaunchAgent install/uninstall path is implemented but was not enabled
on the user's machine during validation. Cross-platform binaries, signing, and
OS service-manager behavior outside macOS are not validated by these checks.

A separate smoke run used the private benchmark copy: 6,638 files, 4,040 notes,
12.36 MB of note text. The compiled executable's first index took 8,003 ms; an
unchanged scan took 96 ms and parsed zero notes. These are single-run engine
timings under the current machine load, not a controlled comparison with the
earlier benchmark. The persistent server used about 58 MiB RSS at the sampled
point after indexing; the index subprocess had exited. No private paths or note
contents are included here.
