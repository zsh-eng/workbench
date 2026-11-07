# Find files and code

**Find file** (`⌘⇧K`) searches the current repository. Type part of another
registered repository's name and press **Tab** to search that one; the scope
shows its full path, so clones and worktrees stay distinct. Backspace in an
empty field, **Clear filters**, or the scope button goes back.

Vault notes need no scope. Type part of a note's name, and up to three notes
whose names hold each word show at the top, marked **Note** with the vault's
name and folder; `↵` opens one. A vault is also a scope: its chip beside
**Code**, **Tests**, and **Docs**, or its name and **Tab**, searches only its
notes, such as a plan that an agent works from. The note opens in this
workspace's tabs, beside the thread, rendered to read; its wiki links stay in
the vault, and `⌘⇧V` edits and saves it in place. With spaces, a query matches
each of its words, so `study plan` finds `study-plan.md`.

Combine **Code**, **Tests**, and **Docs**, or type filters such as
`type:tests ext:java,kt`. Values in one filter match any; the two filters must
both match. Test files follow each language's conventions, such as `.test.ts`,
`_test.go`, `test_*.py`, `*Test.java`, and `src/test/`. In Find file, `↵` opens
the file.

Every open makes a tab that stays until you close it: Find file, a click in
the Files pane, a link, a search result, and Go to definition. A file that is
open already shows its tab, at the line when the open names one. In the Files
pane, the arrow keys move without opening files, and `↵` opens the selected
one. `⌘`-click opens a file in the background. A middle click on a tab closes
it. A workspace holds 24 file tabs; when the row is full, a new file takes the
place of the oldest tab without an unsaved draft.

Right-click a file in a tree or tab for **Reveal in Finder**, **Copy path**,
and **Copy relative path**.

**Open in**, above a working-tree file, opens it elsewhere at the cursor's
line, each item with a letter while the menu is open:

- The code host by its address, such as `github.acme.build` (`G`): the file
  at the same line on the branch's page. Med reads the host from the remote
  that the branch pushes to, or origin. github.com is GitHub; Med asks any
  other host once, through `/api/v3/meta`, and a host that answers is GitHub
  Enterprise. A branch that is not pushed has no page, so the item reads
  **Push to open**.
- The editors on this Mac, each with the first free letter of its name:
  VS Code (`code -g`), Cursor (`cursor -g`), Zed (`zed path:line`), and
  IntelliJ IDEA (`idea --line`). Med finds each one's tool on `PATH`, or in
  its app in /Applications.
- **Reveal in Finder** (`R`), **Copy path** (`P`), and **Copy link** (`L`),
  the code host's link. The panel button beside **Esc**, or **Hide file
  preview in Find file**, hides the preview in every picker and window.

## Search file contents

**Search file contents** (`⌘⇧F`) opens the workspace's **Search** tab, after
Commit in the tab row, or shows it when it is open. Selected text becomes the
query; else the tab keeps its query and selects it. The tab's label is the
query. While you type, the label changes when typing pauses, so the tabs after
it do not move with each key. Results show as you type, by file, with each
file's path and line numbers. Each match shows two lines above and below it;
matches whose lines meet share one excerpt. The lines have the file view's
syntax colors, and the query is marked in them. Med reads and highlights only
the files near the view, so a long list stays fast. **Aa** or `⌥C` matches
case: the search finds the text only as typed, so the first 200 lines are all
lines that match. The workspace keeps the choice, also after a reload. The
search does not take regular expressions. `↑` and `↓` move through the
matches, and `↵` or a click opens one at its line in a file tab; a click on a
line around a match opens the file at that line. The Search
tab stays, with its query, results, and scroll. `Esc` shows the tab that
showed before. Close the tab with its **×**, a middle click, or `⌥W`. Each
workspace has one Search tab, as in Zed, so `⌘⇧F` always goes to the same
place; a new query replaces the old one. A reload keeps the query.

The tab searches the workspace's checkout, such as a thread's worktree.
`repo:name` searches another registered repository, in its main checkout,
instead; add more to search several, or type `repo:*` for every one. A match
in another repository opens in that repository's workspace. An old search
link (`/search?q=…`) opens the Search tab with its query.

Search reads the working files of the checkout, as an editor does: tracked
files with their uncommitted changes, and untracked files that Git does not
ignore. A match opens the working file, which you can edit, at its line. Git
searches them; a checkout of 20,000 files takes about 0.4 s. A checkout with
more than 20,000 files searches its last commit in the Zoekt index instead,
when the index has that commit. Then its results leave out uncommitted
changes, open at that commit, and the tab says so. A review outside the
workspaces, such as a patch file, uses the content picker instead of the tab.

