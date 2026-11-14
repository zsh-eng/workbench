# Layout

## Panes

A workspace is a set of tiled panes: the review, and **Session** (`⌘⇧B`)
beside it. Each thread keeps its own layout. Files are a page of the review,
**Files**, not a pane.

A thread opens on its session alone, which fills the workspace. The pages at
the title band's top right, **Review**, **Changes**, **Commit**, and
**Files**, open the review beside it; the page on screen, clicked again, hides the review. `⌘E`
expands the review to the whole workspace, opening it if it hides, and
restores it; in the session beside the review, it expands the session
instead. The session has no Expand or Hide of its own. A thread without
an agent session opens on its review, and a pull request on both.

Each page of the review has its own sidebar: Review's guide, Changes' changed
files, with what the diff compares at its top, and the tree of Files. Its hide button is at its
heading's end, `⌘⌥B` hides and shows it, and a hidden sidebar leaves a button
at the start of the review's second row. Each page keeps its own choice. The
Commit page keeps its files beside the diff, with commit and push as icons
at the list's foot.

Every pane and panel hides, and the review hides while the session shows
beside it, so the workspace always keeps a pane. While the session hides, the
review's **Expand** turns into **Restore** (two arrows pointing in), which
shows it again.
The review's **Expand** is at its row's end while the session shows beside
it. The panel icon,
shaded on the side where the panel is, is only for the sidebar of threads. A
rail's button shows what the rail lists: the guide's signpost, the changed
files' tree, the folder of Files, and the session rail's list, as in Claude Desktop. Med keeps
each choice: a pane's in the thread's layout, the others in the view settings.

The panes are flat, as in Claude's desktop app: they meet edge to edge, with a
1 px line between them, on the same color as every page in the window (New
thread, a vault, Settings, Sources). The sidebar has its own color and a line
at its edge. A file's tabs are plain rectangles, a line between each, with
the file's language icon as the file tree draws it; the current one has the
file's color and joins it.

The window's top row, the title band and the sidebar's **New thread**, is a tight
36 px in a browser tab, under the browser's own bar. The panes start at its
foot, below its line, so its title is centred in the room above them. In the
installed app with its title bar hidden, the row is the title bar's strip, as
tall as the platform makes it, and the sidebar's first row starts after the
window controls. A page that covers the workspace, such as Settings or
Sources, names itself, so in a browser tab it reaches the window's top, and
**Show sidebar** sits in its top left corner while the sidebar hides. The
installed app keeps the title band there for its window controls.

| Pane or panel                   | Hide                                                                  | Show again                                                          |
| ------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Sidebar (the threads)           | **Hide sidebar** in it, `⌘B`                                          | **Show sidebar** at the top left, `⌘B`, or **Show threads** in `⌘K` |
| Review                          | Its page in the title band, clicked again, or **Hide review** in `⌘K` | A page in the title band, `⌘E`, `⌘K`, or opening a file             |
| Session                         | `⌘⇧B`, or `⌘K`                                                        | **Restore** in the review's header, `⌘⇧B`, or `⌘K`                  |
| A vault's files sidebar         | The folder button, or **Hide files sidebar** in `⌘K`                  | The same button, or **Show files sidebar** in `⌘K`                  |
| A page's sidebar (guide, files) | The button at its heading's end, `⌘⌥B`, or `⌘B` in a browser tab      | The button at the start of the review's header, `⌘⌥B`, or `⌘K`      |
| The session rail                | The list button in the title band, `⌘⌥⇧B`                             | The same button, `⌘⌥⇧B`, or **Show session rail** in `⌘K`           |

The review's header shows the buttons at its ends where it has room; a
narrower header keeps its room for the title and the pages, and the shortcuts
and `⌘K` still work. The **Background** list's × has no button to bring the
list back: it hides the tasks until one starts or fails.

- A pane's header acts as a window's title bar. Drag it onto a side of another
  pane to place the pane there, or onto the middle to swap the two; Escape
  leaves it where it was. **Expand** in it, or a double-click on it, zooms
  the pane.
- `⌘⌥←→↑↓` moves the focus to the next pane; with `⇧`, the focused pane moves
  past its neighbor.
- Drag a gap between panes to resize them, or focus the gap and press the
  arrow keys. Double-click a gap, or press `⌘⌃=`, to give the panes equal room.
- `⌘E` expands the review to the whole workspace, wherever the focus is: in
  a pane, a text field, the editor, the title band, or the sidebar. While the
  review hides, it opens it expanded. In the session, or after a click in it,
  while the review shows beside it, `⌘E` expands the session instead. Press
  it again, or click **Restore the other panes** at the review's row's end,
  to show the others; a page in the title band shows the review again too.
  In a workspace without a session, it zooms the focused pane.
  Opening a file shows the others too, so the file shows in the review.
- A pane does not get narrower than 220 pixels or lower than 120. When the
  window is too small for all of them, Med hides panes until the rest fit, and
  shows them again when there is room.
- A review narrower than 760 pixels shows unified diffs.

## The title band and the review's header

The title band is one row for the whole workspace. It starts with **Back**
and **Forward** (`⌃-` and `⌃⇧-`, as in VS Code, or `⌘[` and `⌘]` outside a
text field or a file, where they indent), which
step through what you showed: workspaces and threads, pages such as
Sources, a thread's pages and files, and its reviews, as a browser steps
through pages. A narrow window leaves the two buttons out; their keys still
work. Then it names the
checkout that the workspace shows, by its repository and branch, or the
thread while the sidebar hides. Its end always holds, from
left to right: the session's controls (its context's use, or the session
rail's list button where the rail has room), then the pages, the pull request's comments,
**Copy comments** with their number while the review has comments, and
**Display** (an icon). They show whether or not the review does.

