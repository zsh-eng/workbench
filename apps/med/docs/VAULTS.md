# Notes and vaults

Med opens Obsidian vaults and Markdown folders beside your repositories, with
links, backlinks, and a live preview. A vault does not need Git. Med does not
run community plugins or change `.obsidian` settings.

## Add a vault

```sh
med add ~/notes --wait
med web
```

`med add` finds a vault from its `.obsidian` folder; add `--type vault` for a
plain Markdown folder. `--wait` returns when the first index is ready.
`med list` shows each source with its ID. A vault's ID comes from its real
path, so the same folder keeps the same ID. If a vault's folder is gone, Med
keeps the registration and lists the vault as broken.

`web`, `add`, `list`, `remove`, and `index` start the server when it is not
running; `status` and `stop` do not. Keep the state folder
(`~/.local/state/med`) outside your vaults.

## Read and write

Open a vault from the **Sources** page or the workspace list. The sidebar has
the workspaces, the file tree, and backlinks, as in a review. Click a file to
preview it, and double-click to keep its tab. Edited files stay open, and a tab
with unsaved changes does not close until you save or discard them.

- `⌘K` opens the command palette, `⌘⇧K` finds a file with a preview, and `⌘B`
  shows or hides the sidebar.
- Follow wiki links and Markdown links. **Backlinks**, below the file tree,
  show each linking note with its line number.
- **Preview** renders the note with its image embeds. Edit in the Vim editor,
  with explicit saves, the unsaved dot, and the live preview; see
  [Markdown preview](USAGE.md#markdown-preview).

Registering and indexing never change your notes; only a save does.

### Obsidian syntax

Wiki image embeds take a width, such as `![[image.png|320]]`. Links to a
heading or a block resolve to their note, and Preview can jump to simple ATX
headings. Med leaves a link unresolved when more than one note has its name.

Med does not support full heading and block resolution, frontmatter aliases,
note embeds, plugin syntax, or text search across a vault.

## Watching and indexing

```sh
med status
med index
med index vault_SOURCE_ID --wait
med remove vault_SOURCE_ID
```

The server watches each vault and indexes changes in one short process at a
time. Every 60 seconds it also checks the whole vault, which catches missed
events and systems without a recursive watcher. `med status` shows the watcher
and index state, and `med index` checks every vault, or one, at once. While an
index runs, the browser shows the last complete backlinks.

The index keeps file fingerprints and links, not note text or image bytes. It
leaves out code, math, HTML comments, and frontmatter, as well as hidden
folders, dependency folders, and symlinks. Adding, renaming, or removing a file
resolves links again; an edit updates only that note's links. A note over 4 MiB
or with invalid UTF-8 fails, and Med tries it again on the next check. The
index and your vault's paths stay in the state folder, never in your files.

- A vault can have up to 100,000 files. The file tree shows them all, with
  attachments.
- Backlinks show up to 1,000 links.
- Find file shows the best 50 matches; type more to narrow a large vault.

`med remove` stops watching a source and removes its registration; the folder
and its rebuildable cache stay. `med stop` keeps registrations, saved reviews,
and indexes, and the next start watches the same sources. The older `med
sources` and `med vault` commands work offline; stop the server before you use
them.
