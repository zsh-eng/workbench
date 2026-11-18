import { expect, test } from "vitest";
import {
  dashboardPath,
  inputValues,
  panelChartText,
  panelTitle,
  panelWidth,
  substitute,
  valuesOfSearch,
  type Dashboard,
} from "../../src/shared/dashboards";
import { statOf, tableOf } from "../../src/web/components/chart/chart-summary";

const dashboard: Pick<Dashboard, "inputs" | "range"> = {
  range: "now-6h",
  inputs: [
    { name: "service", label: "Service", type: "text", default: "checkout", pattern: "[a-z-]+" },
    { name: "env", label: "env", type: "choice", default: "prod", options: ["prod", "staging"] },
  ],
};

test("an input takes the value given when it is allowed, else its default; the range gives from and to", () => {
  expect(inputValues(dashboard, {})).toEqual({
    values: { service: "checkout", env: "prod", from: "now-6h", to: "now" },
    problems: [],
    range: { from: "now-6h", to: "now" },
  });
  expect(
    inputValues(dashboard, { service: "payments", env: "staging", from: "now-24h", to: "now" })
      .values,
  ).toEqual({ service: "payments", env: "staging", from: "now-24h", to: "now" });
  // Words, as `med dashboard --range` and the Superagent give them.
  expect(inputValues(dashboard, { range: "yesterday" }).range).toEqual({
    from: "now-1d/d",
    to: "now-1d/d",
  });
  // A moment reaches the panels as an ISO time; the page keeps it as Grafana does.
  const moments = inputValues(dashboard, { from: "1763290800000", to: "1763294400000" });
  expect(moments.range).toEqual({ from: "1763290800000", to: "1763294400000" });
  expect(moments.values).toMatchObject({
    from: "2025-11-16T11:00:00.000Z",
    to: "2025-11-16T12:00:00.000Z",
  });
  const wrong = inputValues(dashboard, {
    service: "Pay Ments",
    env: "dev",
    from: "now",
    to: "now-1h",
  });
  expect(wrong.values).toEqual({ service: "checkout", env: "prod", from: "now-6h", to: "now" });
  expect(wrong.problems).toEqual([
    'service must match [a-z-]+, not "Pay Ments".',
    'env takes one of prod, staging, not "dev".',
    "The range runs from a time to a later one, as now-6h to now, not now to now-1h.",
  ]);
  expect(inputValues(dashboard, { range: "whenever" }).problems).toEqual([
    'Med does not read "whenever" as a range. Try 6h, yesterday, since 9:00, Nov 14 to Nov 16, or now-7d.',
  ]);
});

test("an address holds the inputs as var-<name>, and the range and view as Grafana's do", () => {
  const path = dashboardPath("personal/service health", {
    service: "checkout",
    from: "now-6h",
    to: "now",
    view: "Endpoints",
  });
  expect(path).toBe(
    "/dashboards/personal/service%20health?var-service=checkout&from=now-6h&to=now&view=Endpoints",
  );
  expect(valuesOfSearch(path.slice(path.indexOf("?")))).toEqual({
    service: "checkout",
    from: "now-6h",
    to: "now",
    view: "Endpoints",
  });
});

test("${name} becomes the input's value in a panel's keys and rows; a name that is no input stays and is named", () => {
  expect(substitute("q?s=${service}&e=${ env }&x=${nope}", { service: "a", env: "b" })).toEqual({
    text: "q?s=a&e=b&x=${nope}",
    unknown: ["nope"],
  });
  const chart = panelChartText(
    {
      kind: "chart",
      width: 6,
      keys: [
        ["link", "https://status.acme.dev/${service}?from=${from}"],
        ["title", "${service} p99"],
        ["metric", "latency"],
      ],
      rows: undefined,
    },
    { service: "checkout", from: "now-6h" },
    true,
  );
  expect(chart).toEqual({
    text: "link: https://status.acme.dev/checkout?from=now-6h\ntitle: checkout p99\nmetric: latency\nlive: yes",
    unknown: [],
  });
  // A panel's own live: wins over the dashboard's.
  expect(
    panelChartText(
      {
        kind: "chart",
        width: 12,
        keys: [
          ["rows", "x"],
          ["live", "no"],
        ],
        rows: "a,b\n${y},1",
      },
      {},
      true,
    ),
  ).toEqual({ text: "rows: x\nlive: no\n\na,b\n${y},1", unknown: ["y"] });
});

test("a width is a word, a fraction, or columns of twelve", () => {
  expect(
    ["full", "half", "third", "quarter", "two-thirds", "1/2", 5, "wide", 13].map(panelWidth),
  ).toEqual([12, 6, 4, 3, 8, 6, 5, null, null]);
});

test("a text panel goes by its first line as it reads, cut at a word", () => {
  const title = (text: string) => panelTitle({ kind: "text", width: 3, text });
  expect(title("## **Owner**: [payments](https://acme.dev/team)\nmore")).toBe("Owner: payments");
  expect(title("On call: a p99 over 500 ms or 5xx over 1% for five minutes pages the team.")).toBe(
    "On call: a p99 over 500 ms or 5xx over 1% for five minutes…",
  );
});

test("a stat is the first line's last value and its change; a table keeps the rows, with times and numbers told apart", () => {
  const stat = statOf({
    kind: "line",
    series: [
      {
        name: "req/s",
        points: [
          [1, 400],
          [2, null],
          [3, 500],
        ],
      },
    ],
  });
  expect(stat).toEqual({ value: 500, label: "req/s", change: 0.25, points: [400, null, 500] });
  expect(
    statOf(
      {
        kind: "bars",
        bars: [
          { label: "a", value: 2 },
          { label: "b", value: 3 },
        ],
      },
      "sum",
    ),
  ).toEqual({ value: 5, change: null, points: [] });
  expect(tableOf("time,endpoint,p99\n1763290800000,/cart,180\n1763290860000,/pay,1,200")).toEqual({
    columns: ["time", "endpoint", "p99"],
    rows: [
      ["1763290800000", "/cart", "180"],
      ["1763290860000", "/pay", "1", "200"],
    ],
    numeric: [false, false, true],
    times: [true, false, false],
  });
  expect(tableOf('[{"version":"19.1.0","published":"2025-03-28"}]')).toMatchObject({
    columns: ["version", "published"],
    times: [false, true],
  });
});
