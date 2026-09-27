# Registered sources and Obsidian vaults

Med runs one local server for your registered repositories and vaults. The server
keeps watching when you close the browser. A vault does not need Git. Med does
not run community plugins or change `.obsidian` settings.

## Start and register

```sh
med add /path/to/repository
med add /path/to/vault --wait
med web
med list
```

`add` detects a vault from its `.obsidian` directory. Use `--type vault` for a
plain Markdown folder or a benchmark copy. Registration returns a stable ID:
repositories use their canonical Git common directory; vaults use their canonical
folder. Separate clones remain separate sources.

`web`, `add`, `list`, `remove`, and `index` start the server when needed. `status`
and `stop` do not. The default port is 4173; an occupied port is an error. Use the
same `--port` and `--state-dir` on each command for a separate setup. The default
state directory is `~/.local/state/med`, or `MED_STATE_DIR`. Keep it outside vaults.

Open a vault from the Sources page. The right file tree and top file tabs use the
same controls as repository browsing. Click to preview; double-click to keep a
tab open. Edited files stay open, and dirty tabs cannot be closed without saving
or discarding. **Cmd+K** opens the normal command palette; **Cmd+Shift+K** finds a
file with a preview. **Cmd+Shift+B** toggles the sidebar. Use Ctrl instead of Cmd
on Windows/Linux. Follow wiki or Markdown links, and use the collapsible backlinks
below the file tree. **Preview** shows
rendered Markdown with image embeds. The normal Vim editor, explicit save,
unsaved dot, and live preview are available. Registration and indexing never
change note contents; saving an edit does.

Wiki image embeds support dimensions such as `![[image.png|320]]`. Backlinks
include source line numbers. Link indexing recognizes heading and block
fragments, but resolution is at note level. The viewer can jump to simple ATX
headings; full Obsidian heading/block resolution, frontmatter aliases, note
transclusion, plugin syntax, and vault-wide text search are not included.
Ambiguous basename matches remain unresolved.

## Watching and indexing

```sh
med index                 # Reconcile all registered vaults
med index vault_SOURCE_ID --wait
med status
med remove vault_SOURCE_ID
med stop
med serve                 # Foreground mode for debugging or an OS service manager
```

The server debounces filesystem changes and queues one short-lived index process
at a time. A 60-second reconciliation pass catches missed events and supports
systems without a working recursive watcher. `status` reports watcher and index
state. While an update runs, the browser can read the last completed backlinks.
The server does not keep a worker pool alive between index jobs.

The index stores file fingerprints and link occurrences, not note bodies or
image bytes. Code, math, HTML comments, and frontmatter are excluded. A path
addition, rename, or removal triggers link re-resolution; ordinary edits replace
only the changed notes' links. Hidden/dependency folders and symlinks are excluded.
Notes over 4 MiB or invalid UTF-8 report failures and retry on the next pass.
There is a 100,000-file catalogue limit and a 1,000-occurrence backlink display
limit. The virtualized tree shows the file hierarchy, including attachments.
The file picker shows the best 50 matches; narrow its query for larger vaults. Source paths and local indexes stay outside project files.

Removal stops watching and removes registration. Original files and rebuildable
cache remain. Stopping preserves registrations, saved reviews, and indexes.
Restarting restores the registered scope. The older `sources` and `vault`
commands are offline tools; stop the managed server before using them.

## Optional login service

On macOS, install at a stable executable path, then explicitly opt in:

```sh
med stop
med service install
# Later:
med service uninstall
```

Normal commands never install a login service. Installation uses a per-user
LaunchAgent; it starts at login and restarts after an abnormal exit. `med stop`
is a clean stop. To disable future login starts, uninstall the service. Keep the
executable at its installed path. Other systems can run `med serve` under their
own service manager. Logs are in the selected state directory's `service.log`.

## Single executable and offline docs

From the Workbench checkout, install with `bun install` at the root, then:

```sh
cd apps/med
bun run build:executable
./dist/med docs vaults
./dist/med web
```

The executable includes Bun, browser assets, fonts, workers, and version-matched
CLI guides. End users do not need the checkout, Node, or Bun. Git remains an
external requirement for repository features. Optional Ctags/Zoekt search tools
are separate. An existing Zoekt cache can be used by the executable. On a fresh
machine, `--setup-search` currently requires the checkout and Go because the
Go helper sources are not embedded. Download the macOS Apple Silicon executable
from the [Med release](https://github.com/zsh-eng/workbench/releases/tag/med-v0.1.0).
See [installation](https://github.com/zsh-eng/workbench/blob/med-v0.1.0/apps/med/docs/INSTALL.md).
This release is not Developer ID signed or notarized.

## Private benchmarks

Use `scripts/copy-vault-benchmark.py /path/to/vault` to create an independent
copy in the system temporary directory. It copies visible regular files and
attachments, excludes hidden/dependency folders and symlinks, and writes a
manifest beside the copy. It never initializes a Git repository. Copying is
not an atomic snapshot if another application edits the vault during the copy.

Then run:

```sh
bun scripts/benchmark-vault.ts --copy /private/tmp/med-vault-benchmark-EXAMPLE/vault \
  --output /private/tmp/med-vault-benchmark-EXAMPLE/results.json
```

The benchmark requires that copy manifest and rejects paths inside a Git
repository. It uses fresh index files, measures three independent processes,
checks an edit and deletion using its own temporary fixture, and records phase
traces without note text or filenames. Use a new output directory for each run.
The filesystem cache is not flushed. Results measure the index engine, not
browser rendering or end-to-end CLI startup.

Never commit a vault, its index, attachment bytes, or private source paths.
Only synthetic integration fixtures and aggregate benchmark results belong in
source control. See `docs/validation/VAULT_INDEX.md` for the measured results.
