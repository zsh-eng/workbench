# Layout

## Panes

A workspace is a set of tiled panes: the review, and **Changes** (the changed
files, `⌘⌃B`), **Session** (`⌘⇧B`), and **Files** (the folder button) beside it. Each
thread keeps its own layout.

Every pane and panel but the review hides. A pane that a review or thread
opens by itself, **Changes** or a thread's **Session**, leaves a button where
it was while it is hidden, at the start of the review's row. **Files**, which
you open yourself, opens again where you opened it: **⋯** or the folder
button. A pane's hide button is in its header, where its × would be. The panel
icon, shaded on the side where the panel is, hides and shows the changed
files, the rail, and the session's side panel, and hides the session; a hidden
session's button has its agent's mark. Med keeps each choice: a pane's in the
thread's layout, the others in the view settings.

| Pane or panel                      | Hide                                                 | Show again                                                                                                                                   |
| ---------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Sidebar (the threads)              | **Hide sidebar** in it, `⌘B`                         | **Show sidebar** at the top left, `⌘B`, or **Show threads** in `⌘K`                                                                          |
| Changes (the changed files)        | **Hide changed files** in its header, `⌘⌃B`          | **Show changed files** at the start of the review's row, `⌘⌃B`, **Changed files** in quiet chrome's **⋯**, or **Show changed files** in `⌘K` |
| Session                            | The button in its header, `⌘⇧B`                      | **Show agent session** at the start of the review's row (full chrome: at its end), `⌘⇧B`, **Agent session** in quiet chrome's **⋯**, or `⌘K` |
| Files                              | The × in its header                                  | **Files** in quiet chrome's **⋯**, the folder button in full chrome, or **Show files sidebar** in `⌘K`                                       |
| A vault's files sidebar            | The folder button, or **Hide files sidebar** in `⌘K` | The same button, or **Show files sidebar** in `⌘K`                                                                                           |
| Files and commits rail, Guide list | The button at the end of the review's row, `⌘⌥B`     | The same button, `⌘⌥B`, or **Show files and commits** or **Show the guide** in `⌘K`                                                          |
| The session's side panel           | The button in the session's row, `⌘⌥⇧B`              | The same button, `⌘⌥⇧B`, or **Show the session's side panel** in `⌘K`                                                                        |

The review's row shows the buttons at its ends where it has room; a narrower
row keeps its room for the tabs and the comparison, and the shortcuts, **⋯**,
and `⌘K` still work. `⌘⌃B` is for macOS: on Linux it would be the rail's
Ctrl+Alt+B. Two have no button to bring them back: the **Question** pane
discards its question and answer unless you keep them as a comment, and the
**Background** list's × hides the tasks until one starts or fails.

- A pane's header acts as a window's title bar. Drag it onto a side of another
  pane to place the pane there, or onto the middle to swap the two; Escape
  leaves it where it was. Double-click it to zoom the pane.
- `⌘⌥←→↑↓` moves the focus to the next pane; with `⇧`, the focused pane moves
  past its neighbor.
- Drag a gap between panes to resize them, or focus the gap and press the
  arrow keys. Double-click a gap, or press `⌘⌃=`, to give the panes equal room.
- `⌘E` zooms the focused pane to the whole workspace. Press it again, or click
  **Restore** in the pane's header, to show the others.
- A pane does not get narrower than 220 pixels or lower than 120. When the
  window is too small for all of them, Med hides panes until the rest fit, and
  shows them again when there is room.
- A review narrower than 760 pixels shows unified diffs.

## Zen mode

`⌥Z`, the focus button at the top right, or **Enter zen mode** hides every
bar: the tabs, the Changes toolbar, and the status bar. It also hides the saved
review's header, the session's controls, and the reply and background bars.
The panes stay, and the session keeps its thread and message box; a folded
turn still opens.

In zen mode, the command palette has the review's actions: **Send comments
to** the agent, **Copy comments**, **Show Review**, and **Show Changes**. `⌘B` and `⌘⇧B`
still show or hide the sidebar and the session. Press `⌥Z` again or click
**Leave zen** to leave. Escape does not leave zen mode, so it stays free for
search, Vim, and dialogs.

## Quiet chrome

Quiet chrome is on by default. Each pane has one row, and each thing shows
once: the sidebar names the thread (the title band does while the sidebar is
hidden), the title band names its branch, the review's row names what the diff
compares, and the session's row names the agent and its state.

- The review's row has its tabs (**Review**, **Changes**, **Commit**), the
  comparison or, in Review, the version, and **⋯**. In Changes, the
  comparison menu also has **Base branch…** (for a branch without a
  worktree, **Compare against a branch…**) and **Compare two revisions…**, in
  a thread **Thread checkout…**, and in a shared checkout **Only this
  session's files**.
- **⋯** has the comments, **Find in diffs**, the panes, **Zen mode**, **Push…**,
  and **Refresh review**. Its **View** menu has the diff's layout, comments,
  wrapping, the files and commits rail, and **Collapse all files**.
- There is no Changes toolbar and no status bar. While the page reconnects to
  the server, a notice shows at the lower right of the workspace.
- Every action stays in `⌘K` and keeps its shortcut. **Use full chrome** in
  `⌘K` brings back the toolbar, the status bar, and the review's header; **Use
  quiet chrome** goes back. Med keeps the choice for every window.

## View settings

Med keeps your view settings in the browser's storage for its address, so
they outlast a reload, a closed window, and a restart of the browser or of
Med's server. Each port is another address: a second profile on another port,
or a new browser profile, starts with the defaults. A change shows at once in
every workspace and window, except where the table says "each window" or
"each workspace": those read the setting when they open.

| Setting                                        | Default      | Kept in (`localStorage`)           |
| ---------------------------------------------- | ------------ | ---------------------------------- |
| Split or unified diff                          | Split        | `med:mode`                         |
| Wrap long lines                                | Off          | `med:wrap`                         |
| Show comments                                  | On           | `med:comments`                     |
| Guide or files and commits rail                | Auto         | `med:changes-rail`                 |
| Quiet or full chrome                           | Quiet        | `med:chrome:v1`                    |
| Theme                                          | Med Night    | `med:theme:v1`                     |
| Vim keys and line blame in files               | On           | `med:vim`, `med:line-blame`        |
| Find file's preview                            | On           | `med:picker-preview`               |
| Show work, background tasks (Session pane)     | Folded, open | `med:work`, `med:background`       |
| Session side panel                             | Shown        | `med:session-panel`                |
| Sidebar shown, its width (each window)         | Shown, 272   | `med:sidebar`, `med:sidebar-width` |
| Zen mode (each workspace)                      | Off          | `med:zen`                          |
| Panes: open, hidden, sizes, zoom (each thread) | Per layout   | `med:panes:v1:<workspace>`         |
| Changes rail, Guide, and Commit list widths    | Per pane     | `med:column:v1:<kind>`             |

A missing or unknown value reads as the default, so nothing needs setting up.
Some choices belong to one place, not to the view: the Git blame gutter (one
file tab), **Collapse all files** (one review), and a Markdown file's source
view (one file). Med has no text size or whitespace setting; the browser's
zoom (`⌘+`, `⌘−`) changes the text size, and the browser keeps it.
