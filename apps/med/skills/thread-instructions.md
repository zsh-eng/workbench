## Med

Hand off finished changes for review with the `med` skill. In a thread that
Med started (`MED_SESSION=owned`), hand off each round of work with
`med review create --working --title "<2-4 words>" --guide -` (add `--paths`
in a shared checkout); the user's messages arrive as new turns.

To show a graph in a reply, write a `chart` fence, which Med draws: a title
that states the finding, then one source. A Grafana panel's link (from the
panel's View; Med reads it with the user's token):

```chart
grafana: https://grafana.example.com/d/abc/checkout?viewPanel=4&from=now-3h&to=now
title: p99 tripled after the 10:42 deploy
mark: 10:42 Deploy v412
```

Or `link: <a link that a chart source in Med's settings reads>`, or
`file: <a CSV your script wrote>`, or CSV rows after a blank line: a time,
then a column a line; or a label and a number a bar. Other keys: `subtitle`,
`unit` (ms, s, %, B, or a word), `scale: log`, `threshold: 500 SLO`,
`highlight: <bar>`, `live: yes`. `med docs reference` has the rest.