The review's header is one row under the band: its name, after Med's mark
(or its pull request's), the page's sidebar's button while it hides (the
changed files' tree, or the guide's signpost), what the page compares or
steps through, and the comparison's **+/−** totals on Review and Changes. The
pane's **Expand** ends it. A title that the row cuts fades out at its end;
the pointer on it shows all of it. The thread under the band has no header:
the band names it.

- The pages are icons side by side, and a tooltip names each: **Review**, a
  signpost, as its Guide walks through the change; **Changes**, a plus and a
  minus; **Commit**, Git's mark, or **Pull request** for a thread with
  one; and **Files**, a folder. The number keys `1` to `4` switch between
  them while the focus is not in a text field, the diff, or the session.
- **Files** is a page of its own: the tree of what the workspace shows, at
  its side, and a tab for each file that you open, with Search. The other
  pages have no tabs: a file that opens from a diff, a link, the tree, or
  Find file (`⌘⇧K`) shows on Files, and **Files** shows the file that
  showed last. **Show files sidebar** in `⌘K` opens Files with its tree.
  Closing the last file goes back to the page before it.
- **Display**, the sliders icon, has a row for each choice, as Pierre lays its own out: the
  diff's **Layout** (**Split** or **Unified**, two icons, `S`), **Wrap long
  lines** (`W`), **Comments in the diff** (`C`), the code's text size, and
  the **Theme**: Auto, which follows the system, Light, or Dark. The keys
  work while it is open. **All code settings**, at its foot, opens Settings at
  Code, which also shows a diff in the theme.
- In Changes, what the diff compares tops the page's sidebar, and its menu
  also has **Base branch…** (for a branch
  without a worktree, **Compare against a branch…**) and **Compare two
  revisions…**, and in a shared checkout **Only this session's files**. In a
  thread, `⌘⇧G`, `⌘O`, or the session rail's **Thread** rows choose the
  branch, worktree, or repository that the thread shows
  ([Threads](threads.md#a-threads-pane)).
- **⋯** holds only what a narrow header folds away: what the diff compares,
  and the pane's **Expand**. The rest is in `⌘K` and on its keys:
  **Find in diffs** (`⌘F`, the find bar below), **Collapse all files**, **Push…**, **Refresh
  review** (`R`), **Open working file** (`O`), the panes, and **Clear all
  comments**. Comments go to an agent from its session's message box.
- A header narrower than 520 pixels puts **Expand** in **⋯**.
- A narrow header gives way in this order: what the diff compares (in
  Review, or while Changes' sidebar hides) moves into **⋯**, and the title
  shortens to Med's mark.
- **Find** (`⌘F`) is one bar at the top right, the same in the diff and in a
  file: the query, **Match case** (`⌥C`), **Whole word** (`⌥W`), **Regular
  expression** (`⌥R`), how many lines match and which shows, and Previous and
  Next. Typing goes to the first match; `↵` and `⇧↵` step, as do `n` and `N`
  in the diff, and `Esc` closes it. In a file, Vim's `/` and `?` open the same
  bar ([Vim navigation](find.md#symbols-and-vim-navigation)).
- There is no toolbar and no status bar. While the page reconnects to the
  server, a notice shows at the lower right of the workspace.

## View settings

Med keeps your view settings in the browser's storage for its address, so
they outlast a reload, a closed window, and a restart of the browser or of
Med's server. Each port is another address: a second profile on another port,
or a new browser profile, starts with the defaults. A change shows at once in
every workspace and window, except where the table says "each window" or
"each workspace": those read the setting when they open.

| Setting                                        | Default                   | Kept in (`localStorage`)                              |
| ---------------------------------------------- | ------------------------- | ----------------------------------------------------- |
| Split or unified diff                          | Split                     | `med:mode`                                            |
| Wrap long lines                                | Off                       | `med:wrap`                                            |
| Comments in the diff                           | On                        | `med:comments`                                        |
| Changes' sidebar, Review's guide               | Auto                      | `med:changes-rail`, `med:guide-rail`                  |
| Code text size (11 to 16 pixels)               | 12                        | `med:code-size`                                       |
| Theme: mode, light theme, dark theme           | Dark, Med Dawn, Med Night | `med:theme-mode`, `med:theme-light`, `med:theme-dark` |
| Vim keys and line blame in files               | On                        | `med:vim`, `med:line-blame`                           |
| Find file's preview                            | On                        | `med:picker-preview`                                  |
| Background tasks (Session pane)                | Open                      | `med:background`                                      |
| Session rail                                   | Shown                     | `med:session-panel`                                   |
| Sidebar shown, its width (each window)         | Shown, 272                | `med:sidebar`, `med:sidebar-width`                    |
| Panes: open, hidden, sizes, zoom (each thread) | Per layout                | `med:panes:v1:<workspace>`                            |
| Changes rail, Guide, and Commit list widths    | Per pane                  | `med:column:v1:<kind>`                                |

A missing or unknown value reads as the default, so nothing needs setting up.
Some choices belong to one place, not to the view: the Git blame gutter (one
file tab), **Collapse all files** (one review), and a Markdown file's source
view (one file). **Display**'s text size sets the code's size; the browser's
zoom (`⌘+`, `⌘−`) changes everything else, and the browser keeps it. Med has
no whitespace setting.
