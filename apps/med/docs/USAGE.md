# Using med

[Back to the overview](../README.md).

## Setup

For macOS Apple Silicon, download the executable from the
[Med release](https://github.com/zsh-eng/workbench/releases/tag/med-v0.1.6).
See [installation](https://github.com/zsh-eng/workbench/blob/med-v0.1.6/apps/med/docs/INSTALL.md)
for checksum verification and setup. Node, Bun, and a checkout are not required.

To build from Workbench, install dependencies at the root, then build the
single executable from the app directory:

```sh
bun install
cd apps/med
bun run build:executable
./dist/med add /path/to/repository
./dist/med web
```

Put the executable on your PATH to use `med` directly. It includes the runtime,
browser assets, fonts, workers, and offline guides. Git is required for repository
features. The macOS release is not Developer ID signed or notarized.

`med web` starts one background server and opens the browser. Closing the terminal
or browser does not stop it. Use `med status` and `med stop`. Sources persist in
`~/.local/state/med`; the default port is **4173**. Use matching `--port` and
`--state-dir` options for another profile. Med does not silently choose another
port. `med serve` runs in the foreground. Optional macOS login startup requires
an explicit `med service install`.

After a rebuild, an open page tells you when Med is out of date. **Restart**
replaces a server that runs older code; **Reload** loads a newer page. Med first
checks that the new build starts. If it does not, the current server keeps
running and the notice shows the error. A server started with `med serve` or
`med-diff` in a terminal asks you to restart it there.

### Install as an app

Open Med in Chrome or Edge, then select the install icon in the address bar, or
**Install Med** in the browser menu. Med then has its own window and Dock icon,
without browser tabs or a toolbar. The title bar follows the Med theme. The app
uses the background server: run `med service install` to start the server at
login. Each port is a separate app. Med does not keep an offline copy of the
interface, so a new `med` version shows when the window opens again.

Use `med add /path/to/vault` for Obsidian, or `--type vault` for a Markdown folder.
See [vaults, watchers and service commands](VAULTS.md). `med docs usage` prints this
guide offline. Existing `node dist/cli.js ...` and `med-diff ...` commands remain
available as legacy foreground modes; do not run them on a managed service's port.

### Multiple repositories

```sh
med add /path/to/frontend
med add /path/to/backend
med web
# Development:
bun run dev -- /path/to/frontend /path/to/backend
```

Use the branch switcher at the top of the sidebar, or `⌘⇧G` / `Ctrl+Shift+G`, to search the registered repositories' branches and worktrees. The picker shows repository groups and worktree paths. Add another repository by entering its local path in the picker. Remove a repository there to close its views and release its resources; this does not delete files or Git branches.

Opening the launch URL starts with one workspace. In the branch picker, `↵` opens the branch in the current workspace, and `⌘↵` / `Ctrl+Enter` (or a ⌘-click) opens it as a new workspace. See [Workspaces](#workspaces). The history, files, content search, and symbols all use the workspace's repository and branch or worktree. Content search still reads committed content.

Linked worktrees belong to one repository entry. Separate clones remain separate entries, even when they use the same remote. Managed service registration persists across restarts, including changes from the branch picker. Legacy foreground registration lasts for that server session. Patch and file-pair inputs remain separate launch modes.

### Workspaces

A workspace is one task: a branch or worktree, a saved review, or a registered vault. Each one keeps its own comparison, open files, notes, and scroll position.

- The **Workspaces** list at the top of the left sidebar appears once two are open. Registered vaults are pinned first, then the home workspace, which opens on the default branch. Each row shows the number of changed files.
- `⌘1`–`⌘9` / `Ctrl+1`–`Ctrl+9` show the workspace at that place in the list.
- `⌃Tab` shows recent workspaces. Hold Control and press Tab to step; release Control to go. A quick `⌃Tab` returns to the previous workspace. The palette command **Switch workspace…** does the same without a held key.
- **+** in the list, or **New workspace…** in the palette, opens the branch picker for a new workspace. Opening a saved review link adds a workspace for that review.
- Select a row and press `Delete`, or click its **×**, to close it. Vaults and the home workspace stay.
- A review that an agent creates joins the list in every open Med window, marked new with an accent dot until you open it. An agent that passes `--open` also shows the review in the window you used last. See [agent integration](AGENT_INTEGRATION.md#create-a-review).

The four most recently shown workspaces stay loaded; switching between them is immediate. Only the workspace on screen receives live updates; the others catch up when you return. Older workspaces load again when you open them. The list and the active workspace persist across reloads and restarts, and windows share the list; each window keeps its own workspace on screen. The address follows the active workspace: a saved review keeps its `/review/<id>` link, and Back and Forward move between workspaces.

Browsers keep `⌘1`–`⌘9` and `⌃Tab` for their own tabs. Use the installed app window, `Ctrl+1`–`Ctrl+9`, or the palette in a browser tab.

### Pull requests

Run `med pr checkout 333` inside a repository. Med runs `gh pr checkout 333`,
fetches the pull request's base branch, and opens a saved review of the pull
request: its merge base with the base branch, compared with its head. The review
title and heading link to the pull request. Med starts its background server
and registers the repository when needed. Requires the GitHub CLI (`gh`),
signed in. Pass `gh pr checkout` options through, such as `--force` or
`--branch <name>`; `--no-open` prints the launch URL instead of opening it.

### Saved agent reviews

An agent can use the running host to save a commit range or capture working changes, then return a clean local review link. Open the launch URL once in the browser to authorize access. Saved links in that browser then use the same local session.

A saved review opens its first target. Select other repositories or ranges from **Review target**. The saved diff and comment context stay fixed even when agents make more changes. **Copy comments** includes comments from all targets in that review, with repository paths, revisions, line numbers, selected source, and adjacent lines. Open **Review** for details. **Clear**, next to **Copy comments**, clears only that review after confirmation. Copying does not clear comments.

Saved reviews and their comments persist in `~/.local/state/med`. Normal branch review notes still end with the host process. See [agent integration](AGENT_INTEGRATION.md) for commands, state settings, limits, and suggested `AGENTS.md` guidance.

### Briefs

A brief is the agent's explanation of a review, in Markdown. Its links open the lines they cite, so you can read the changes in the order the agent explains them.

- **Attach.** Copy the agent's last message and press `⌘V` anywhere outside a text field. On a saved review, med attaches the brief. On live changes, med asks for a title and saves the comparison as a review first, so the links keep pointing at the code they describe. Agents can also attach one at creation with `review create --brief`.
- **Read.** The **Brief** tab comes before **Changes**. Below each paragraph that cites lines, a short diff excerpt shows those lines. `]` and `[` step through the excerpts. Hover a link to highlight its excerpt.
- **Jump.** Click a link or an excerpt heading to open those lines in **Changes**, selected and centered.
- **Comment.** Hover a line in an excerpt and click **+**; drag it to cover more lines. You can also select line numbers and press `c`. These are the same notes as in **Changes**, so **Copy comments** includes them. The excerpt heading counts its notes.
- **Check coverage.** The header shows how many changed files the brief cites. **Not in the brief** lists the changed files it never mentions; read those yourself.
- **Replace or remove.** Paste again to replace the brief. **Undo** in the confirmation restores the previous one. The **⋯** menu also copies or removes it.

med resolves `path`, `path:12`, `path:12-20`, `path#L12-L20`, absolute paths in the repository, editor links, and GitHub blob URLs. A path can be a suffix, such as `App.tsx:42`, when only one changed file matches. A path outside the change opens the file instead. Changing a brief does not change comments.

Review endpoints can be branch names: `review create --repo /path/to/feature-worktree --base main --head HEAD`. This compares the tips directly and saves their exact commits. Use the common ancestor for a pull-request-style diff, and create a new link after merging the base branch. See [branch comparisons](AGENT_INTEGRATION.md#compare-with-a-base-branch) for commands. In the app, **Compare revisions…** accepts the same refs.

### Indexed branch search

Set up the optional [Zoekt](https://github.com/sourcegraph/zoekt) search helper once. This command builds pinned binaries and saves them in the user cache:

```sh
node dist/cli.js --setup-search
# Run from the built Workbench checkout. Requires Go.
```

The standalone executable reuses an existing Zoekt cache. Initial setup needs
the Workbench checkout and Go; the Go helper sources are not embedded. If Go is missing, install it with `brew install go` on macOS or `sudo pacman -S go` on Omarchy, then repeat the command. Normal use needs only the compiled binaries, not Go. There is no Docker container, system service, or Git hook to install.

Start med as usual. The first content or project-symbol search starts that repository's search service and builds its index in the background when the helper is installed. Listing repositories does not start indexing. **Content search reads committed branch content** and opens results from the exact commit shown in the picker. Unsaved, uncommitted, and untracked content is not included. The file-name picker and Files sidebar still browse the current worktree.

Active search services check branch commit IDs when repository watchers report changes, with a 10-second poll as a backup. New commits trigger incremental index builds. Adding or deleting an indexed branch triggers a full rebuild. Index builds share one queue across repositories. Up to 64 local branch tips are indexed per repository, with branches used by worktrees given priority. At most four search services remain active; an idle service can close and restart when needed. Its disk cache remains available.

If the helper is missing, the index is rebuilding, or indexing fails, search falls back to Git against the same committed content. Historical commits outside the index also use Git. You can use the app during the initial build.

The default cache is `~/.cache/med/search`, or `$XDG_CACHE_HOME/med/search` when set. Use `MED_SEARCH_CACHE` to choose another location. For an existing helper build, set `MED_ZOEKT_BIN` to the directory containing both `zoekt-git-index` and `med-zoekt`.

The [integration report](validation/ZOEKT_INTEGRATION.md) includes a search screenshot, data flow, checks, and built-host API timings. The [engine benchmark](validation/ZOEKT.md) records index costs and a ten-branch workload. These measurements exclude browser rendering.

### Other inputs

```sh
node dist/cli.js --patch change.patch
git diff | node dist/cli.js --patch -
node dist/cli.js --files old.ts new.ts
```

To check the packaged launch path locally:

```sh
npm pack
npx --yes --package ./med-diff-0.1.0.tgz med-diff /path/to/repository
bunx --package ./med-diff-0.1.0.tgz med-diff /path/to/repository
```

The legacy JavaScript CLI uses Node, including when launched through `bunx`. The package serves compiled assets; it does not need a Vite development server.

## Files across repositories

Open **Find file** with `⌘⇧K` / `Ctrl+Shift+K`. Type part of a registered
repository name, then press **Tab** to scope the picker to it. Arrow keys and
Enter also select repository rows. The scope shows its full path, including
worktree paths, so separate clones and names with spaces remain distinct.
Only the chosen repository's file list is requested. Med does not scan nearby
directories or register repositories from this picker.

Combine **Code**, **Tests**, and **Docs**, or type `type:tests ext:java,kt`.
Categories and extensions each use OR; the two groups combine with AND.
For example, `type:code type:docs ext:java,md` finds Java source and Markdown,
excluding test files. Test icons use language conventions such as `.test.ts`,
`_test.go`, `test_*.py`, Java `*Test.java`, and `src/test/` source paths.
An ordinary name such as `Contest.java` is not a test.

Remove an extension chip, use **Clear filters**, or press Backspace in an empty
input to return to the current repository. The scope button also goes back.
Escape closes the picker and restores focus. Opening a result keeps the review
in place and opens a file tab with the selected repository identity. Picking
and previewing files never saves or changes their contents.

## First review

1. Select a commit in the left history panel, or select working changes. Commit diffs compare with the first parent; merge commits are labeled accordingly. Click **History** to collapse the panel to one line that names the selection; med remembers this choice.
2. Select a changed path to move to it in the diff stream. Double-click the path to open its current file in the selected worktree.
3. Use the branch switcher (`⌘⇧G`) to open another branch here, or `⌘↵` to open it as a new [workspace](#workspaces). A branch with a worktree opens that directory; a branch without one opens committed content.
4. Use the file picker or right Files sidebar to open unchanged files. A preview does not replace your current review until you open it.
5. Toggle blame in a full file to show author and commit details beside the line numbers. Visible lines preload in the background after a file opens. Toggling blame reuses this cache. Hover a label for 250 ms to see the date and commit message; move to nearby labels for immediate updates. Open the command palette to change theme or find other actions.

Drag the gutter **+** across lines to start a note for the whole range. You can also drag over line numbers, or click the first number and Shift-click the last number on the same diff side, then click **Add note**. The saved comment keeps the full range.

Shift-click another commit to select an inclusive range. The comparison runs from the oldest selected commit's first parent to the newest selected commit. A root commit uses the empty tree. This compares endpoint snapshots; it does not add individual patches across merged branches. Shift+Up/Down extends the selection; a plain click resets it.

| Action                            | macOS        | Omarchy Linux             |
| --------------------------------- | ------------ | ------------------------- |
| Keyboard shortcuts guide          | `?`          | `?`                       |
| Command palette                   | `⌘K`         | `Ctrl+K`                  |
| Find a file                       | `⌘⇧K`        | `Ctrl+Shift+K`            |
| Symbols in current file           | `⌘O`         | `Ctrl+O`                  |
| Symbols in project commits        | `⌘⇧O`        | `Ctrl+Shift+O`            |
| Search file contents              | `⌘⇧F`        | `Ctrl+Shift+F`            |
| Open a branch or worktree         | `⌘⇧G`        | `Ctrl+Shift+G`            |
| Show workspace 1–9                | `⌘1`–`⌘9`    | `Ctrl+1`–`Ctrl+9`         |
| Switch to a recent workspace      | `⌃Tab`       | `Ctrl+Tab`                |
| Toggle history / files sidebar    | `⌘B` / `⌘⇧B` | `Ctrl+B` / `Ctrl+Shift+B` |
| Zen mode                          | `⌥Z`         | `Alt+Z`                   |
| Add note to selected lines        | `c`          | `c`                       |
| Paste a brief                     | `⌘V`         | `Ctrl+V`                  |
| Next / previous brief excerpt     | `]` / `[`    | `]` / `[`                 |
| Resume search                     | `⌥R`         | `Alt+R`                   |
| Keep preview tab                  | `⌥P`         | `Alt+P`                   |
| Toggle gutter blame               | `⌥B`         | `Alt+B`                   |
| Close current file                | `⌥W`         | `Alt+W`                   |
| Close all files in this workspace | `⌥⇧W`        | `Alt+Shift+W`             |
| Close other files                 | `⌥⇧O`        | `Alt+Shift+O`             |

Close actions preserve the Changes tab and other workspaces. Desktop or browser shortcuts can take priority over a web app; the command palette provides the same actions.

`?` opens the shortcuts guide on your current context: Review, a read-only File,
the Editor, or Pickers. Type to search every context by action or by key, such
as `close`, `zz`, or `⌘K`. Sequences show a `›` between keys; dashed keys are
values you type, such as a character or mark. Enter runs a highlighted row that
has a command. Keys follow your platform: `⌘ ⌥ ⇧` on macOS, `Ctrl Alt Shift`
elsewhere.

### Zen mode

Press `⌥Z` / `Alt+Z`, use the focus button at the top right, or run **Enter zen
mode** from the command palette. Zen mode hides every bar: branch and file tabs,
the Changes toolbar, and the status bar. Only the diff or file remains. `⌘B` and
`⌘⇧B` still show the history and files sidebars inside zen mode, so you can move
between files. To leave, press `⌥Z` again or move the pointer to the top-right
corner and click **Leave zen**. Escape does not leave zen mode, so it stays free
for search, Vim, and dialogs. Leaving restores the previous layout; the setting
is remembered in this browser.

## Symbols and Vim navigation

Command-click a diff filename or a file in the Changes list to open a pinned background tab without leaving Changes. Use Ctrl-click on Linux. Closing the active file selects the file to its right, then its left; Changes is selected only when no files remain.

![In-file symbol palette with a live jump in the current file](validation/symbol-navigation.png)

In-file symbol search (`⌘O`) opens a narrow palette over the left sidebar. It starts with the symbol nearest to the cursor. Typed matches keep name relevance first, then use cursor distance to break ties. Arrow keys jump in the current file and highlight the symbol name. Enter keeps that position; Escape restores the original cursor and scroll position. Project symbol search (`⌘⇧O`) keeps a separate file preview and searches the selected repository’s indexed commit. Both palettes retain and select the last query.

Symbol extraction uses Universal Ctags. Install it with `brew install universal-ctags` on macOS or `sudo pacman -S ctags` on Omarchy. The project index and individual file extraction share this binary. Project symbols require the optional Zoekt setup above. After updating from a text-only search build, run `node dist/cli.js --setup-search` again to install the updated helper. Existing text-only indexes rebuild when symbol extraction is enabled. Language coverage follows the installed Ctags parsers: Universal Ctags 6.2.1 covers TypeScript and C/C++, but does not include a Zig parser. Text search still works for Zig.

Vim navigation is enabled by default. Use the command palette to disable or enable it. This preference is saved for the current browser address. Files take keyboard focus when opened, ready for normal-mode navigation:

- `h j k l`, `w b e`, `0 ^ $`, and counts such as `10j`.
- `v` selects characters; `V` selects whole lines. Use motions to extend the selection, `o` to move to the other end, `y` to copy, and Escape to cancel. Selection and copy include source lines outside the visible view.
- `viw` selects a word or punctuation group; `vaw` includes adjacent spaces. `viW` / `vaW` select a non-space WORD, including its punctuation. `v2iw` selects the word and the next space group; `v2aw` selects two words.
- `vip` selects the current paragraph; `vap` includes the adjacent empty lines. Empty lines separate paragraphs; a line with only spaces stays in its paragraph. `v2ap` selects two paragraphs. Repeat `ip` or `ap` in visual mode to extend the selection.
- `vi"` / `va"`, `vi'` / `va'`, and backtick objects select quoted text on the current line. Inner objects omit the quotes; around objects include the quotes and adjacent spaces. Escaped quotes stay inside the selection.
- `vi(` / `va(`, `vi[` / `va[`, and `vi{` / `va{` select nested bracket contents or the whole pair across lines. Closing brackets work too; `ib` / `ab` are parentheses and `iB` / `aB` are braces. A count such as `v2i(` selects the next outer pair. Repeat the object to expand outward. These are lexical pairs; they do not parse language syntax.
- `gd` finds declarations for the identifier at the cursor. It first checks the current file with Universal Ctags, then the ctags-backed project index. Multiple candidates open a picker; project results open their indexed commit. Ctags does not resolve types or imports like an LSP.
- `gg`, `G`, `42G`, `{` / `}` for paragraphs, and `Ctrl+D` / `Ctrl+U` for half pages.
- `''` returns to the previous jump's line at its first non-space character; double backtick returns to the exact column. Repeating either swaps between the two locations. Line-number jumps, file/paragraph jumps, search matches, and accepted in-file symbol/definition jumps record the origin. Cancelled previews do not.
- `ma` through `mz` set local marks; `'a` goes to mark a's line and backtick followed by `a` goes to its exact position. Marks and jump-back are local to the current loaded file snapshot. They reset when the file changes or is reloaded; cross-file jump history and persistent marks are not included.
- `f` / `F` / `t` / `T` followed by a character, `;` / `,` to repeat, and `Shift+A` to move to the end of the line.
- `:123` then Enter to jump to line 123. Escape cancels; a number past the end goes to the last line.
- `zz` / `zt` / `zb` to place the current line at the middle / top / bottom of the view. These keep the cursor column. `zt` and `zb` leave four lines of space from the edge.
- `/` / `?` for live forward/backward file search, `n` / `N` for matches, and `*` / `#` for the word at the cursor. Lowercase queries ignore case; uppercase letters enable case-sensitive matching. The current match uses the theme accent and an underline; other matches use the search color. Enter accepts the preview. Escape cancels a preview and clears highlights; in normal mode it clears highlights while keeping the search.

Writable files open directly in Vim Normal mode. Press `i` to insert text. Commit snapshots and dropped files remain read-only. While a Vim file pane has focus, `?` searches backward; `⌘K` / `Ctrl+K` still opens commands. Palettes and text inputs keep their normal keyboard behavior. Symbol search does not require Vim mode.

## Edit working files

Eligible local and working-tree files open in Vim Normal mode. There is no
Edit/Done toggle: navigate immediately, then press `i` to insert text.
Use `i`, `a`, `o`, `dd`, `ciw`, visual selections, `p`, `.`, `u`, and Ctrl+R.
Vim Visual selections and mouse selections use the same visible selection colour.
Default yanks (`y`, `yiw`, `yy`) also copy to the system clipboard. Named and
black-hole registers retain their Vim behavior. ⌘⇧F / Ctrl+Shift+F searches the
selected text in the repository; ⌘⇧K / Ctrl+Shift+K opens the file picker in both
Normal and Insert modes. App shortcuts take precedence over Vim bindings, with
one exception on macOS: Control+B, Control+F, and Control+O in the editor reach
Vim (page up, page down, jump back) because Command runs Med's shortcuts. On
Linux these Control keys still run Med's sidebar, find, and symbol shortcuts.

Git blame keeps its gutter width while editing. Attribution is hidden while the
draft is unsaved or the disk contents have changed, and updates after saving.

Escape returns to Normal mode. `:w`, ⌘S / Ctrl+S, or **Save** writes the file.
`:wq` saves and closes the file only if the save succeeds.

A hollow dot means saved. A filled dot means the draft differs from the last
saved contents. Dirty tabs also show a dot. Undo after saving can make the file
dirty again. **Close file** / `:q` closes the tab; unsaved text requires an explicit
**Discard draft** or **Keep editing** choice. Saving does not stage or commit.

Drafts and undo history stay in memory across tab switches and tab closes. Open
the same working file to resume. Up to 24 drafts are retained; clean drafts can
be evicted at that limit. Reloading or closing the browser warns about unsaved
work but does not persist drafts. Vim starts in Normal mode when reattached.

If an agent or another process changed the file, saving reports a conflict and
keeps your draft. Copy any text you need before discarding and reopening the
current disk version. There is no force-save command. Files from commits and
saved review snapshots remain read-only; open the working-tree version to edit.
Editing is limited to existing, complete UTF-8 text files up to 1 MiB. Symlinks,
hard-linked files, and paths through nested repositories cannot be saved.
Uniform CRLF line endings and ordinary executable permission bits are preserved.

To link directly to a registered working file, URL-encode the canonical worktree
path and repository-relative file path:

```text
http://127.0.0.1:4173/file?repo=%2Fpath%2Fto%2Frepo&path=src%2Fexample.ts&edit=1
```

`edit=1` is optional; writable files open in Vim Normal mode. The browser must already be authorized
with the host's launch URL, as for saved review links. A file link opens live
working content; it does not freeze a review or register another repository.

## Development

med lives in `apps/med`. Install dependencies from the Workbench root with `bun install --frozen-lockfile`. The commands below run from `apps/med`; root shortcuts include `bun run dev:med`, `bun run build:med`, and `bun run check:med`.

```sh
bun run dev -- /path/to/repository
```

Open the Vite URL with the `#token=…` fragment printed by the API host. Vite proxies API requests to that host. Production builds need no proxy.

Run the complete check from the Workbench root:

```sh
bun run check:med
```

For a focused run, use `bun run test:med` for host integrations, browser tests,
and remaining unit regressions. `bun run --cwd apps/med test:e2e` builds med and
exercises the real CLI and browser with temporary repositories. See
[test design and coverage boundaries](TESTING.md) before adding tests.

To run the login service from Workbench's latest `main` on macOS:

```sh
bun scripts/track-main.ts install
```

The script builds `main` in a separate worktree under `~/.local/share/med`,
installs that executable as the login service, and adds a watcher. When `main`
moves, the watcher builds the new commit and restarts the service. Uncommitted
work in the checkout never reaches the service. A failed build keeps the previous
executable and shows a notification; `~/.local/share/med/update.log` has the
details. `bun scripts/track-main.ts uninstall` removes the watcher, the service,
and the build. Sources and reviews remain.

The UI uses React, [Pierre Diffs and Trees](https://pierre.computer/), Base UI, and StyleX. Vite 8 uses Rolldown and Oxc; Oxlint, Oxfmt, and Vitest provide checks. Zod validates the host protocol. [Architecture](../ARCHITECTURE.md) describes the boundaries and data flow.

## Limits and evidence

Syntax highlighting uses Twinkleplop. This build includes JavaScript/JSX, TypeScript/TSX, CSS, HTML, JSON/JSONC, Markdown, YAML, TOML, Bash, Go, Python, Rust, SQL, Svelte, diff, INI, HTTP, dotenv, and shell-session grammars. Markdown code fences use the matching installed grammar. C, C++, Zig, and other missing grammars display as plain text; files, diffs, selection, and comments still work. Syntax colours can differ from Shiki because semantic token kinds do not contain full TextMate scope stacks.

Images render in compact before/after diff cards. The file viewer also plays browser-supported videos. Other binary files and files with unsupported encodings show metadata only. Text above 8 MiB, 200,000 lines, or 250,000 characters on one line is not rendered. Large supported text uses plain rendering. File manifests stop at 50,000 entries. Missing files are shown as missing; historical content is not silently substituted. See [file browsing](FILE_BROWSING.md) for details.

History follows the selected worktree's HEAD ancestry. Shallow clones can lack the parent needed for a comparison. Blame has the same history limit and is unavailable for files without history or files that require Git content conversion.

This is a browser app backed by a local server. Native desktop packaging, shared persistent review notes, and complete Hunk feature parity are not implemented.

- [Search, definitions, commit ranges, and gutter blame](validation/REVIEW_NAVIGATION.md)
- [Hover prefetch, compact UI, and render diagnostics](validation/HOVER_AND_RENDERING.md)
- [Navigation validation and screenshots](validation/NAVIGATION.md)
- [Zoekt benchmark: setup cost, search latency, and reproducible harness](validation/ZOEKT.md)
- [Twinkleplop integration and timed comparison videos](validation/HIGHLIGHTER_INTEGRATION.md)
- [Baseline diff performance](validation/RESULTS.md)
- [Theme and workspace validation](validation/UI_UPDATE.md)
- [Feature status and navigation behavior](SNACKS_REVIEW.md)

Hunk's retained semantic source and tests carry their original [MIT notice](../upstream/HUNK-LICENSE). [Source provenance](../upstream/HUNK.md) records the pinned revision and adaptations.

Symbol and navigation validation: [Ctags and Zoekt benchmarks](validation/SYMBOL_SEARCH.md), [Vim cursor benchmarks](validation/VIM_NAVIGATION.md), [file symbol palette](validation/file-symbols.png), [Vim file search](validation/vim-navigation.png).

## Standalone files and dropped previews

Open **Open standalone file** from the command palette, or visit `/files` on the
running host. Use **Open file…** or **⌘O / Ctrl+O** in Files to enter an absolute
path. **⌘K / Ctrl+K** opens Files commands, including opening a path, switching
tabs, themes, and returning to repositories. Tabs and actions share one row.
Browser Back and Forward restore Files after switching to repositories.
The file does not need
to belong to a Git repository. Vim Normal mode, the saved-state dot, and
conflict-checked saves work as they do for working files. Both file toolbars are
32 px high. Files open ready to navigate without a mode-toggle toolbar.

To start a file workspace from a directory without Git:

```sh
bun run --cwd apps/med build
node apps/med/dist/cli.js --editor
```

An agent can print a link through the running host:

```sh
node /path/to/workbench/apps/med/dist/cli.js open /absolute/path/Example.java --line 42 --column 8
```

Add `--edit` to start in the editor. `--port` and `--state-dir` select the same
connection as review commands. The command prints a token-free Markdown link:
`http://127.0.0.1:4173/file/absolute/path/Example.java?line=42&column=8`.
The browser must first open the host's launch URL. **Copy link** is also available
in the standalone file tabs. These links read the current file, not a snapshot.
Paths are URL-encoded; the CLI handles spaces, Unicode, `#`, and other characters.
Opening one file grants host access to that exact file, not its parent directory.
The host retains at most 256 standalone file grants until restart.

Drop text, image, or video files anywhere in med for read-only previews. Dropped
files stay in the browser and have no disk-write control or agent link. Drop up
to 12 files at once; the workspace holds at most 24 tabs. Text is limited to
8 MiB per file, 24 MiB per drop, and 32 MiB retained. Media uses browser file
URLs and does not enter the retained text budget. Use **Open file** to edit a
file on disk. Drafts and dropped previews do not survive page reload.

## Images and videos

Image diffs show **Before** and **After** in cards under 240 px tall. Click the
header to collapse a card; click its filename to open the file viewer. Images
load near the visible area. The viewer fits images to its pane; **1:1** switches
to actual size. SVG, PNG, JPEG, WebP, AVIF, GIF, APNG, BMP, and ICO use the
browser's image decoder. TIFF, HEIC/HEIF, and JPEG XL depend on browser support.

The file viewer uses native video controls for play, pause, seeking, volume,
playback speed where available, and fullscreen. MP4/M4V, WebM, MOV, OGV, and MKV
are passed to the browser; actual playback depends on its installed codecs.
Unsupported or corrupt media gets an inline message. Med does not transcode.

Image files are limited to 32 MiB and videos to 4 GiB. Video bytes stream on
demand with byte-range requests, not through the text or syntax pipeline.
New saved reviews freeze image bytes within their existing 24 MiB per-target
capture budget. Older saved reviews may lack images; create a new review to
capture them. Videos are viewable files, not captured video comparisons.

## Full-file change markers

When opening a full file from a diff, the line-number gutter shows green bars
for added lines and red bars for deleted lines in the before version. A deletion
with no remaining row appears as a red tick at its gap in the after version.
Blue bars identify working-file additions and replacements. The header has a
compact color legend; each marker identifies its comparison on hover.

Markers use the selected comparison only when its captured text matches the
file being viewed. If live working content differs from that snapshot, markers
show changes against HEAD instead. **Open before** and **Open after** show the
exact commit versions. Markers are removed from stale views until refresh;
line numbers from an older snapshot are not applied to new content.

## Markdown preview

Open a `.md`, `.markdown`, `.mdown`, or `.mkd` file and select **Preview** in
its toolbar. The rendered pane sits beside the source, or below it in narrow
windows. The browser remembers whether Preview is open. It works in both the
file viewer and Vim editor, including read-only dropped Markdown.

The preview follows the source cursor and source scrolling. You can also scroll
it independently or use **On this page**, which appears when the preview has
at least 760 pixels of width. Editing updates the preview after a short pause;
it does not save the file. **Save** and Vim `:w` still control disk writes.

Rendering includes GFM tables, task lists, strikethrough, autolinks and footnotes;
inline and display LaTeX through KaTeX; Mermaid fences; syntax-colored code; and
images. A single source newline stays in the same paragraph. A blank line starts
a new paragraph; two trailing spaces or a backslash give an explicit hard break.
Headings use the system SF Pro font on macOS; body text uses Geist with a limited
line length. Motion follows the system reduced-motion preference.

Relative images in a standalone file must be in its folder or descendants.
Repository images resolve from the Markdown path within the same repository or
commit. PNG, JPEG, GIF, WebP, AVIF and SVG are supported, up to 8 MiB each. Remote
HTTP(S) images can load directly and send no referrer. Dropped files can show
remote and embedded raster images, but cannot find relative files on disk.
Opening an image does not grant permission to edit it. Raw HTML is omitted;
relative document links are shown but do not open another local file.

Preview is limited to 512 KiB of Markdown. Diagrams are limited to 20,000
characters and 500 edges. Invalid diagrams retain their source and a syntax
notice; invalid math remains visible. The source editor stays available when a
preview cannot render.

Try [the reading queue design note](examples/reading-queue.md), which includes
paragraphs, two diagrams, equations, a local image, a table and TypeScript.

Toggle Markdown Preview with **Cmd+Shift+V** on macOS or **Ctrl+Shift+V** on
Windows/Linux from anywhere in the app while a Markdown file is active. The toolbar button
shows the shortcut on hover. Contents links move the source cursor in both
editor and viewer modes; the preview follows the source position. In-document
anchor links stay within the preview.
Source scrolling follows fractional line positions with continuous interpolation
and a short ease-out; reduced-motion mode moves directly to the target.

Contents navigation gives the destination source line one soft, 650 ms accent
fade. It does not blink repeatedly or move the layout. Reduced-motion mode
omits this cue. The insert caret is 2 px wide, fully rounded, and follows the
normal caret's 65 ms ease-out movement.

### Links in Markdown preview

Click a relative file link to open it in a file tab. Paths resolve from the
displayed Markdown file's folder, including `../` and URL-encoded filenames.
Repository links stay in the same worktree or exact commit as the source file.
Standalone file links use the local file workspace; vault links use the vault
tabs. `#L42` suffixes select a line in repository and standalone files.

Same-page heading links keep their preview navigation. Web and mail links keep
their external behavior. Dropped previews have no disk location, so relative
file links are unavailable there. Missing files use the normal file-open error.

### Review titles and PR links

`med review create --title "Fix navigation" ...` uses that title in the browser
tab and review header. Add `--pr https://github.com/owner/repo/pull/123` to make
the heading a link. Without `--title`, med uses the matching PR title when `gh`
can resolve it. Single-repository GitHub branch reviews can infer the link;
`--no-pr` skips lookup. See [agent guidance](AGENT_INTEGRATION.md#titles-and-pull-requests)
for scope and fallback behavior. File tabs use the filename in the browser title.
