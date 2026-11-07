# Layout

## Panes

A workspace is a set of tiled panes: the review, and **Session** (`⌘⇧B`) and
**Files** (**⋯**) beside it. Each thread keeps its own layout.

Each page of the review has its own sidebar: Review's guide, and Changes' changed
files, with what the diff compares at its top. Its hide button is at its
heading's end, `⌘⌥B` hides and shows it, and a hidden sidebar leaves a button
at the start of the review's header. Each page keeps its own choice. The
Commit page keeps its files, with the message and Push, beside the diff.

Every pane and panel hides, and the review hides while the session shows
beside it, so the workspace always keeps a pane. A thread's **Session** leaves a
button at the start of the review's header while it is hidden, with its
agent's mark; a hidden review leaves **Show review** in the session's header,
and hiding the session then shows the review. **Files**, which you open
yourself, opens again from **⋯**. A pane's hide button is in its header, where
its × would be, with **Expand** before it while other panes show. The panel icon,
shaded on the side where the panel is, hides and shows the sidebars and the
session's side panel, and hides the session. Med keeps each choice: a pane's in
the thread's layout, the others in the view settings.

| Pane or panel                           | Hide                                                                                    | Show again                                                                                              |
| --------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Sidebar (the threads)                   | **Hide sidebar** in it, `⌘B`                                                            | **Show sidebar** at the top left, `⌘B`, or **Show threads** in `⌘K`                                     |
| Review                                  | **Hide the review** in its header, **Hide review** in **⋯** or `⌘K`, beside the session | **Show review** in the session's header, `⌘K`, or opening a page or a file                              |
| Session                                 | The button in its header, `⌘⇧B`                                                         | **Show agent session** at the start of the review's header, `⌘⇧B`, **Agent session** in **⋯**, or `⌘K`  |
| Files                                   | The × in its header                                                                     | **Files** in **⋯**, or **Show files sidebar** in `⌘K`                                                   |
| A vault's files sidebar                 | The folder button, or **Hide files sidebar** in `⌘K`                                    | The same button, or **Show files sidebar** in `⌘K`                                                      |
| A page's sidebar (guide, changed files) | The button at its heading's end, `⌘⌥B`, or `⌘B` in a browser tab                        | The button at the start of the review's header, `⌘⌥B`, **Guide** or **Changed files** in **⋯**, or `⌘K` |
| The session's side panel                | The button in the session's row, `⌘⌥⇧B`                                                 | The same button, `⌘⌥⇧B`, or **Show the session's side panel** in `⌘K`                                   |

The review's header shows the buttons at its ends where it has room; a
narrower header keeps its room for the title and the pages, and the shortcuts,
**⋯**, and `⌘K` still work. Two have no button to bring them back: the **Question** pane
discards its question and answer unless you keep them as a comment, and the
**Background** list's × hides the tasks until one starts or fails.

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
- A pane does not get narrower than 220 pixels or lower than 120. When the
  window is too small for all of them, Med hides panes until the rest fit, and
  shows them again when there is room.
- A review narrower than 760 pixels shows unified diffs.

## The review's header

The review has one header, and each thing shows once: the sidebar names the
thread (the title band does while the sidebar is hidden), and the session's
row names the agent and its state.

- From the start: the session's button while the session is hidden (with its
  agent's mark), the review's title after Med's mark, and its branch, which
  copies its name. Then what the diff compares, **⋯**, **Display**, and the
  pages.
- The pages are **Review**, **Changes**, and **Commit**, or **Pull request**
  for a thread with one. The number keys `1` to `3` switch between them while
  the focus is not in a text field, the diff, or the session.
- **Display** has the diff's layout (**Split** or **Unified**, `S`), **Wrap
  long lines** (`W`), **Comments in the diff** (`C`), and the code's text
  size. The keys work while it is open. **All code settings**, at its foot,
  opens Settings at Code.
- In Changes, what the diff compares tops the page's sidebar, and its menu
  also has **Base branch…** (for a branch
  without a worktree, **Compare against a branch…**) and **Compare two
  revisions…**, in a thread **Thread checkout…**, and in a shared checkout
  **Only this session's files**.
- **⋯** has the comments, **Find in diffs**, the panes, **Push…**, and
  **Refresh review**. Its **View** menu has **Collapse all files**.
- At its end, the pane's **Expand** and **Hide the review**, while the session
  shows beside it. A header narrower than 520 pixels puts them in **⋯**.
- A narrow header gives way in this order: what the diff compares (in
  Review, or while Changes' sidebar hides) moves into **⋯**, **Display** keeps its icon, the title shortens to Med's mark, the
  branch hides, and last the pages' names shorten.
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