[Zoekt](https://github.com/sourcegraph/zoekt) makes search of commits and of
very large checkouts faster, and gives project symbols in checkouts of more
than 20,000 files. Setup builds pinned helpers once and needs Go
(`brew install go`) and a built Workbench checkout. In its `apps/med` folder:

```sh
node dist/cli.js --setup-search
```

After that, Med needs only the helpers in the cache: no container, service, or
Git hook. The `med` executable uses a cache that is already there. The first
content or project-symbol search starts a search service for the repository,
which indexes in the background. Med indexes up to 64 branch tips in each
repository, worktree branches first, and updates the index when commits change.
Until the index is ready, Git answers: in a checkout, from its working files.

Without the index, search says nothing about it while Git answers. Once in a
run, a Git search that takes a second or more adds a quiet line that the index
would make it faster. **Symbols in the project** (`⌘⇧O`) at a commit, or in a
checkout of more than 20,000 files, needs the index; without it, the picker
says so, and **Symbols in this file** (`⌘O`) still works.

The cache is `~/.cache/med/search`, or `$XDG_CACHE_HOME/med/search`. Set
`MED_SEARCH_CACHE` to move it, or `MED_ZOEKT_BIN` to a folder that has
`zoekt-git-index` and `med-zoekt`.

## Symbols and Vim navigation

![In-file symbol palette with a live jump in the current file](../validation/symbol-navigation.png)

**Symbols in this file** (`⌘O`) starts at the symbol nearest the cursor and
ranks ties by distance. Arrow keys jump in the file; Enter keeps the position,
and Escape restores it. **Symbols in the project** (`⌘⇧O`) searches the
checkout's working files, with their uncommitted changes, and has its own
preview. Both keep the last query, and both work in any view of a checkout.
With no file open, `⌘O` says so and offers the project.

Symbols come from Universal Ctags (`brew install universal-ctags`). Project
symbols need no index: Med parses the files that Git tracks or does not
ignore, up to 1 MiB each and without JSON or XML data, when the picker opens,
and then only the files that changed. A commit, and a checkout of more than
20,000 files, use [Zoekt](#search-file-contents). Languages follow the
installed Ctags parsers; Ctags 6.2.1, for example, has no Zig parser, but text
search still works for Zig.

Vim navigation is on by default; the command palette turns it off for this
browser address. Files take focus when they open, in Normal mode:

- `h j k l`, `w b e`, `0 ^ $`, and counts such as `10j`.
- `gg`, `G`, `42G`, `:42` then Enter, `{` and `}`, and `Ctrl+D` and `Ctrl+U`.
- `f`, `F`, `t`, and `T` with `;` and `,`; `Shift+A` for the end of the line.
- `zz`, `zt`, and `zb` put the line at the middle, top, or bottom.
- `v` selects characters and `V` whole lines. Extend with motions; `o` goes to
  the other end, `y` copies, and Escape cancels. A selection can include lines
  outside the view.
- Text objects: `iw` and `aw`, `iW` and `aW`, `ip` and `ap`, quotes (`i"`,
  `a'`, backtick), and brackets (`i(`, `a[`, `i{`, `ib`, `aB`). Counts such as
  `v2i(` and repeated objects expand outward. Brackets are text pairs, not
  syntax.
- `/` and `?` search live, `n` and `N` step, and `*` and `#` search for the word
  at the cursor. An uppercase letter makes a search case-sensitive. Enter
  accepts; Escape cancels or clears highlights.
- `gd` finds declarations of the word at the cursor, first in the file, then
  in the project index. Several candidates open a picker. Ctags does not
  resolve types or imports as a language server does.
- `''` returns to the line of the previous jump, and two backticks to its exact
  column; repeat to swap. `ma`–`mz` set marks, and `'a` or backtick-`a` go to
  them. Marks and jumps reset when the file reloads.

While a Vim pane has focus, `?` searches backward and `⌘K` still opens the
command palette.

Command-click a diff's filename, or a file in the Changes list, to open it in a
background tab. When you close the file on screen, the tab that showed before
it shows again: a file, Changes, Review, Notes, Commit, or Search, as in VS
Code and Zed. **Close all files** (`⌥⇧W`) does the same and keeps Search.
**Close other files** (`⌥⇧O`) keeps the file on screen. Right-click a file tab
for **Close**, **Close other files**, and **Close all files**.
