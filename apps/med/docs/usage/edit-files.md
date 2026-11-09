# Edit working files

Working files and files outside Git open in Vim Normal mode; press `i` to
insert. Use `a`, `o`, `dd`, `ciw`, Visual selections, `p`, `.`, `u`, and
Ctrl+R as in Vim. Default yanks (`y`, `yiw`, `yy`) also copy to the clipboard;
named and black-hole registers keep their Vim behavior. Med's shortcuts come
before Vim's, except on macOS: Control+B, Control+F, and Control+O reach Vim,
because Command runs Med's shortcuts.

In a thread, `gc` comments on the cursor's line or the selected lines, and
`ga` asks the thread's agent about them
([Comment on a file](review-changes.md#comment-on-a-file)).

`:w` or `⌘S` writes the file; `:wq` saves, then closes if the save succeeds;
`:q`, or the tab's ×, closes it. The file's header keeps only its path, its
saved dot, and blame: a hollow dot means saved and a filled dot means
unsaved. Closing unsaved text asks you to **Discard draft** or **Keep
editing**. Saving does not
stage or commit; use the [Commit tab](#commit-and-push). Blame hides while a
draft is unsaved.

Drafts and their undo history stay in memory across tab switches and closes;
open the file again to resume. An unsaved draft also stays when you close its
workspace, or when Med unloads a workspace that you have not shown for a
while; it comes back when you open the file again. Closing a tab or a
workspace with unsaved drafts asks first. Unsaved drafts are also kept in the
browser's storage, by workspace and file, so they come back after a reload,
without their undo history. If the file changed meanwhile, the editor says so.
Med keeps up to 24 drafts in each workspace. Leaving the page warns only when
the browser could not keep a draft, as when its storage is full.

If another process changes the file, the editor says so. A saved draft offers
**Refresh contents**. An unsaved draft stays, and the editor shows what changed
on disk since the draft started, as a read-only diff, with two choices: **Keep
my version** saves the draft over the new file, and **Use the file on disk**
drops the draft. Med does not merge them. Med edits existing UTF-8 text files up to 1 MiB.
It cannot save symlinks, hard links, or paths through nested repositories. It
keeps uniform CRLF line endings and executable bits. Commit and saved-review
files are read-only.

To link to a working file in a registered repository, encode the worktree path
and the repository-relative path:

```text
http://127.0.0.1:6330/file?repo=%2Fpath%2Fto%2Frepo&path=src%2Fexample.ts&edit=1
```

The link opens live content; it does not save a review or register a
repository. The browser must have opened the launch URL first.

## Commit and push

Press `q` in a review of live changes, or click the **Commit** tab, to stage
files, commit them, and push the branch. Press `q` again to go back to the tab
that showed before.

- **Files.** The list shows each changed file: ● staged, ◐ partly staged, ○ not
  staged. Their diffs follow in the same order. `j` and `k` move through the
  files and scroll the diffs; `Enter` opens a file in a tab.
- **Filter.** `/` filters by path. `Enter` keeps the filter and `Esc` clears
  it.
- **Stage.** `Space`, or a click on the mark, stages or unstages a whole file.
  `a` stages every file shown, or unstages them all when all are staged.
- **Commit.** `c` or **Commit…** opens the message: a summary, and `Enter`
  goes on to the description. `⌘↵` commits the staged files. With nothing
  staged, the commit takes every file that the dialog counts, unless a file
  has a conflict. As with `git commit -a`, those files are staged only for
  the commit: if it does not complete, nothing stays staged. `Esc` keeps the
  message as a draft. Hooks run; if a hook stops the commit, its output shows
  under the message.
- **Push.** `⇧P` pushes to the upstream. For a branch without one, Med asks,
  then pushes to the push remote (usually `origin`) and tracks it. Med never
  force-pushes.

If the staged files change outside Med, or a stage fails, the commit stops
and the tab reads them again. A commit holds the files that its dialog
counted, with the changes that the tab showed, or nothing: when an agent
changes a file after the tab showed it, the commit stops and keeps the
message. For hunks, amends, rebases, and branch switches, use **Copy lazygit
command** on the workspace.

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
`http://127.0.0.1:6330/file/absolute/path/Example.java?line=42&column=8`. The
link reads the current file, not a snapshot. It grants access to that file
only, not its folder; the server keeps at most 256 grants until it restarts.

Drop text, image, or video files anywhere in Med for read-only previews. They
stay in the browser. Drop up to 12 files at once; a workspace holds at most 24
tabs. Text is limited to 8 MiB for each file, 24 MiB for each drop, and 32 MiB
in total. Drafts and dropped previews do not survive a reload.
