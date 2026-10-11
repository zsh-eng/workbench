# Using Med

Med shows Git changes, files, and notes in your browser, from a server on your
Mac. This guide covers the app. To hand off reviews from coding agents, see
[agent reviews](AGENT_INTEGRATION.md).

## Run Med

`med web` starts one background server and opens Med in your browser. The
server keeps running when you close the terminal or the browser. `med status`
shows it, `med stop` stops it, and `med serve` runs it in the foreground.

Med serves port **4173** and keeps its state in `~/.local/state/med`. For a
second profile, give every command the same `--port` and `--state-dir`. Med
does not choose another port for you; a port in use is an error.

When Med is out of date, an open page says so. **Restart** replaces a server
that runs older code, and **Reload** loads a newer page. Med first checks that
the new build starts; if it does not, the current server keeps running and the
notice shows the error. The command palette has **Reload Med** and **Restart
Med server and reload**. A server that you started with `med serve` asks you to
restart it in its terminal.

### Start at login

- **Open at login** on the setup page, or `med service login on`, opens Med at
  your next login. It does not change the running server.
  `med service login off` removes it.
- `med service install` installs a per-user LaunchAgent that starts the server
  at login and restarts it after a crash. Run `med stop` first, and keep the
  executable at the same path. `med service uninstall` removes it.

The login service keeps the PATH of the install command, so it finds the same
Git and Go as a server that you start in a terminal. Install it again after a
tool moves. Its log is `service.log` in the state folder. On other systems, run
`med serve` from your own service manager.

### Install as an app

In Chrome or Edge, select the install icon in the address bar, or **Install
Med** in the browser menu. Med then has its own window and Dock icon, and gets
the shortcuts that a browser keeps for its tabs. The app needs the background
server, so use `med service install` to start the server at login. Each port is
a separate app.

## Sources

The first time `med web` runs with nothing registered, Med shows a setup page:

- **Repositories** and **Obsidian vaults** list what Med finds in your home
  folder, most recent first. Ones used in the last three weeks (vaults: two
  months) start selected. Linked worktrees, dependency folders, and hidden
  folders are left out. Med searches Desktop, Documents, and Downloads only
  when you choose **Search them too**, because macOS asks permission first.
- **Add a folder by path** adds a repository or vault that the search missed.
- **Open at login** starts Med when you log in.

Setup reads folder names and Git metadata only. To open it again, choose **Add
sources…** on the Sources page, or **Set up Med…** in the command palette.

From a terminal, `med add` registers a folder, `med list` lists your sources,
and `med remove` removes one. Registration persists across restarts. A linked
worktree belongs to its repository; separate clones stay separate, even with
the same remote. On the **Sources** page, a row's **⋯** menu can index a vault
again, copy the path, or remove the source. Removing a source keeps its folder.
See [notes and vaults](VAULTS.md) for vaults.

## Workspaces

A workspace is one task: a branch or worktree, a saved review, or a vault.
Each keeps its own comparison, open files, notes, and scroll position.

The branch switcher at the top of the sidebar (`⌘⇧G`) searches the branches
and worktrees of every registered repository. `↵` opens a branch in the
current workspace; `⌘↵` or a ⌘-click opens it as a new workspace. To add a
repository, enter its path in the switcher. Removing one there closes its
views; it does not delete files or branches. History, files, search, and
symbols use the workspace's repository and branch.

- The **Workspaces** list at the top of the sidebar appears when two are open.
  Vaults come first, then the home workspace on the default branch. Each row
  shows its number of changed files.
- `⌘1`–`⌘9` show the workspace at that place. `⌃Tab` shows recent workspaces:
  hold Control, press Tab to step, and release to go. **Switch workspace…** in
  the palette does the same.
- **+**, or **New workspace…** in the palette, opens the branch switcher. A
  saved review link adds a workspace for that review. `Delete` or **×** closes
  a row; vaults and the home workspace stay.
- A review that an agent creates joins the list in every Med window, with an
  accent dot until you open it.
- A review with an agent session shows the session's state: a turning mark
  while the agent works, **Needs you** while it waits for a permission answer
  or for your review, and the accent dot when a turn ended while you were
  elsewhere.
