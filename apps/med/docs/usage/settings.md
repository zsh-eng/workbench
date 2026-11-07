# Settings

**Settings**, at the foot of the sidebar, opens Med's settings at
`/settings`. Its sections are on the left, and each setting is a row: its name
and what it does, and its control.

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
header's **Display**, whose **All code settings** opens this page.

## Sources

**Sources** opens the registered repositories and notes vaults
(`/sources`).

## The settings file

Every setting lives in `~/.config/med/settings.json` (or
`$XDG_CONFIG_HOME/med/settings.json`), so an agent can change one by editing
the file. Med applies a saved change at once, in every open window. Each
settings page ends with the file's path and its part of the file. A choice
in Med writes its key and keeps the others. A file that is not valid JSON,
such as one mid-edit, keeps the settings that Med read last, and the page
says why.

Med also keeps each setting in the browser's storage for its address, as it
does the other [view settings](layout.md#view-settings), and the two stay the
same. A choice from before the file goes to it once, the first time Med reads
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

A key that Med does not know, or a value that its key does not take, changes
nothing.
