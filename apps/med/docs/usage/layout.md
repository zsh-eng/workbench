# Layout

## Panes

A workspace is a set of tiled panes: the review, and **Session** (`⌘⇧B`) and
**Files** (**Show files sidebar** in `⌘K`) beside it. Each thread keeps its
own layout.

Each page of the review has its own sidebar: Review's guide, and Changes' changed
files, with what the diff compares at its top. Its hide button is at its
heading's end, `⌘⌥B` hides and shows it, and a hidden sidebar leaves a button
at the start of the review's second row. Each page keeps its own choice. The
Commit page keeps its files, with the message and Push, beside the diff.

Every pane and panel hides, and the review hides while the session shows
beside it, so the workspace always keeps a pane. While one hides, the other's
**Expand** turns into **Restore** (two arrows pointing in), which shows it
again: the review's shows a hidden **Session**, and the session's a hidden
review, in place of the session's own **Hide**, since the session is then the
whole workspace. **Files**, which you open yourself, opens again from `⌘K`. A
pane's **Hide** (a line, as a window's minimize) is in its header, where its ×
would be, with **Expand** before it while other panes show. The panel icon,
shaded on the side where the panel is, is only for sidebars: the page's
sidebar, the threads, and the session's side panel. Med keeps each choice: a
pane's in the thread's layout, the others in the view settings.

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

| Pane or panel                           | Hide                                                                              | Show again                                                             |
| --------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Sidebar (the threads)                   | **Hide sidebar** in it, `⌘B`                                                      | **Show sidebar** at the top left, `⌘B`, or **Show threads** in `⌘K`    |
| Review                                  | **Hide the review** in its header, or **Hide review** in `⌘K`, beside the session | **Restore** in the session's header, `⌘K`, or opening a page or a file |
| Session                                 | **Hide** in its header, `⌘⇧B`                                                     | **Restore** in the review's header, `⌘⇧B`, or `⌘K`                     |
| Files                                   | The × in its header                                                               | **Show files sidebar** in `⌘K`                                         |
| A vault's files sidebar                 | The folder button, or **Hide files sidebar** in `⌘K`                              | The same button, or **Show files sidebar** in `⌘K`                     |
| A page's sidebar (guide, changed files) | The button at its heading's end, `⌘⌥B`, or `⌘B` in a browser tab                  | The button at the start of the review's header, `⌘⌥B`, or `⌘K`         |
| The session's side panel                | The button in the session's row, `⌘⌥⇧B`                                           | The same button, `⌘⌥⇧B`, or **Show the session's side panel** in `⌘K`  |

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
- `⌘E` zooms the focused pane to the whole workspace. Press it again, or click
  **Restore the other panes** in the pane's header, to show the others.
  Opening a file shows the others too, so the file shows in the review.
- A pane does not get narrower than 220 pixels or lower than 120. When the
  window is too small for all of them, Med hides panes until the rest fit, and
  shows them again when there is room.
- A review narrower than 760 pixels shows unified diffs.

## The review's header

The review's header has two rows, and each thing shows once: the session's
row names the agent and its state.

- The title row names the review, after Med's mark (or its pull request),
  and holds what acts on all of it: **Copy comments** with their number while
  the review has comments, **⋯**, and **Display** (an icon). Where the review
  reaches the window's top right, the title row goes up into the title band:
  beside the session it covers the band above the review, with the line
  between the panes running up through it, and the band's start keeps the
  checkout. Elsewhere the title row is the header's first row, with the
  branch, which copies its name.
- The second row lines up with the session's header: the session's button
  while the session is hidden (with its agent's mark), the page's sidebar's
  button while it hides (the changed files' tree, or the guide's signpost),
  what the page compares or steps through, the comparison's **+/−** totals
  on Review and Changes, then the pages and the pane's **Expand** and
  **Hide**.
- Where the review fills the window, its header is one row, in the title
  band: the session's button and the title lead it, the checkout follows,
  quieter, and the second row's parts and the title row's actions end it.
- The pages are **Review**, **Changes**, and **Commit**, or **Pull request**
  for a thread with one. The number keys `1` to `3` switch between them while
  the focus is not in a text field, the diff, or the session.
- **Display**, the sliders icon, has a row for each choice, as Pierre lays its own out: the
  diff's **Layout** (**Split** or **Unified**, two icons, `S`), **Wrap long
  lines** (`W`), **Comments in the diff** (`C`), the code's text size, and
  the **Theme**: Auto, which follows the system, Light, or Dark. The keys
  work while it is open. **All code settings**, at its foot, opens Settings at
  Code, which also shows a diff in the theme.
- In Changes, what the diff compares tops the page's sidebar, and its menu
  also has **Base branch…** (for a branch
  without a worktree, **Compare against a branch…**) and **Compare two
  revisions…**, in a thread **Thread checkout…**, and in a shared checkout
  **Only this session's files**.
- **⋯** holds only what a narrow header folds away: what the diff compares,
  and the pane's **Expand** and **Hide**. The rest is in `⌘K` and on its keys:
  **Find in diffs** (`⌘F`, the find bar below), **Collapse all files**, **Push…**, **Refresh
  review** (`R`), **Open working file** (`O`), the panes, and **Clear all
  comments**. Comments go to an agent from its session's message box.
- At its end, the pane's **Expand** and **Hide the review**, while the session
  shows beside it. A header narrower than 520 pixels puts them in **⋯**.
- A narrow header gives way in this order: what the diff compares (in
  Review, or while Changes' sidebar hides) moves into **⋯**, the title shortens to Med's mark, the
  branch hides, and last the pages' names shorten.
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
| Show work, background tasks (Session pane)     | Folded, open              | `med:work`, `med:background`                          |
| Session side panel                             | Shown                     | `med:session-panel`                                   |
| Sidebar shown, its width (each window)         | Shown, 272                | `med:sidebar`, `med:sidebar-width`                    |
| Panes: open, hidden, sizes, zoom (each thread) | Per layout                | `med:panes:v1:<workspace>`                            |
| Changes rail, Guide, and Commit list widths    | Per pane                  | `med:column:v1:<kind>`                                |

A missing or unknown value reads as the default, so nothing needs setting up.
Some choices belong to one place, not to the view: the Git blame gutter (one
file tab), **Collapse all files** (one review), and a Markdown file's source
view (one file). **Display**'s text size sets the code's size; the browser's
zoom (`⌘+`, `⌘−`) changes everything else, and the browser keeps it. Med has
no whitespace setting.
