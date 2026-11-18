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
views:
  - name: Overview
    panels:
      - link: https://status.acme.dev/${service}?env=${env}&from=${from}&to=${to}
        metric: requests
        type: stat
        title: Requests
        unit: req/s
        width: quarter
      - link: https://status.acme.dev/${service}?env=${env}&from=${from}&to=${to}
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
      - link: https://status.acme.dev/${service}?env=${env}
        metric: endpoints
        type: table
        title: Slowest endpoints
```

### The file

| Key           | What it holds                                                                                                                                 |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `title`       | The page's title. The file's name if none.                                                                                                    |
| `description` | A line under the title.                                                                                                                       |
| `range`       | Shows the time picker, starting at this range: `now-6h`, `today`, `last 7 days`, `now-7d to now-1d`. Panels read it as `${from}` and `${to}`. |
| `live`        | `true`: every chart reads again each minute while the page shows. A panel's own `live:` wins.                                                 |
| `inputs`      | Values the reader picks, by name.                                                                                                             |
| `views`       | Tabs, each a `name` and its `panels`. One view can be `panels:` at the top instead.                                                           |

**Inputs.** `type: text` is a field and `type: choice` a menu of `options`.
A text input may have a `pattern` its values match. Short forms: a value
(`service: checkout`) is a text input with that default, and a list
(`env: [prod, staging]`) is a choice. `label` names it on the page. `${name}`
in any panel key, or in a text panel, becomes the input's value. A choice of
more than two options has a search field. The values live in the page's
address (`?var-service=payments&from=now-24h&to=now&view=Endpoints`), so a
link opens the same dashboard, and **Back** undoes a change.

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
  `metric: latency` does above.
- `text:` makes a Markdown panel instead: notes, links, what a number means.

Every panel reads as of the same minute, so the panels agree; **Read every
panel again** reads them all now. The page reads four panels at a time: a
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

Times are your computer's; the panel's foot names the zone. Words stay
relative: a link to "Yesterday" opens the day before whenever it opens.
**Drag across a chart's time** to zoom the whole dashboard to it; Back zooms
out again. A panel reads a fixed time as an ISO time in `${from}` and
`${to}`, and a relative one as Grafana writes it (`now-6h`, `now-1d/d`).

### Asking instead of clicking

The bar at the foot of a dashboard sends what you type to the
[Superagent](threads.md#the-superagent), with what the page shows: "staging,
yesterday afternoon", "payments since 9:00", "why did 5xx jump at 14:10?".
The Superagent changes the page in place with `med dashboard open`, or reads
it with `med dashboard check` and answers in words; its answer shows above the
bar, and **Open thread** shows the whole of it. You stay on the page, and Back
undoes what it changed. You can also ask in the Superagent's thread: it knows
the dashboard your window shows, or showed last.

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
keeps the values it does not name. `med dashboard link` prints the link
that opens a dashboard with those values. Without a dashboard named, `check`
reads the one on screen, as you see it.
