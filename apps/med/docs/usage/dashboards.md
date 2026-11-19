## Dashboards

A dashboard is like an Obsidian Base: a YAML file that opens as its own page,
with views. Its rows come from [chart sources](settings.md#chart-sources)
instead of notes, and each panel takes a [chart block's](markdown.md#charts)
keys. Med reads what the file says and draws it; your scripts fetch and cache
the data.

Name the file `<name>.dashboard.yaml`. Med finds it in any repository it
knows, and in the `dashboards` folder beside its settings file
(`~/.config/med/dashboards/`) for ones that belong to no repository.
**Dashboards** in the sidebar lists them; the page reads the file again every
few seconds while it shows, so an edit draws as it lands.

```yaml
title: Checkout health
description: The checkout service, as on-call reads it.
range: now-6h # the time picker, and its first range
live: true # every chart reads again each minute
inputs:
  service: { type: text, default: checkout, pattern: "[a-z-]+" }
  env: [prod, staging] # a list is a choice; the first is the default
  region: { options: regions.csv } # options a script keeps up to date
views:
  - name: Overview
    panels:
      - link: https://status.acme.dev/metrics
        metric: requests
        type: stat
        title: Requests
        unit: req/s
        width: quarter
      - link: https://status.acme.dev/metrics
        metric: latency
        title: p99 latency
        unit: ms
        threshold: { value: 500, label: SLO }
        width: half
      - text: |
          Deploys go out at 10:00 and 15:00. **A p99 over 500 ms pages on-call.**
        width: quarter
  - name: Endpoints
    panels:
      - link: https://status.acme.dev/metrics
        metric: endpoints
        type: table
        title: Slowest endpoints
```

### The file

| Key           | What it holds                                                                                                                               |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `title`       | The page's title. The file's name if none.                                                                                                  |
| `description` | A line under the title.                                                                                                                     |
| `range`       | Shows the time picker, starting at this range: `now-6h`, `today`, `last 7 days`, `now-7d to now-1d`. Every Grafana panel and link reads it. |
| `live`        | `true`: every chart reads again each minute while the page shows. A panel's own `live:` wins.                                               |
| `inputs`      | Values the reader picks, by name.                                                                                                           |
| `views`       | Tabs, each a `name` and its `panels`. One view can be `panels:` at the top instead.                                                         |

**Inputs.** `type: text` is a field and `type: choice` a menu of `options`.
A text input may have a `pattern` its values match. Short forms: a value
(`service: checkout`) is a text input with that default, and a list
(`env: [prod, staging]`) is a choice. `label` names it on the page. A choice
of more than two options has a search field. The values live in the page's
address (`?var-service=payments&from=now-24h&to=now&view=Endpoints`), so a
link opens the same dashboard, and **Back** undoes a change.

**Options from a file or a source.** Instead of a list, `options` can name
where to read them, so a list that a script keeps up to date fills the menu:

```yaml
inputs:
  env: { options: environments.json } # a file beside the dashboard
  region:
    options: { file: ~/ops/regions.csv, value: code, label: name }
  host:
    options: { link: https://inventory.acme.dev/hosts, kind: web }
  team: { type: text, options: teams.txt } # suggestions; any value goes
```

- `file:` is a path from the dashboard's folder, from `~`, or from the root.
  Med reads it again each time the page reads the dashboard, every few
  seconds, so the menu shows what the file holds now. A file up to 4 MB, and
  up to 5,000 options.
- `link:` reads through a [chart source](settings.md#chart-sources), as a
  panel's link does: the command prints the options as rows, and the map's
  other keys reach it as `MED_CHART_<KEY>`. Med runs it again after a minute.
  A string that starts with `https://` is a link, and any other string a file.
- What the text holds: a JSON list of values, or of maps; a JSON map, whose
  keys are the options; CSV or TSV under a header row; or a `.txt` file of a
  value a line (blank lines and `#` notes skipped). `value` names the field
  or column with each option's value (the first, when none is named), and
  `label` the one the menu shows instead of the value.
- A choice starts at its `default` when the file has it, and else at the
  file's first option. A text input with options suggests them as you type.
- When Med cannot read the options, the page says why among the file's
  problems, and the input takes any value until it can.
  `med dashboard check` says which options each input read.

**Panels.** A panel is a chart block's keys as YAML, plus `width`:

- One source of data: `link:` (a chart source reads it), `grafana:`, `file:`
  (a path from the dashboard's folder, in a repository), or `rows:` (CSV text,
  or a list of maps).
- `type`: `line`, `bars`, `stat` (one number, its change over the range, and
  its line as a sparkline; `reduce:` picks `last`, `first`, `sum`, `mean`,
  `max`, or `min`), or `table` (the rows as the source printed them, sortable).
- `title`, `subtitle`, `unit`, `scale: log`, `threshold` (`500 SLO`, or
  `{ value: 500, label: SLO }`), `marks` (a list of `10:42 Deploy v412`),
  `highlight`, `live`.
- `width`: `full` (the default), `three-quarters`, `two-thirds`, `half`,
  `third`, or `quarter` (a stat's default); or columns of 12. Panels fill the
  rows left to right. On a narrow window every panel takes the whole row.
- Any other key reaches the chart source's command as `MED_CHART_<KEY>`, as
  `metric: latency` does above, or sets a variable of a `grafana:` panel's
  dashboard (`env: staging`).
- `text:` makes a Markdown panel instead: notes, links, what a number means.

**What a panel reads.** Med passes the range and the inputs to every `link:`
and `grafana:` panel as keys, as an agent's chart passes them: `from` and
`to`, and each input by its name. A chart source's command gets them as
`MED_CHART_FROM`, `MED_CHART_TO`, `MED_CHART_ENV`, beside the link as it is
written. Med is not particular about where your script reads them: a bare
link and the keys, or a full Grafana link with the values in it
(`?var-env=${env}&from=${from}&to=${to}`), both work. `${name}` in any key,
or in a text panel, becomes the input's value.

A `grafana:` panel that Med reads itself takes the keys as its range and its
dashboard's variables, over the link's own. A panel's own key wins over the
dashboard's: `from: now/d` keeps a panel on today whatever the picker shows.
An input named as a key Med draws (`title`, `unit`, `type`, …) reaches a panel
only as `${name}`.

Every panel reads as of the same minute, so the panels agree; **Read every
panel again** reads them all now. The top of the page names where the panels
read from (a link's host, a file) beside that minute, once, so the panels
carry no footer: each is outlined on the page, as tall as the row it shares,
and its tools (Full screen and the menu, or a stat's and a table's Refresh
and Inspect) show beside its title while the pointer is on it. The pointer on a chart's time marks that
moment on every chart of the page, as Grafana's shared crosshair does: the
other charts draw a dashed line there, their legends read their values then,
and each stat shows its value at that moment (`1.37 s at 22:46`). Moving
along a stat's small line moves the moment too. A chart whose time does not
reach that moment, as a panel with its own range, shows nothing. The page reads four panels at a time: a
panel says **Waiting** until its turn, then **Fetching** and, after a few
seconds, for how long. When an input or the range changes, each panel keeps
what it drew, dimmed under a thin bar, until its new data comes. **Inspect
data** in a chart's menu shows its link, the command that read it, what the
command was given, and what it printed.

### The time range

The time picker works like Grafana's. Its button names the range; beside it,
**‹** and **›** move it half its span earlier or later, and **Zoom out**
doubles it. Its panel has:

- A field that reads what you type, and says the moments it means before you
  press Enter: `6h`, `90 days`, `yesterday`, `last week`, `since 9:00`,
  `yesterday 14:00 to 16:30`, `Nov 14 to Nov 16`, `now-7d to now-1d`.
- The ready ranges (Last 5 minutes to Last 12 months; Today, Yesterday, This
  week, Previous month, …), which the field narrows as you type, and the
  ranges you used lately.
- A month to pick a day or a span of days on, with **From** and **To** to set
  the times.

**History**, the clock beside **Read every panel again**, lists the values the dashboard
showed, newest first: each set of inputs and range that a page settled on
for a second, in any Med window. What changed from the set before it is in
bold, and a set that an agent chose (`med dashboard open`, or a link in its
reply) says **Agent**. A row shows those values again, and Back undoes it.
Med keeps the last 30 sets of each dashboard, beside its settings, and
`med dashboard history` prints them.

Times are your computer's; the panel's foot names the zone. Words stay
relative: a link to "Yesterday" opens the day before whenever it opens.
**Drag across a chart's time** to zoom the whole dashboard to it; Back zooms
out again. A panel with its own range zooms only itself. A chart source's
command reads a fixed time as an ISO time, and a relative one as Grafana
writes it (`now-6h`, `now-1d/d`), with `MED_CHART_AT` as now.

### Asking instead of clicking

The bar at the foot of a dashboard sends what you type to the
[Superagent](threads.md#the-superagent), with what the page shows: "staging,
yesterday afternoon", "payments since 9:00", "why did 5xx jump at 14:10?".
The Superagent changes the page in place with `med dashboard open`, or reads
it with `med dashboard check` and answers in words; its answer shows above the
bar, and **Open thread** shows the whole of it. You stay on the page, and Back
undoes what it changed. You can also ask in the Superagent's thread: it knows
the dashboard your window shows, or showed last.

### A dashboard beside a thread

An agent hands over a dashboard with the values it chose: `med dashboard
link` prints a Markdown link, and a reply whose line is only that link shows
it as a card, with the values in words (`prod-sg · Yesterday, 22:00 – 23:30`).
**Open beside** opens the dashboard in a pane beside the conversation, as a
review opens; a link inside a sentence opens there too. The session rail's
**Dashboards** lists each dashboard the thread's replies linked to, newest
first, and while the pane leaves no room for the rail, the pane's header
lists them (**2 in this thread**). **Open as a page** shows it as its own
page.

The pane works as the page does: its inputs, its range, its History, and
the shared cursor. Each change is a step that Back undoes, and Back past the
first closes the pane. The thread keeps the dashboard and its values, so it
is beside the thread again when you come back or reload, and each thread has
its own. While the window shows the thread, its agent's
`med dashboard open` changes the dashboard in the pane in place, and
`med dashboard check` without a dashboard reads what the pane shows.

### Checking a dashboard

An agent can't see the page, so `med dashboard check` reads every panel
through the same chart sources, running each again, and says in words what
each drew:

```sh
med dashboard check dashboards/checkout.dashboard.yaml --set env=staging
```

```text
Checkout health  /…/checkout.dashboard.yaml
Inputs: service=checkout  env=staging  Last 6 hours

Overview
  ✓ 1. Requests (stat, line 13) from https://status.acme.dev, 0.4 s
      212 req/s (rps), +3.1% over the range
  ✓ 2. p99 latency (line, line 19) from https://status.acme.dev, 0.5 s
      3 lines, 361 points, 17 Nov 14:00 – 17 Nov 20:00; p99 last 212 ms, min 180 ms, max 1.9 s
  · 3. Deploys go out at 10:00 and 15:00. (text, line 25)
```

It exits 1 when a panel fails or the file has a problem, with the line of
the file where it is. `--set name=value`, `--range <words>` (as the picker's
field reads them), `--from` and `--to`, and `--view` read it as the page
would with those values; `--json` prints the same as JSON.

`med dashboard` lists the dashboards Med finds, and the one your window shows.
`med dashboard open [<id>]` shows a dashboard in the Med window you used
last, with the values given; without an id it changes the one on screen, and
keeps the values it does not name. An agent in a Med thread shows it beside
its thread while that window shows the thread, and as the page otherwise.
`med dashboard history [<id>]` prints the values that History lists, with
how long ago each showed and which an agent chose. `med dashboard link` prints the link
that opens a dashboard with those values. Without a dashboard named, `check`
reads the one on screen, as you see it.
