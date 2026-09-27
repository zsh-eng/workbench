# Registered sources and vault indexing

Status: CLI indexing foundation. The browser Obsidian mode, live filesystem
watcher, and full standalone application release are not implemented yet.
No community plugins run. A vault does not need Git.

## Register sources

From the Med app directory, use Bun or the built CLI:

```sh
bun src/cli/index.ts sources add repo /path/to/repository
bun src/cli/index.ts sources add vault /path/to/vault --index
bun src/cli/index.ts sources list
```

Each command prints JSON. Registration returns a stable source ID. Repository
IDs use the canonical Git common directory; vault IDs use the canonical folder.
These source types stay distinct even when a vault is also a Git repository.
The CLI validates the registered directory before indexing it again.

Use `--state-dir /path/to/state` or `MED_STATE_DIR` for a separate setup. The
default is `~/.local/state/med`. Keep state outside the vault. Registration and
indexes are local SQLite files, not project files. Registering a source does
not read every note, edit files, or automatically expose it through a running
host. `--index` requests indexing explicitly and applies only to vaults.

Launch the repository viewer with saved repository registrations:

```sh
bun src/cli/index.ts --registered
```

This selects registered repositories only. Vault browser navigation is a later
step. Explicit repository arguments still work as before.

## Index and inspect backlinks

```sh
bun src/cli/index.ts vault index vault_SOURCE_ID
bun src/cli/index.ts vault backlinks vault_SOURCE_ID 'Notes/Example.md'
```

An index pass enumerates visible regular files and parses changed Markdown
notes. It stores outgoing links, their source line/offset, resolved destinations,
and embed markers. It does not store note bodies or image bytes. Backlink
queries return up to 1,000 occurrences, with a truncation flag and the timestamp
of the last index run. Run `vault index` after external changes; this CLI version
does not watch the filesystem. Unindexed vaults report an error, not empty backlinks.

The parser recognizes wiki links, heading/block fragments, image embeds, and
Markdown links/reference links. Code, math, HTML comments and frontmatter are
excluded. Display labels and image dimensions do not change link destinations.
The index resolves note-level destinations; it does not validate a heading or
block inside the target. Ambiguous basename matches remain unresolved. Full
Obsidian path-resolution parity, frontmatter aliases, note transclusion and
community plugins are outside this foundation.

Hidden files/folders, `node_modules`, `__pycache__`, `venv`, and symlinks are
excluded. Notes over 4 MiB or invalid UTF-8 report failures and are retried on
the next pass. The catalogue has a 100,000-file limit. The response includes
failure and unresolved-link counts; unresolved links are not silently discarded.
A path addition, rename, or removal triggers link re-resolution. Ordinary edits
only replace the changed notes' outgoing links.

```sh
bun src/cli/index.ts sources remove vault_SOURCE_ID
```

Removal deletes only the registration. It preserves original files and the
rebuildable cache. None of these commands modifies `.obsidian` settings.

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
