import { expect, test } from "vitest";
import {
  cellTime,
  isRamp,
  markTimes,
  parseChartBlock,
  parseCsv,
  rowsData,
  thresholdOf,
} from "../../src/web/components/chart/chart-block";

test("a block's keys, then its data from Grafana", () => {
  expect(
    parseChartBlock(`grafana: https://g.acme.dev/d/abc/checkout?viewPanel=4&from=now-3h&to=now
title: p99 went past 2 s after the deploy
scale: log
live: yes
mark: 10:42 Deploy v412
mark: 2026-11-16 11:05 Rollback
threshold: 500 SLO`),
  ).toEqual({
    source: {
      kind: "grafana",
      link: "https://g.acme.dev/d/abc/checkout?viewPanel=4&from=now-3h&to=now",
      live: true,
    },
    title: "p99 went past 2 s after the deploy",
    scale: "log",
    marks: [
      { at: "10:42", label: "Deploy v412" },
      { at: "2026-11-16 11:05", label: "Rollback" },
    ],
    threshold: { value: 500, label: "SLO" },
  });
  // Any other key sets a variable of the Grafana dashboard.
  expect(
    parseChartBlock(
      "grafana: https://g.acme.dev/d/abc?viewPanel=4\nenv: staging\nfrom: now-1h\nservice: api",
    ),
  ).toMatchObject({
    source: {
      kind: "grafana",
      from: "now-1h",
      vars: { env: "staging", service: "api" },
    },
  });
});

test("rows after the keys are the data; a block names one source", () => {
  const block = parseChartBlock("title: Open times\nunit: ms\n\nversion,ms\nv2,182\nv1,241\n");
  expect(block).toMatchObject({ source: { kind: "rows", text: "version,ms\nv2,182\nv1,241" } });
  expect(parseChartBlock("file: bench/out.csv")).toMatchObject({
    source: { kind: "file", path: "bench/out.csv" },
  });
  expect(parseChartBlock("title: Nothing")).toEqual({
    error: "This chart has no data: add a grafana link, a link, a file, or rows of CSV.",
  });
  expect(parseChartBlock("file: a.csv\n\ntime,x\n2026-01-01,1")).toEqual({
    error: "A chart takes one of a grafana link, a link, a file, or rows of CSV.",
  });
});

test("a link is a chart source's: whether it is live, and its other keys for the source's command", () => {
  expect(
    parseChartBlock(
      [
        "link: https://metrics.acme.dev/q?metric=latency",
        "from: now-1h",
        "title: p99",
        "panel-id: 4",
        "query: rate(http_requests_total[5m])",
      ].join("\n"),
    ),
  ).toEqual({
    source: {
      kind: "link",
      link: "https://metrics.acme.dev/q?metric=latency",
      live: false,
      meta: { from: "now-1h", "panel-id": "4", query: "rate(http_requests_total[5m])" },
    },
    title: "p99",
    marks: [],
  });
  // A key goes to the source wherever the link is among the keys.
  expect(parseChartBlock("panel: 4\nlink: https://metrics.acme.dev/q\nlive: yes")).toMatchObject({
    source: { kind: "link", live: true, meta: { panel: "4" } },
  });
  // A link chart has no rows, and elsewhere a key Med does not know starts them.
  expect(parseChartBlock("link: https://a.dev/q\n\ntime,x\n2026-01-01,1")).toEqual({
    error: "A chart takes one of a grafana link, a link, a file, or rows of CSV.",
  });
  expect(parseChartBlock("title: Hosts\nweb: 4\napi: 2")).toMatchObject({
    source: { kind: "rows", text: "web: 4\napi: 2" },
  });
  expect(parseChartBlock("link: https://a.dev/q\ngrafana: https://g.acme.dev/d/abc")).toEqual({
    error: "A chart takes one of a grafana link, a link, a file, or rows of CSV.",
  });
});

test("CSV keeps quoted commas and quotes, and reads tabs", () => {
  expect(parseCsv('name,value\n"p99, ""tail""",3\n\nb,4')).toEqual([
    ["name", "value"],
    ['p99, "tail"', "3"],
    ["b", "4"],
  ]);
  expect(parseCsv("a\tb\n1\t2")).toEqual([
    ["a", "b"],
    ["1", "2"],
  ]);
});

test("times in cells: dates, date-times, and seconds or milliseconds", () => {
  expect(cellTime("2026-11-16T09:00:00Z")).toBe(Date.UTC(2026, 10, 16, 9));
  expect(cellTime("2026-11-16 09:00")).toBe(new Date(2026, 10, 16, 9).getTime());
  expect(cellTime("1763283600")).toBe(1763283600000);
  expect(cellTime("1763283600000")).toBe(1763283600000);
  expect(cellTime("v0.14.5")).toBeNull();
  expect(cellTime("2024")).toBeNull();
});

test("rows with a time column are lines; rows with labels are bars", () => {
  expect(
    rowsData("time,p50,p99\n2026-11-16T09:01:00Z,40,\n2026-11-16T09:00:00Z,38,240", {}),
  ).toEqual({
    kind: "line",
    series: [
      {
        name: "p50",
        points: [
          [Date.UTC(2026, 10, 16, 9), 38],
          [Date.UTC(2026, 10, 16, 9, 1), 40],
        ],
      },
      {
        name: "p99",
        points: [
          [Date.UTC(2026, 10, 16, 9), 240],
          [Date.UTC(2026, 10, 16, 9, 1), null],
        ],
      },
    ],
  });
  expect(rowsData('version,ms\nv0.14.5,182\nv0.14.4,"1,241"', { highlight: "v0.14.5" })).toEqual({
    kind: "bars",
    bars: [
      { label: "v0.14.5", value: 182, highlight: true },
      { label: "v0.14.4", value: 1241 },
    ],
  });
  expect(rowsData('[{"time": 1763283600, "rps": 12}]', {})).toMatchObject({
    kind: "line",
    series: [{ name: "rps", points: [[1763283600000, 12]] }],
  });
  expect(rowsData("label,value\nv1,9", { type: "line" })).toEqual({
    kind: "error",
    error: "Each row of a line chart starts with a time.",
  });
  expect(rowsData("time", {})).toEqual({ kind: "error", error: "The rows hold no data." });
});

test("a mark at a clock time falls on the range's day, or the day before", () => {
  const range = [
    new Date(2026, 10, 15, 20).getTime(),
    new Date(2026, 10, 16, 8).getTime(),
  ] as const;
  expect(
    markTimes(
      [
        { at: "22:30", label: "Batch" },
        { at: "07:15", label: "Deploy" },
        { at: "12:00", label: "Outside" },
        { at: "soon", label: "Not a time" },
      ],
      range,
    ),
  ).toEqual([
    { at: new Date(2026, 10, 15, 22, 30).getTime(), label: "Batch" },
    { at: new Date(2026, 10, 16, 7, 15).getTime(), label: "Deploy" },
  ]);
});

test("a threshold names its value, and percentiles share a hue", () => {
  const block = parseChartBlock("threshold: 500 SLO\n\nt,x\n2026-01-01,1");
  expect("error" in block ? null : thresholdOf(block, "ms")).toEqual({
    value: 500,
    label: "SLO 500 ms",
  });
  expect(isRamp([{ name: "p50" }, { name: "p99" }])).toBe(true);
  expect(isRamp([{ name: "stripe" }, { name: "adyen" }])).toBe(false);
});