- Right-click a row to open it, copy a command that resumes the agent's
  session, mark it read or unread, or close it. On a branch row, **Copy lazygit
  command** copies a command that opens lazygit in that checkout, for Git work
  that the [Commit tab](#commit-and-push) does not do.

The four most recent workspaces stay loaded, so a switch is immediate. Only
the workspace on screen gets live updates; the others catch up when you
return. Windows share the list, but each shows its own workspace. A saved
review keeps its `/review/…` address, and Back and Forward move between
workspaces. In a browser tab, which keeps `⌘1`–`⌘9`, use `Ctrl+1`–`Ctrl+9`,
the installed app, or the palette.

## Review changes

1. Select a commit or the working changes in the history panel. A commit
   compares with its first parent. Hover a commit for its author, message,
   refs, and change counts. Click **History** to fold the panel to one line.
2. Select a changed path to go to it in the diff. Double-click it to open the
   whole file.
3. Shift-click another commit to compare a range, from the oldest commit's
   first parent to the newest commit. Shift+Up and Shift+Down extend it; a
   plain click resets it. A range compares snapshots; it does not add patches
   across merged branches.
4. Open unchanged files from the file picker or the Files pane. A preview does
   not replace your review until you open it. A branch without a worktree opens
   its committed content.

To comment, drag the gutter **+** across lines, or select line numbers and
press `c`. Hover the **+/−** totals to split them into code, tests, docs,
config and data, and lockfiles.

In a whole file, `⌥B` shows blame in the gutter; hover a label for the date and
message. When the cursor rests on a line, its author, age, and commit subject
show after the text. Click the short hash to copy the full hash. **Hide line
blame at the cursor** in the palette turns this off.

## Saved reviews

An agent saves a commit range or the working changes through the running
server, and gives you a link. Open the server's launch URL once in a browser;
saved links then work in new tabs of that browser. See
[agent reviews](AGENT_INTEGRATION.md#create-a-review).

A saved review keeps its diff when the agent makes more changes. It opens its
first target; choose others from **Review target**. When each iteration has
one comparison, there is no picker: the iteration keys in **Notes** show each
iteration's comparison. An agent that names its task with a key adds an
iteration for each round of work. The review opens on the latest one and is
marked new again; comments on earlier iterations stay.

**Copy comments** copies the comments of all targets, with paths, revisions,
line numbers, and nearby source, for any agent. **Send to Claude** or **Send to
Codex** sends them to the review's own agent; see
[sending comments](AGENT_INTEGRATION.md#send-comments-to-the-agent). **Clear**
clears the review's comments after you confirm. Copying does not clear them.

The review's header shows its title and, when it has one, its pull request. See
[titles and pull requests](AGENT_INTEGRATION.md#titles-and-pull-requests).

### Agent sessions

A review that records its agent session has a Claude or Codex button in the
toolbar, and **Show agent session** in the palette. Both open the Session pane:
prompts, replies, thoughts, tool calls with output and diffs, the plan, and
background shells and agents. It follows the session live.

- A long session opens on its latest work. Scroll up for earlier work, or jump
  to a prompt from **Turns** (the clock).
- A finished turn shows its prompt and final reply; its other work folds into
  one **Worked for** row. Click the row to open that turn, or **Show work** to
  open every turn.
- With focus in the thread, `[` and `]` step through prompts and replies. A
  task in **Background** goes to its call.
- Links in a reply open files in Med. A web link shows as a pill with the
  site's icon.

A Session pane without a session lists the agents that Med found, and its **+**
menu starts one. Med starts Claude Code, OpenCode, Codex (`codex-acp`), or
Gemini CLI in the review's repository, with your own sign-in; it does not
install them. The message box has model, effort, and mode pickers, a context
meter, `/` commands, and **Stop** (or `Esc`). A tool call that needs an answer
shows **Allow** and **Deny**. Med stops its agents when the server stops. See
[agent sessions](SESSIONS.md).

Saved reviews persist in the state folder. Notes on a branch last until the
server stops.

## Notes and briefs

A review's **Notes** hold the agent's brief and the replies that you pin from
its session. A brief explains the change in Markdown, and its links open the
lines that it cites. The **Notes** tab comes before **Changes**.

- **Attach a brief.** Copy the agent's last message and press `⌘V` outside a
  text field. On live changes, Med first asks for a title and saves the review,
  so the links keep pointing at the code that they describe. Agents can pass
  [`--brief`](AGENT_INTEGRATION.md#attach-a-brief) instead.
- **Pin a reply.** In the Session pane, the reply that ends each turn has **Pin
  to review**. Med copies it into the latest iteration's notes, because a
  transcript can lose old replies.
- **Read.** With more than one note, each has a head such as `02 / 03`, and a
  rail at the right marks notes, headings, and excerpts. Below each paragraph
  that cites lines, a short diff excerpt shows them. `]` and `[` step through
  the excerpts. **Not in the notes** lists the changed files that the notes do
  not cite; read those yourself.
- **Comment.** Click a link or an excerpt's heading to open its lines in
  **Changes**. On an excerpt line, click **+**, or select line numbers and
  press `c`. To comment on the prose, select words and click **Comment** or
  press `c`; the comment keeps the quote, and a comment whose passage is gone
  shows at the end of its note.
- **Manage.** Paste again to replace the brief; **Undo** restores it. A note's
  **⋯** menu copies all notes, removes the brief or a pin, and has **Start new
  notes**, which captures the current comparisons as a new, empty iteration.
  **Delete these notes…** deletes the shown brief, its pins, and their
  comments, after it asks. Notes that you started also take their iteration,
  unless its comparisons have comments.

A link can be `path`, `path:12`, `path:12-20`, `path#L12-L20`, an absolute
path, an editor link, or a GitHub blob URL. A unique suffix such as
`App.tsx:42` works.

## Pull requests

Paste a pull request link, such as `https://github.com/owner/repo/pull/333`, in
**New workspace…**. Choose **Open pull request #333**, or **Open and review
with** an installed agent. The workspace shows each step:

1. Find the registered repository whose remote is `owner/repo`. Add an unknown
   repository first.
2. Read the pull request with `gh`.
3. Make a worktree in Med's state folder (`worktrees/repo/pr-333`). Your
   checkout and its branch do not change.
4. Check out the pull request there with `gh pr checkout`. If its branch is in
   use in another worktree, Med checks out its commit without a branch.
5. Fetch the base branch if it is not local, and save the review.
6. Start the agent in the worktree with a review prompt, if you chose one.

The same link opens the same worktree and review; a new head adds an
iteration. A failed step says why and offers **Retry**. When you are done,
right-click the workspace and choose **Close and remove worktree**. Med runs
`git worktree remove` without `--force`, so it keeps a worktree with changes,
a working agent, or a commit on no branch. The branch stays.

In a terminal, `med pr checkout 333` runs `gh pr checkout 333`, fetches the
base branch, and opens a saved review from the merge base to the head. It
passes options such as `--force` and `--branch` to `gh`, and `--no-open` prints
the launch URL instead. It needs the GitHub CLI, signed in.

A saved review with a pull request shows its GitHub comments. Med reads them
with `gh`; it never posts, replies, or resolves.

- When the diff shows the pull request's head commit, each code thread shows on
  its line with the GitHub mark.
- The comment count beside the title opens the reviews, the general comments,
  and the threads that the diff cannot show.
- Hover a comment for **Copy** and **Open on GitHub**. **Copy comments** copies
  only Med's comments.
- Med reads again when the window gets focus, at most every 30 seconds, or when
  you click refresh. **Hide comments** hides GitHub's comments and Med's.

## Codex reviews

A saved review shows the findings of Codex reviews in its checkouts: run
`codex review --base main` in the worktree, or `/review` in a Codex session
there. Med reads `~/.codex/sessions`; it does not run Codex or change its
files. It lists reviews of a commit that the review shows, and reviews that ran
after the review was saved.

- On the commit that Codex reviewed, each finding shows at its last line with
  its priority, such as **P1**.
- The Codex count beside the title opens each verdict, the findings that the
  diff cannot show, and a `codex resume` command.
- **Add to message** puts a finding, or all of a review's findings, in the next
  message to the review's agent.

## Commit and push

Press `q` in a review of live changes, or click the **Commit** tab, to stage
files, commit them, and push the branch. Press `q` again to go back.

- **Files.** The list shows each changed file: ● staged, ◐ partly staged, ○ not
  staged. Their diffs follow in the same order. `j` and `k` move through the
  files and scroll the diffs; `Enter` opens a file in a tab.
- **Filter.** `/` filters by path. `Enter` keeps the filter and `Esc` clears
  it.
- **Stage.** `Space`, or a click on the mark, stages or unstages a whole file.
  `a` stages every file shown, or unstages them all when all are staged.
- **Commit.** `c` or **Commit…** opens the message, and `⌘↵` commits the staged
  files. `Esc` keeps the message as a draft. Hooks run; if a hook stops the
  commit, its output shows under the message.
- **Push.** `⇧P` pushes to the upstream. For a branch without one, Med asks,
  then pushes to the push remote (usually `origin`) and tracks it. Med never
  force-pushes.

If the staged files change outside Med, the commit stops and the tab reads
them again. For hunks, amends, rebases, and branch switches, use **Copy lazygit
command** on the workspace.

## Edit working files

Working files and files outside Git open in Vim Normal mode; press `i` to
insert. Use `a`, `o`, `dd`, `ciw`, Visual selections, `p`, `.`, `u`, and
Ctrl+R as in Vim. Default yanks (`y`, `yiw`, `yy`) also copy to the clipboard;
named and black-hole registers keep their Vim behavior. Med's shortcuts come
before Vim's, except on macOS: Control+B, Control+F, and Control+O reach Vim,
because Command runs Med's shortcuts.

`:w`, `⌘S`, or **Save** writes the file; `:wq` saves, then closes if the save
succeeds. A hollow dot means saved and a filled dot means unsaved. Closing
unsaved text asks you to **Discard draft** or **Keep editing**. Saving does not
stage or commit; use the [Commit tab](#commit-and-push). Blame hides while a
draft is unsaved.

Drafts and their undo history stay in memory across tab switches and closes;
open the file again to resume. Med keeps up to 24 drafts. A reload warns about
unsaved work but loses drafts.

If another process changed the file, saving reports a conflict and keeps your
draft; there is no force save. Med edits existing UTF-8 text files up to 1 MiB.
It cannot save symlinks, hard links, or paths through nested repositories. It
keeps uniform CRLF line endings and executable bits. Commit and saved-review
files are read-only.

To link to a working file in a registered repository, encode the worktree path
and the repository-relative path:

```text
http://127.0.0.1:4173/file?repo=%2Fpath%2Fto%2Frepo&path=src%2Fexample.ts&edit=1
```

The link opens live content; it does not save a review or register a
repository. The browser must have opened the launch URL first.

## Find files and code

**Find file** (`⌘⇧K`) searches the current repository. Type part of another
registered repository's name and press **Tab** to search that one; the scope
shows its full path, so clones and worktrees stay distinct. Backspace in an
empty field, **Clear filters**, or the scope button goes back.

Combine **Code**, **Tests**, and **Docs**, or type filters such as
`type:tests ext:java,kt`. Values in one filter match any; the two filters must
both match. Test files follow each language's conventions, such as `.test.ts`,
`_test.go`, `test_*.py`, `*Test.java`, and `src/test/`. In Find file, `↵` opens
a preview tab, which the next preview replaces, and `⌘↵` opens a tab that
stays.

Right-click a file in a tree or tab for **Reveal in Finder**, **Copy path**,
and **Copy relative path**. The panel button beside **Esc**, or **Hide file
preview in Find file**, hides the preview in every picker and window.

### Search file contents

**Search file contents** (`⌘⇧F`) reads committed branch content, and opens
results at the exact commit shown. It does not include uncommitted or
untracked changes. Without Zoekt, it searches with Git.

[Zoekt](https://github.com/sourcegraph/zoekt) makes search faster and adds
project symbols. Setup builds pinned helpers once and needs Go
(`brew install go`) and a built Workbench checkout. In its `apps/med` folder:

```sh
node dist/cli.js --setup-search
```

After that, Med needs only the helpers in the cache: no container, service, or
Git hook. The `med` executable uses a cache that is already there. The first
content or project-symbol search starts a search service for the repository,
which indexes in the background. Med indexes up to 64 branch tips in each
repository, worktree branches first, and updates the index when commits change.
Until the index is ready, search uses Git on the same commits.

The cache is `~/.cache/med/search`, or `$XDG_CACHE_HOME/med/search`. Set
`MED_SEARCH_CACHE` to move it, or `MED_ZOEKT_BIN` to a folder that has
`zoekt-git-index` and `med-zoekt`.

## Symbols and Vim navigation

![In-file symbol palette with a live jump in the current file](validation/symbol-navigation.png)

**Symbols in this file** (`⌘O`) starts at the symbol nearest the cursor and
ranks ties by distance. Arrow keys jump in the file; Enter keeps the position,
and Escape restores it. **Symbols in the project** (`⌘⇧O`) searches the
repository's indexed commit, with its own preview. Both keep the last query.

Symbols come from Universal Ctags (`brew install universal-ctags`). Project
symbols also need [Zoekt](#search-file-contents). Languages follow the
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
background tab. Closing the active file selects the file to its right, then its
left.

## Markdown preview

Open a `.md`, `.markdown`, `.mdown`, or `.mkd` file and select **Preview**, or
press `⌘⇧V`. In a repository, the preview opens as the Preview
[side pane](#side-panes) and follows the Markdown file in the main view. In a
vault or a dropped file, it shows beside the source, or below it in a narrow
window. Med remembers whether Preview is open.

The preview follows the source's cursor and scrolling, and you can scroll it on
its own. At 760 pixels wide or more, it has **On this page**; its links move
the source cursor. Edits show after a short pause; they do not save the file.

- GFM tables, task lists, strikethrough, autolinks, and footnotes; LaTeX with
  KaTeX; Mermaid diagrams; colored code; and images. A single newline stays in
  the paragraph, and a blank line starts a new one. Raw HTML is left out.
- Relative images resolve in the same repository or commit. A standalone
  file's images must be in its folder or below it. PNG, JPEG, GIF, WebP, AVIF,
  and SVG load up to 8 MiB each. Remote images load directly, with no referrer.
- A relative link opens its file in a tab, from the Markdown file's folder, in
  the same worktree, commit, file workspace, or vault. `#L42` selects a line.
  Heading, web, and mail links work as usual. A dropped file has no folder, so
  its relative links do not work.
- The preview takes up to 512 KiB of Markdown. A diagram takes up to 20,000
  characters and 500 edges. An invalid diagram keeps its source with a notice,
  and invalid math stays visible.

Try [the reading queue design note](examples/reading-queue.md).

## Standalone files and dropped previews

To open a file that is not in a registered repository, choose **Open
standalone file** in the command palette, or visit `/files`. Then use **Open
file…** (`⌘O`) and enter an absolute path; the file does not need to be in a
Git repository. Vim, the saved dot, and conflict-checked saves work as for
working files.

An agent can link to a file through the running server:

```sh
med open ~/code/my-app/src/Example.java --line 42 --column 8
```

`--edit` starts in the editor, and `--port` and `--state-dir` work as for other
commands. The command prints a link without a token, such as
`http://127.0.0.1:4173/file/absolute/path/Example.java?line=42&column=8`. The
link reads the current file, not a snapshot. It grants access to that file
only, not its folder; the server keeps at most 256 grants until it restarts.

Drop text, image, or video files anywhere in Med for read-only previews. They
stay in the browser. Drop up to 12 files at once; a workspace holds at most 24
tabs. Text is limited to 8 MiB for each file, 24 MiB for each drop, and 32 MiB
in total. Drafts and dropped previews do not survive a reload.

## Images and videos

Image diffs show **Before** and **After** in compact cards that load near the
visible area. Click a card's header to fold it, or its filename to open the
viewer. The viewer fits images to the pane; **1:1** shows actual size. The
browser decodes the images: SVG, PNG, JPEG, WebP, AVIF, GIF, APNG, BMP, and
ICO, and TIFF, HEIC/HEIF, and JPEG XL where the browser supports them.

Videos use the browser's controls. MP4/M4V, WebM, MOV, OGV, and MKV play when
the browser has the codec; Med does not transcode. Images are limited to 32
MiB and videos to 4 GiB. Saved reviews keep image bytes within each target's 24
MiB capture budget, and do not capture videos.

## Full-file change markers

A whole file opened from a diff marks added lines with green gutter bars and
deleted lines with red bars. A deletion with no remaining row shows as a red
tick at its gap. Blue bars mark working-file additions and replacements. Hover
a marker for its comparison.

Markers use the selected comparison only when its captured text matches the
file on screen; otherwise they compare live content with HEAD. **Open before**
and **Open after** show the exact commit versions. A stale view drops its
markers until you refresh.

## Layout

### Side panes

One column at the right holds **Session** (`⌘⇧B`), **Files** (the folder
button), and **Preview** (`⌘⇧V`). Drag its left edge to resize it. It shows the
two latest panes, one above the other; a third closes the oldest. **Maximize**
gives one pane the column, and **Restore** shares it again. **Show side panes
as tabs** shows one pane at a time, and **Stack side panes** goes back. Both
layouts are prototypes.

### Zen mode

`⌥Z`, the focus button at the top right, or **Enter zen mode** hides every
bar: the tabs, the Changes toolbar, and the status bar. It also hides the saved
review's header, the sidebar's workspaces, the session's controls, and the
reply and background bars. The sidebar keeps the history and files, and the
session keeps its thread and message box; a folded turn still opens.

In zen mode, the command palette has the review's actions: **Send comments
to** the agent, **Copy comments**, and **Return to review**. `⌘B` and `⌘⇧B`
still show or hide the sidebar and the session. Press `⌥Z` again or click
**Leave zen** to leave. Escape does not leave zen mode, so it stays free for
search, Vim, and dialogs.

## Keyboard shortcuts

Press `?` for the shortcuts of where you are: Review, File, Editor, or Pickers.
Type to search every context by action or key, such as `close`, `zz`, or `⌘K`;
Enter runs a row that has a command. On Linux, use Ctrl for ⌘ and Alt for ⌥.

| Action                           | Shortcut      |
| -------------------------------- | ------------- |
| Command palette                  | `⌘K`          |
| Find a file                      | `⌘⇧K`         |
| Search file contents             | `⌘⇧F`         |
| Find in the diff                 | `⌘F`          |
| Symbols in this file             | `⌘O`          |
| Symbols in the project           | `⌘⇧O`         |
| Open a branch or worktree        | `⌘⇧G`         |
| Show workspace 1–9               | `⌘1`–`⌘9`     |
| Switch to a recent workspace     | `⌃Tab`        |
| Toggle the sidebar / session     | `⌘B` / `⌘⇧B`  |
| Zen mode                         | `⌥Z`          |
| Comment on selected lines        | `c`           |
| Paste a brief                    | `⌘V`          |
| Next / previous excerpt or reply | `]` / `[`     |
| Resume search                    | `⌥R`          |
| Keep the preview tab             | `⌥P`          |
| Open a found file and keep it    | `⌘↵`          |
| Show tab 1–8 / the last tab      | `⌥1`–`⌥9`     |
| Previous / next tab              | `⌘⇧[` / `⌘⇧]` |
| Toggle gutter blame              | `⌥B`          |
| Close the file                   | `⌥W`          |
| Close all files in the workspace | `⌥⇧W`         |
| Close other files                | `⌥⇧O`         |

Close actions keep the Changes tab and other workspaces. Tab numbers count the
Notes, Changes, and Commit tabs with the file tabs. A browser can take some
shortcuts first; the command palette has the same actions.

## Limits and evidence

- **Highlighting.** JavaScript and TypeScript (with JSX), CSS, HTML, JSON and
  JSONC, Markdown, YAML, TOML, Bash, Go, Python, Rust, Swift, SQL, Svelte,
  diff, INI, HTTP, dotenv, shell sessions, Java, Gradle, C++, and XML. Markdown
  code fences use the matching grammar. C, Zig, and other languages show as
  plain text. Colors can differ from Shiki: most grammars give token kinds or
  short scope stacks, so theme rules that match parent scopes can miss them.
  Go, Rust, and Swift give Shiki's full scope stacks.
- **Files.** Other binary files and unknown encodings show metadata only. Med
  does not render text above 8 MiB, 200,000 lines, or 250,000 characters on one
  line, and renders large text plainly. File lists stop at 50,000 entries. See
  [file browsing](FILE_BROWSING.md).
- **History.** History follows the selected worktree's HEAD. A shallow clone
  can lack the parent that a comparison or blame needs. Blame does not work for
  files that need Git's content conversion.
- **App.** Med is a browser app with a local server. Notes on branches last for
  the session; there is no shared, persistent review store.

Measurements: [Zoekt search](validation/ZOEKT.md) and
[its integration](validation/ZOEKT_INTEGRATION.md),
[highlighting](validation/HIGHLIGHTER_INTEGRATION.md),
[everyday interactions](validation/INTERACTIONS.md),
[symbol search](validation/SYMBOL_SEARCH.md), and
[Vim navigation](validation/VIM_NAVIGATION.md).
