# Settings

**Settings**, at the foot of the sidebar, or **Open Settings** in `⌘K`, opens
Med's settings at `/settings`: one page of sections, in which each setting is
a row with its name and what it does at the left and its control at the
right. `⌘K` also opens each section, such as **Settings: Open in**
(`/settings/open-in`). With nothing chosen, Med follows the system between
**Pierre Light** and **Pierre Dark**.

## Appearance

- **Interface theme**: **Light**, **Dark**, or **System**, which shows the
  light theme while the system is light and the dark one while it is dark,
  and switches when the system does.
- **Light theme** and **Dark theme**: the theme for each. A theme chosen in
  `⌘K`'s **Change theme** becomes the theme for its appearance, and shows: in
  System, a theme of the other appearance switches the mode to it.

Med paints its window in the chosen theme's color before it loads, so the
first frame is never the browser's own white or black.

## Code

The diff's layout (**Split** or **Unified**), **Wrap long lines**, **Comments
in the diff**, and the code's **Text size**: the same settings as the review
header's **Display**, whose **All code settings** opens this page at Code
(`/settings/code`). **Preview**, at the section's end, is a small made-up
change as a review shows it: the theme on screen, with these choices, so a
change of theme or of a setting shows at once.

## Open in

Where a file's **Open in** sends its line. Med fills this section from your
repositories' remotes and from this Mac.

- **Code hosts**: each host of the sources' remotes, with how many
  repositories use it. github.com is GitHub; another host that answers as
  GitHub does is GitHub Enterprise. A host that Med does not recognise is
  left out of Open in until you choose its kind: **GitHub**, **GitLab**, or
  **Leave out**.
- **Sourcegraph**: your instance's address. Open in then has **Sourcegraph**,
  at the same line: the address, then the host, the repository, and the
  branch.
- **Editors**: VS Code, Cursor, Zed, and IntelliJ IDEA, where Med finds them
  on the PATH or in Applications. A switch lists one in Open in, and **Make
  default** puts one first.
- **Other links**: a name and a template for any other tool that takes a
  file and a line, with `{host}`, `{owner}`, `{repo}`, `{ref}`, `{path}`, and
  `{line}`.

A link that names the branch waits for a push: while the branch is not
pushed, Open in says **Push to open on** the host or link.

## Files and sessions

**Vim keys** in files, **Blame on the cursor's line**, the **Preview in Find
file**, and what `⌘↩` does with **a message while the agent works**: send it
at the agent's next step, or queue it for the turn's end (`⇧⌘↩` does the
other).

## Sources

**Open Sources** opens the registered repositories and notes vaults
(`/sources`). **Pull base branches** keeps each repository's base branch up
to date with its remote, every 15 minutes, where nothing of yours would
change (see [Run Med](run-med.md#base-branches-stay-up-to-date)).

## The settings file

Every setting lives in `~/.config/med/settings.json` (or
`$XDG_CONFIG_HOME/med/settings.json`), so an agent can change one by editing
the file. Med applies a saved change at once, in every open window. The page
names the file at its top and shows what the file holds at its end. A choice
in Med writes its key and keeps the others. A file that is not valid JSON,
such as one mid-edit, keeps the settings that Med read last, and the page
says why.

A Med with another state folder (`--state-dir`), such as a trial or a test,
keeps its own `settings.json` in that folder, so it never changes your Med.

Med also keeps each setting but Open in's in the browser's storage for its
address, as it does the other [view settings](layout.md#view-settings), and
the two stay the same. Med reads Open in's on its server. A choice from before the file goes to it once, the first time Med reads
the file.

| Key                     | Values                                                     | Default          |
| ----------------------- | ---------------------------------------------------------- | ---------------- |
| `appearance.theme`      | `"system"`, `"light"`, or `"dark"`                         | `"system"`       |
| `appearance.lightTheme` | a light theme's id, such as `"graphite-light"`             | `"pierre-light"` |
| `appearance.darkTheme`  | a dark theme's id, such as `"med-night"`                   | `"pierre-dark"`  |
| `diffs.layout`          | `"split"` or `"unified"`                                   | `"split"`        |
| `diffs.wrap`            | `true` or `false`: wrap long lines                         | `false`          |
| `diffs.comments`        | `true` or `false`: comments in the diff                    | `true`           |
| `code.textSize`         | `11`, `11.5`, `12`, `12.5`, `13`, `14`, `15`, `16`         | `12`             |
| `files.vim`             | `true` or `false`: Vim keys in files                       | `true`           |
| `files.lineBlame`       | `true` or `false`: the cursor line's blame                 | `true`           |
| `files.findPreview`     | `true` or `false`: the preview in Find file                | `true`           |
| `session.followUp`      | `"now"` or `"queue"`: what `⌘↩` does while the agent works | `"now"`          |
| `sources.pullBase`      | `true` or `false`: pull each repository's base branch      | `true`           |
| `openIn.hosts`          | a host's kind by host: `"github"`, `"gitlab"`, or `"off"`  | `{}`             |
| `openIn.sourcegraph`    | your Sourcegraph's address, or `""` for none               | `""`             |
| `openIn.editors`        | the editors to list, in order, such as `["vscode", "zed"]` | each one found   |
| `openIn.links`          | other links by name, each a template                       | `{}`             |

A key that Med does not know, or a value that its key does not take, changes
nothing.
