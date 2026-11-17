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
  System, a theme of the other appearance switches the mode to it. In that
  picker each row shows the theme's canvas and accent and says **Light** or
  **Dark**, and a check marks the saved theme; `↑` and `↓` preview a
  theme, `↵` saves it, and `Esc` restores yours.

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
  **Leave out**. The pull requests page searches each GitHub host too.
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

## Grafana

Charts in replies can draw a Grafana panel (see
[Charts](markdown.md#charts)). Med reads the panel with a token of yours,
which stays on your Mac: it never goes into a transcript, to a page, or to an
agent. To set one up:

1. **Make a token.** In Grafana, **Administration → Users and access →
   Service accounts → Add service account**, with the **Viewer** role, then
   **Add service account token**. Copy it.
2. **Put it in your Keychain.** In Terminal, run this, and paste the token
   when it asks. Asking keeps the token out of your shell's history.

   ```sh
   security add-generic-password -s grafana-acme -a "$USER" -w
   ```

3. **Connect.** In **Settings → Grafana**, choose **In my Keychain**, then
   enter Grafana's address, such as `https://grafana.acme.com` (or one under
   a path), and the item's name, `grafana-acme`. Or, in Terminal:

   ```sh
   med grafana connect https://grafana.acme.com --keychain grafana-acme
   ```

Med checks the token with Grafana and shows the organization that it reads.
From then on Med reads the token from the Keychain when a chart needs it, at
most once a minute. Change the token in the Keychain and Med uses the new one
within a minute.

**Paste it here** keeps a pasted token instead, in `grafana-tokens.json`
beside the settings file, which only your user can read. Either way, Med
sends the token only to that Grafana.

The settings file holds the address (`grafana.sites`) and the item's name
(`grafana.keychain`), never a token, so an agent can set up a Grafana by
editing them, or with `med grafana`:

- `med grafana` lists the Grafanas and where each one's token is.
- `med grafana connect <address> --keychain <item>` checks and keeps one.
- `med grafana connect <address> --token-stdin` takes a pasted token from
  standard input, as `pbpaste | med grafana connect …`.
- `med grafana connect <address>` checks the token Med has.
- `med grafana remove <address>` forgets a Grafana, as **Remove** does. The
  Keychain keeps its item.

A Grafana whose certificate comes from your company's own authority needs Med
started with `NODE_EXTRA_CA_CERTS` set to that authority's file.

## Chart sources

A chart source reads a kind of link that Med cannot read itself: a Grafana
behind your company's sign-in, a metrics service, or anything a script of
yours can fetch. `charts.sources` in the settings file maps a base address
to a command:

```json
"charts.sources": {
  "https://grafana.acme.com": "~/bin/grafana-chart",
  "https://metrics.acme.com/api": "acme-metrics chart"
}
```

A chart's `link:` belongs to the longest base that it starts with, up to a
`/`, `?`, or `#`. A `grafana:` link that a source covers reads through the
source too, instead of with a token in Settings → Grafana. Med runs the
command with `/bin/sh` as you, in your home folder, with your shell's
environment, so it can use your own sign-in, such as a command that prints a
signed token. The link reaches the command only in its environment, never
in its text:

| Variable         | What it holds                                                                   |
| ---------------- | ------------------------------------------------------------------------------- |
| `MED_CHART_LINK` | the chart's link                                                                |
| `MED_CHART_FROM` | the range's start, in milliseconds since 1970, when the chart or link names one |
| `MED_CHART_TO`   | the range's end, likewise                                                       |
| `MED_CHART_AT`   | when the reply was written, or now for a live chart                             |
| `MED_CHART_LIVE` | `1` for a chart with `live: yes`                                                |

The command prints the chart's data in one of two ways:

- rows of CSV or JSON, as a `file:` chart takes them: a time, then a column
  a line; or a label and a number a bar.
- a JSON chart: `series` (each a `name` and `points`, `[time, value]`
  pairs) or `bars` (each a `label` and a `value`), and optionally `title`,
  `unit`, `scale` (`"log"`), `threshold` (`value` and `label`), `marks`
  (each `at` and `label`), `link` (where the data can be seen), and `notes`
  (what the chart leaves out). Times are seconds or milliseconds since 1970.

A command that exits with an error shows the last line it wrote to standard
error in the chart, such as `token expired: sign in again`. A command has
60 seconds and 8 MB. Med keeps what it read for each link, range, and
command, so a chart draws the same each time; **Refresh** runs the command
again, and a live chart runs it each minute while it shows.

To try a source, run its command as Med would:

```sh
MED_CHART_LINK='https://grafana.acme.com/d/abc?viewPanel=4' ~/bin/grafana-chart
```

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
| `comments.sendNow`      | `true` or `false`: a new comment goes to the agent at once | `true`           |
| `sources.pullBase`      | `true` or `false`: pull each repository's base branch      | `true`           |
| `openIn.hosts`          | a host's kind by host: `"github"`, `"gitlab"`, or `"off"`  | `{}`             |
| `openIn.sourcegraph`    | your Sourcegraph's address, or `""` for none               | `""`             |
| `openIn.editors`        | the editors to list, in order, such as `["vscode", "zed"]` | each one found   |
| `openIn.links`          | other links by name, each a template                       | `{}`             |
| `grafana.sites`         | the Grafanas that charts read, by address                  | `[]`             |
| `grafana.keychain`      | the Keychain item that holds a Grafana's token, by address | `{}`             |
| `charts.sources`        | the command that prints a chart link's data, by base       | `{}`             |

A key that Med does not know, or a value that its key does not take, changes
nothing.
