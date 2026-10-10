# Using med

[Back to the overview](../README.md).

## Setup

For macOS Apple Silicon, download the executable from the
[Med release](https://github.com/zsh-eng/workbench/releases/tag/med-v0.1.7).
See [installation](https://github.com/zsh-eng/workbench/blob/med-v0.1.7/apps/med/docs/INSTALL.md)
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

`med web` starts one background server and opens the browser. Closing the
terminal or browser does not stop it; use `med status` and `med stop`. Sources
persist in `~/.local/state/med`, and the default port is **4173**. Use matching
`--port` and `--state-dir` options for another profile; Med does not silently
choose another port. `med serve` runs in the foreground. Login startup is your
choice: **Open at login** in setup, `med service login on`, or
`med service install`.

After a rebuild, an open page tells you when Med is out of date. **Restart**
replaces a server that runs older code, and **Reload** loads a newer page. Med
first checks that the new build starts; if it does not, the current server
keeps running and the notice shows the error. The command palette has **Reload
Med** and **Restart Med server and reload** at any time. A server started with
`med serve` or `med-diff` asks you to restart it in its terminal.

### First run

When `med web` opens a server with nothing registered, Med shows one setup page.

- **Repositories** and **Obsidian vaults** list what Med finds in your home
  folder, most recently used first. Ones used in the last three weeks (vaults:
  two months) start selected. Linked worktrees, dependency folders, and hidden
  folders are left out. Desktop, Documents, and Downloads are searched only when
  you choose **Search them too**, because macOS asks permission first.
- **Add a folder by path** adds a repository or vault that the search missed.
- **Open at login** starts Med when you log in, from the next login.

Setup reads folder names and Git metadata only. Open it again with **Add
sources…** on the Sources page, or **Set up Med…** in the command palette. The
**Sources** page lists repositories and vaults; a row's **⋯** menu can index a
vault again, copy the path, or remove the source. Removal keeps the folder.

### Install as an app

In Chrome or Edge, select the install icon in the address bar, or **Install
Med** in the browser menu. Med then has its own window and Dock icon, and gets
the shortcuts that a browser keeps for its tabs. The app uses the background
server, so run `med service install` to start the server at login. Each port is
a separate app.

Use `med add /path/to/vault` for Obsidian, or `--type vault` for a Markdown
folder; see [vaults, watchers and service commands](VAULTS.md). `med docs usage`
prints this guide offline. The legacy `node dist/cli.js ...` and `med-diff ...`
foreground modes remain; do not run them on a managed service's port.

### Multiple repositories

```sh
med add /path/to/frontend
med add /path/to/backend
med web
```

The branch switcher at the top of the sidebar (`⌘⇧G` / `Ctrl+Shift+G`) searches
the branches and worktrees of all registered repositories. Add a repository by
entering its path in the picker. Remove one there to close its views; this does
not delete files or branches. `↵` opens a branch in the current workspace, and
`⌘↵` / `Ctrl+Enter` (or a ⌘-click) opens it as a new [workspace](#workspaces).
History, files, search, and symbols use the workspace's repository and branch.

Linked worktrees belong to one repository entry. Separate clones stay separate,
even with the same remote. Registration persists across restarts.

### Workspaces

A workspace is one task: a branch or worktree, a saved review, or a registered
vault. Each keeps its own comparison, open files, notes, and scroll position.

- The **Workspaces** list at the top of the left sidebar appears once two are
  open. Vaults come first, then the home workspace on the default branch. Each
  row shows the number of changed files.
- `⌘1`–`⌘9` / `Ctrl+1`–`Ctrl+9` show the workspace at that place. `⌃Tab` shows
  recent workspaces: hold Control, press Tab to step, and release to go.
  **Switch workspace…** in the palette does the same.
- **+**, or **New workspace…** in the palette, opens the branch picker. A saved
  review link adds a workspace for that review. `Delete` or **×** closes a row;
  vaults and the home workspace stay.
- A review that an agent creates joins the list in every Med window, with an
  accent dot until you open it. With `--open`, it also shows in the window you
  used last. See [agent integration](AGENT_INTEGRATION.md#create-a-review).
- A review with an agent session shows its lead session's state: a turning mark
  while the agent works, **Needs you** while it waits for a permission answer or
  in `med review wait`, and the accent dot when a turn ended while you were
  elsewhere.
- Right-click a row to open it, copy a command that resumes the agent's session,
  mark it read or unread, or close it. On a branch row, **Copy lazygit command**
  copies `cd <checkout> && lazygit` for Git work that the
  [Commit tab](#commit-and-push) does not do.

The four most recently shown workspaces stay loaded, so a switch is immediate.
Only the workspace on screen gets live updates; the others catch up when you
return. The list persists and windows share it, but each window keeps its own
workspace on screen. A saved review keeps its `/review/<id>` address, and Back
and Forward move between workspaces. In a browser tab, use `Ctrl+1`–`Ctrl+9`,
the installed app, or the palette.

### Pull requests

Paste a pull request link, such as `https://github.com/owner/repo/pull/333`, in
**New workspace…**. Choose **Open pull request #333**, or **Open and review with**
an installed agent. The workspace lists each step:

1. Find the registered repository whose Git remote is `owner/repo`.
2. Read the pull request with `gh`.
3. Make a worktree in Med's state folder (`worktrees/<repo>/pr-333`). Your
   checkout and its branch stay as they are.
4. Check out the pull request there with `gh pr checkout`. If its branch is in
   use in another worktree, Med checks out its commit without a branch.
5. Fetch the base branch if it is not local, and save the review.
6. Start the agent in the worktree with a review prompt, if you chose one.

The same link again uses the same worktree and review; a new head adds an
iteration. A failed step says why, with **Retry**. Add an unknown repository
first. To finish, right-click the workspace and choose **Close and remove
worktree**. Med runs `git worktree remove` without `--force`, and keeps a
worktree with changes, a working agent, or a commit on no branch. The branch
stays.

In a terminal, `med pr checkout 333` runs `gh pr checkout 333`, fetches the base
branch, and opens a saved review from the merge base to the head. It passes
options such as `--force` or `--branch <name>` to `gh`; `--no-open` prints the
launch URL. It needs the GitHub CLI, signed in.

A saved review with a pull request link shows its GitHub comments. Med reads
them with `gh`; it never posts, replies, or resolves.

- **In the diff.** When the comparison shows the pull request's head commit,
  each code thread shows on its line, with the GitHub mark.
- **Conversation.** The comment count beside the title opens the reviews, the
  general comments, and the threads that the diff cannot show.
- **Reply on GitHub.** Hover a comment for **Copy** and **Open on GitHub**.
  **Copy comments** copies only Med's notes.
- **Updates.** Med reads again on window focus, at most every 30 seconds, or at
  once with the refresh button. **Hide comments** hides both kinds.

### Codex reviews

A saved review shows the findings of Codex reviews in its checkouts: run
`codex review --base main` in the worktree, or `/review` in a Codex session
there. Med reads `~/.codex/sessions`; it does not run Codex or change its files.
It lists reviews of a commit that the review shows, and reviews that ran after
the review was saved.

- **In the diff.** On the commit that Codex reviewed, each finding shows at its
  last line with its priority, such as **P1**.
- **Panel.** The Codex count beside the title opens each verdict and the
  findings that the diff cannot show, with a `codex resume` command.
- **To an agent.** **Add to message** puts a finding, or all of a review's
  findings, in the next message to the review's agent.

### Saved agent reviews

An agent saves a commit range or captures working changes through the running
host, then returns a local review link. Open the launch URL once to authorize
the browser; saved links then use the same session.

A saved review opens its first target; choose others from **Review target**.
The saved diff stays fixed when agents make more changes. **Copy comments**
copies the comments of all targets, with paths, revisions, line numbers, and
nearby source. **Clear** clears that review after confirmation. Copying does
not clear comments.

An agent that names its task with a key updates one review over several rounds.
Each round is an iteration: the review opens on the latest one and is marked new
again. Comments on earlier iterations stay.

A review that records its agent session has a Claude or Codex button in the
toolbar, and **Show agent session** in the palette. They open the Session pane:
prompts, replies, thoughts, tool calls with output and diffs, the plan, and
background shells and agents. It follows the session live. A long session opens
on its latest work; scroll up for earlier work, or jump to a prompt from
**Turns** (the clock). See [agent sessions](SESSIONS.md).

A saved review can also start an agent. A Session pane without a session lists
the agents that Med found, and its **+** menu starts another. Med starts Claude
Code, OpenCode, Codex (`codex-acp`), or Gemini CLI in the review's repository,
with your own sign-in; it does not install them. The prompt box then has model,
effort, and mode pickers, a context meter, `/` commands, and **Stop** (or
`Esc`). A tool call that needs an answer shows **Allow** and **Deny**. Med stops
its agents when the host stops.

Saved reviews persist in `~/.local/state/med`; normal branch notes end with the
host. See [agent integration](AGENT_INTEGRATION.md) for commands, limits, and
suggested `AGENTS.md` guidance.

### Notes and briefs

A review's **Notes** are the agent's brief and the replies you pin from its
session. A brief explains the review in Markdown; its links open the lines they
cite.

- **Attach.** Copy the agent's last message and press `⌘V` outside a text field.
  On live changes, Med asks for a title and saves the review first, so the links
  keep pointing at the code they describe. Agents can pass
  [`--brief`](AGENT_INTEGRATION.md#attach-a-brief) instead.
- **Pin a reply.** In the Session pane, the reply that ends each turn has **Pin
  to review**. Med copies it into the latest iteration's Notes, because a
  transcript can lose old replies. Remove a pin from the note's **⋯** menu.
- **Read.** The **Notes** tab comes before **Changes**. With more than one note,
  each has a head such as `02 / 03`, and a rail on the right marks notes,
  headings, and excerpts. Below each paragraph that cites lines, a short diff
  excerpt shows them. `]` and `[` step through the excerpts.
- **Jump and comment.** Click a link or an excerpt heading to open the lines in
  **Changes**. Hover an excerpt line and click **+**, or select line numbers and
  press `c`. These are the same notes as in **Changes**.
- **Mark up the notes.** Select words in a note and click **Comment**, or press
  `c`. The passage stays marked, and the comment shows below its paragraph with
  its quote. **Copy comments** and **Send to** the agent include the quote. A
  comment whose passage is gone shows at the end of its note.
- **Check coverage.** **Not in the notes** lists the changed files that the
  notes never cite; read those yourself.
- **Replace or remove.** Paste again to replace the brief; **Undo** restores
  it. The **⋯** menu copies all notes or removes the brief.

Links can be `path`, `path:12`, `path:12-20`, `path#L12-L20`, absolute paths,
editor links, or GitHub blob URLs. A unique suffix such as `App.tsx:42` works.
**Compare revisions…** accepts branch names; see
[branch comparisons](AGENT_INTEGRATION.md#compare-with-a-base-branch).

### Indexed branch search

Set up the optional [Zoekt](https://github.com/sourcegraph/zoekt) search helper
once, from a built Workbench checkout. It needs Go (`brew install go` on macOS,
`sudo pacman -S go` on Omarchy) and saves pinned binaries in the user cache:

```sh
node dist/cli.js --setup-search
```

The standalone executable reuses an existing Zoekt cache. Normal use needs only
the binaries; there is no container, service, or Git hook.

The first content or project-symbol search starts the repository's search
service and indexes in the background. **Content search reads committed branch
content** and opens results from the exact commit shown; uncommitted and
untracked content is not included. Med indexes up to 64 branch tips for each
repository, worktree branches first, and updates the index when commits change.
While the helper is missing or the index builds, search uses Git on the same
commits.

The cache is `~/.cache/med/search`, or `$XDG_CACHE_HOME/med/search`. Set
`MED_SEARCH_CACHE` for another place, or `MED_ZOEKT_BIN` to a directory with
`zoekt-git-index` and `med-zoekt`. See the
[integration report](validation/ZOEKT_INTEGRATION.md) and the
[engine benchmark](validation/ZOEKT.md).

### Other inputs

```sh
node dist/cli.js --patch change.patch
git diff | node dist/cli.js --patch -
node dist/cli.js --files old.ts new.ts
```

## Files across repositories

Open **Find file** with `⌘⇧K` / `Ctrl+Shift+K`. Type part of a registered
repository name, then press **Tab** to scope the picker to it. The scope shows
its full path, so clones and worktrees stay distinct. Med does not scan nearby
folders or register repositories from this picker.

Combine **Code**, **Tests**, and **Docs**, or type `type:tests ext:java,kt`.
Categories and extensions each use OR; the two groups combine with AND. Test
files follow language conventions such as `.test.ts`, `_test.go`, `test_*.py`,
`*Test.java`, and `src/test/`. Backspace in an empty input, **Clear filters**,
or the scope button returns to the current repository. Picking and previewing
never change files.

Right-click a file in a tree or tab for **Reveal in Finder** (**Show in
Explorer** on Windows, **Show in folder** on Linux), **Copy path**, and **Copy
relative path**. The panel button beside **Esc**, or **Hide file preview in Find
file**, hides the picker's preview for every picker and window.

## First review

1. Select a commit in the history panel, or working changes. A commit compares
   with its first parent. Click **History** to collapse the panel to one line.
   Hover a commit for its author, message, refs, and change counts.
2. Select a changed path to move to it in the diff stream. Double-click it to
   open the current file.
3. Use the branch switcher (`⌘⇧G`) to open another branch here, or `⌘↵` to open
   it as a new [workspace](#workspaces). A branch without a worktree opens
   committed content.
4. Use the file picker or the Files sidebar to open unchanged files. A preview
   does not replace your review until you open it.
5. Toggle blame (`⌥B`) in a full file. Hover a label for the date and message.
6. When the cursor rests on a line, its author, age, and commit subject show
   after the text. Click the short hash to copy the full hash. **Hide line blame
   at the cursor** in the palette turns it off.

Drag the gutter **+** across lines to start a note for the range, or select line
numbers and press `c`. Hover the **+/−** totals to split them into code, tests,
docs, config and data, and lockfiles.

Shift-click another commit to select an inclusive range, from the oldest
commit's first parent to the newest commit. Shift+Up/Down extends it; a plain
click resets it. This compares snapshots; it does not add patches across merged
branches.

| Action                            | macOS         | Omarchy Linux             |
| --------------------------------- | ------------- | ------------------------- |
| Keyboard shortcuts guide          | `?`           | `?`                       |
| Command palette                   | `⌘K`          | `Ctrl+K`                  |
| Find a file                       | `⌘⇧K`         | `Ctrl+Shift+K`            |
| Symbols in current file           | `⌘O`          | `Ctrl+O`                  |
| Symbols in project commits        | `⌘⇧O`         | `Ctrl+Shift+O`            |
| Search file contents              | `⌘⇧F`         | `Ctrl+Shift+F`            |
| Find in diff contents             | `⌘F`          | `Ctrl+F`                  |
| Open a branch or worktree         | `⌘⇧G`         | `Ctrl+Shift+G`            |
| Show workspace 1–9                | `⌘1`–`⌘9`     | `Ctrl+1`–`Ctrl+9`         |
| Switch to a recent workspace      | `⌃Tab`        | `Ctrl+Tab`                |
| Toggle history sidebar / session  | `⌘B` / `⌘⇧B`  | `Ctrl+B` / `Ctrl+Shift+B` |
| Zen mode                          | `⌥Z`          | `Alt+Z`                   |
| Add note to selected lines        | `c`           | `c`                       |
| Paste a brief                     | `⌘V`          | `Ctrl+V`                  |
| Next / previous brief excerpt     | `]` / `[`     | `]` / `[`                 |
| Resume search                     | `⌥R`          | `Alt+R`                   |
| Keep preview tab                  | `⌥P`          | `Alt+P`                   |
| Open a found file and keep it     | `⌘↵`          | `Ctrl+Enter`              |
| Show tab 1–8 / the last tab       | `⌥1`–`⌥9`     | `Alt+1`–`Alt+9`           |
| Previous / next tab               | `⌘⇧[` / `⌘⇧]` | `Ctrl+Shift+[` / `]`      |
| Toggle gutter blame               | `⌥B`          | `Alt+B`                   |
| Close current file                | `⌥W`          | `Alt+W`                   |
| Close all files in this workspace | `⌥⇧W`         | `Alt+Shift+W`             |
| Close other files                 | `⌥⇧O`         | `Alt+Shift+O`             |

Close actions keep the Changes tab and other workspaces. In Find file, `↵` opens
the preview tab, which the next preview replaces; `⌘↵` opens a tab that stays.
Tab keys count Brief, Changes, and Commit with the file tabs. A browser can take
some shortcuts first; the command palette has the same actions.

`?` opens the shortcuts guide for your context: Review, File, Editor, or
Pickers. Type to search every context by action or key, such as `close`, `zz`,
or `⌘K`. Enter runs a highlighted row that has a command.

### Zen mode

`⌥Z` / `Alt+Z`, the focus button at the top right, or **Enter zen mode** hides
every bar: tabs, the Changes toolbar, and the status bar. `⌘B` and `⌘⇧B` still
show or hide the history sidebar and the agent session. To leave, press `⌥Z` again, or click **Leave zen** in
the top-right corner. Escape does not leave zen mode, so it stays free for
search, Vim, and dialogs.

### Side panes

One column on the right holds **Session** (`⌘⇧B`), **Files** (the folder
button), and **Preview** (`⌘⇧V`) at one width. Drag its left edge to resize it. It shows the two latest
panes, one above the other; a third closes the oldest. **Maximize** gives one
pane the column, and **Restore** shares it again. **Show side panes as tabs**
shows one pane at a time, and **Stack side panes** goes back. Both layouts are
prototypes.

## Symbols and Vim navigation

Command-click a diff filename or a file in the Changes list (Ctrl-click on
Linux) to open a background tab. Closing the active file selects the file to its
right, then its left.

![In-file symbol palette with a live jump in the current file](validation/symbol-navigation.png)

In-file symbol search (`⌘O`) starts with the symbol nearest to the cursor and
ranks ties by distance. Arrow keys jump in the file; Enter keeps the position,
and Escape restores it. Project symbol search (`⌘⇧O`) searches the repository's
indexed commit with its own preview. Both keep the last query.

Symbols come from Universal Ctags: `brew install universal-ctags` on macOS or
`sudo pacman -S ctags` on Omarchy. Project symbols also need the
[Zoekt setup](#indexed-branch-search). Coverage follows the installed Ctags
parsers; for example, Ctags 6.2.1 has no Zig parser, but text search still
works for Zig.

Vim navigation is on by default; the command palette turns it off for this
browser address. Files take focus when opened, in Normal mode:

- `h j k l`, `w b e`, `0 ^ $`, and counts such as `10j`.
- `v` selects characters and `V` whole lines. Extend with motions, `o` moves to
  the other end, `y` copies, and Escape cancels. Selections include lines
  outside the view.
- Text objects: `iw`/`aw`, `iW`/`aW`, `ip`/`ap`, quotes (`i"`, `a'`, backtick),
  and brackets (`i(`, `a[`, `i{`, `ib`, `aB`). Counts such as `v2i(` and
  repeated objects expand outward. Brackets are lexical pairs, not syntax.
- `gd` finds declarations for the identifier at the cursor, first in the file,
  then in the project index. Several candidates open a picker. Ctags does not
  resolve types or imports like an LSP.
- `gg`, `G`, `42G`, `{` / `}`, and `Ctrl+D` / `Ctrl+U`.
- `''` returns to the previous jump's line, and double backtick to its exact
  column. Repeat to swap. `ma`–`mz` set marks; `'a` and backtick-`a` go to them.
  Marks and jumps reset when the file reloads.
- `f` / `F` / `t` / `T` with `;` / `,`, and `Shift+A` for the end of the line.
- `:123` then Enter jumps to line 123.
- `zz` / `zt` / `zb` place the line at the middle, top, or bottom.
- `/` / `?` search live, `n` / `N` step, and `*` / `#` search the word at the
  cursor. Uppercase letters make a search case-sensitive. Enter accepts, and
  Escape cancels or clears highlights.

Writable files open in Vim Normal mode; press `i` to insert. While a Vim pane
has focus, `?` searches backward and `⌘K` / `Ctrl+K` still opens commands.

## Edit working files

Eligible local and working-tree files open in Vim Normal mode; there is no
Edit toggle. Use `i`, `a`, `o`, `dd`, `ciw`, Visual selections, `p`, `.`, `u`,
and Ctrl+R. Default yanks (`y`, `yiw`, `yy`) also copy to the clipboard; named
and black-hole registers keep their Vim behavior. App shortcuts come before Vim
bindings, except on macOS: Control+B, Control+F, and Control+O reach Vim,
because Command runs Med's shortcuts.

Escape returns to Normal mode. `:w`, ⌘S / Ctrl+S, or **Save** writes the file;
`:wq` saves, then closes if the save succeeds. A hollow dot means saved and a
filled dot means unsaved. **Close file** or `:q` with unsaved text asks you to
**Discard draft** or **Keep editing**. Saving does not stage or commit; use the
[Commit tab](#commit-and-push). Blame hides while a draft is unsaved.

Drafts and undo history stay in memory across tab switches and closes; open the
file again to resume. Med keeps up to 24 drafts. A reload warns about unsaved
work but does not keep drafts.

If another process changed the file, saving reports a conflict and keeps your
draft. There is no force save. Commit and saved-review files are read-only.
Editing works for existing UTF-8 text files up to 1 MiB; symlinks, hard links,
and paths through nested repositories cannot be saved. Med keeps uniform CRLF
line endings and executable bits.

Link to a registered working file with a URL-encoded worktree path and
repository-relative path:

```text
http://127.0.0.1:4173/file?repo=%2Fpath%2Fto%2Frepo&path=src%2Fexample.ts&edit=1
```

The browser must already be authorized with the launch URL. A file link opens
live content; it does not freeze a review or register a repository.

## Commit and push

Press `q` in a review of live changes, or click the **Commit** tab, to stage
files, commit them, and push the branch. Press `q` again to return.

- **Files and diffs.** The list shows each changed file: ● staged, ◐ partly
  staged, ○ not staged. The diffs follow in the same order. `j` / `k` move
  through the files and scroll the diffs. `Enter` opens the focused file in a
  tab.
- **Filter.** `/` filters by path; `Enter` keeps the filter and `Esc` clears it.
- **Stage.** `Space`, or a click on the mark, stages or unstages the whole file.
  `a` stages every file shown, or unstages them when all are staged.
- **Commit.** `c`, **Commit…**, or `⌘↵` opens the message. `⌘↵` / `Ctrl+Enter`
  commits the staged files; `Esc` keeps the message as a draft. Hooks run. If a
  hook stops the commit, its output shows under the message.
- **Push.** `⇧P` pushes to the upstream. A branch without an upstream asks
  first, then pushes to the push remote (usually `origin`) and tracks it. Med
  never force-pushes.

If the staged files change outside Med, the commit stops and the tab reads them
again. For hunks, amends, rebases, and branch switches, use **Copy lazygit
command** on the workspace.

## Limits and evidence

Syntax highlighting covers JavaScript/JSX, TypeScript/TSX, CSS, HTML, JSON/JSONC,
Markdown, YAML, TOML, Bash, Go, Python, Rust, Swift, SQL, Svelte, diff, INI,
HTTP, dotenv, shell sessions, Java, Gradle, C++, and XML. Twinkleplop supplies
most grammars; Med's own grammars cover Java, C++, XML, JSON/JSONC, Go, Rust,
and Swift. Markdown code fences use the matching grammar. C, Zig, and other
missing languages show as plain text. Colors can differ from Shiki: most
grammars give token kinds or short scope stacks, not full TextMate scope stacks,
so theme rules that match parent scopes can miss them. Go, Rust, and Swift give
Shiki's full scope stacks.

Images render in before/after diff cards, and the file viewer plays
browser-supported videos. Other binary files and unsupported encodings show
metadata only. Text above 8 MiB, 200,000 lines, or 250,000 characters on one
line is not rendered; large text uses plain rendering. File lists stop at 50,000
entries. Missing files show as missing. See [file browsing](FILE_BROWSING.md).

History follows the selected worktree's HEAD. Shallow clones can lack the
parent that a comparison needs. Blame has the same limit, and does not work for
files that need Git content conversion. Med is a browser app with a local
server; native desktop packaging and shared persistent review notes are not
implemented.

- [Zoekt benchmark](validation/ZOEKT.md)
- [Twinkleplop integration and comparison videos](validation/HIGHLIGHTER_INTEGRATION.md)
- [Everyday interaction latency](validation/INTERACTIONS.md)
- [Ctags and Zoekt symbol benchmarks](validation/SYMBOL_SEARCH.md) and
  [Vim cursor benchmarks](validation/VIM_NAVIGATION.md)

Hunk's retained source and tests carry their [MIT notice](../upstream/HUNK-LICENSE);
[source provenance](../upstream/HUNK.md) records the revision and changes.

## Standalone files and dropped previews

Run **Open standalone file** from the command palette, or visit `/files`. Use
**Open file…** or **⌘O / Ctrl+O** to enter an absolute path; the file does not
need to be in a Git repository. Vim, the saved-state dot, and conflict-checked
saves work as for working files. In a built checkout,
`node dist/cli.js --editor` starts a file workspace without a repository.

An agent can print a link through the running host:

```sh
med open /absolute/path/Example.java --line 42 --column 8
```

Add `--edit` to start in the editor; `--port` and `--state-dir` work as for
review commands. The command prints a token-free link, such as
`http://127.0.0.1:4173/file/absolute/path/Example.java?line=42&column=8`. The
link reads the current file, not a snapshot. Opening a file grants access to
that file only, not its folder; the host keeps at most 256 grants until restart.

Drop text, image, or video files anywhere in Med for read-only previews. Dropped
files stay in the browser. Drop up to 12 files at once; the workspace holds at
most 24 tabs. Text is limited to 8 MiB for each file, 24 MiB for each drop, and
32 MiB in total. Drafts and dropped previews do not survive a reload.

## Images and videos

Image diffs show **Before** and **After** in compact cards that load near the
visible area. Click the header to collapse a card, or the filename to open the
viewer. The viewer fits images to the pane; **1:1** shows actual size. SVG, PNG,
JPEG, WebP, AVIF, GIF, APNG, BMP, and ICO use the browser's decoder; TIFF,
HEIC/HEIF, and JPEG XL depend on the browser.

Videos use native controls. MP4/M4V, WebM, MOV, OGV, and MKV play when the
browser has the codec; Med does not transcode. Images are limited to 32 MiB and
videos to 4 GiB. Saved reviews keep image bytes within the 24 MiB capture budget
for each target; videos are not captured.

## Full-file change markers

A full file opened from a diff shows green gutter bars for added lines and red
bars for deleted lines. A deletion with no remaining row shows as a red tick at
its gap. Blue bars mark working-file additions and replacements. Hover a marker
for its comparison.

Markers use the selected comparison only when its captured text matches the
file on screen; otherwise they compare live content with HEAD. **Open before**
and **Open after** show the exact commit versions. A stale view drops its
markers until refresh.

## Markdown preview

Open a `.md`, `.markdown`, `.mdown`, or `.mkd` file and select **Preview**, or
press `⌘⇧V` / `Ctrl+Shift+V` while the file is active. In a repository, the preview opens as the
Preview [side pane](#side-panes) and follows the Markdown file in the main
view. In a vault or a dropped file, it sits beside the source, or below it in
narrow windows. Med remembers whether Preview is open.

The preview follows the source cursor and scrolling. Scroll it on its own, or
use **On this page** when it is at least 760 pixels wide. Contents links move
the source cursor. Edits update the preview after a short pause; they do not
save the file.

Rendering includes GFM tables, task lists, strikethrough, autolinks, and
footnotes; LaTeX through KaTeX; Mermaid fences; colored code; and images. A
single newline stays in the paragraph; a blank line starts a new one.

Relative images in a standalone file must be in its folder or below it.
Repository images resolve in the same repository or commit. PNG, JPEG, GIF,
WebP, AVIF, and SVG are supported, up to 8 MiB each. Remote images load
directly and send no referrer. Raw HTML is left out.

Preview is limited to 512 KiB of Markdown. Diagrams are limited to 20,000
characters and 500 edges. An invalid diagram keeps its source with a notice;
invalid math stays visible. Try
[the reading queue design note](examples/reading-queue.md).

### Links in Markdown preview

Click a relative file link to open it in a file tab. Paths resolve from the
Markdown file's folder, including `../` and URL-encoded names, in the same
worktree or commit. Standalone links use the file workspace, and vault links
the vault. `#L42` selects a line. Heading, web, and mail links work as usual.
Dropped previews have no folder, so relative file links do not work there.

### Review titles and PR links

`med review create --title "Navigation fix"` names the review in the workspace
list and browser tab; keep it to 2–4 words. `--pr <url>` links the header to
the pull request and shows its title. See
[titles and pull requests](AGENT_INTEGRATION.md#titles-and-pull-requests).
