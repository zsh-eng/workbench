import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { createChartSources } from "../../src/host/chart-sources";
import { chartSourceFor } from "../../src/shared/charts";

const NOON = new Date(2026, 10, 16, 12, 0).getTime();
let folder: string;
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "med-chart-sources-"));
});
afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
});

/** Chart sources over settings that hold `sources`, with what Med read kept
 * in the test's folder. */
function sourcesWith(sources: Record<string, string>, timeoutMs?: number) {
  return createChartSources({
    settings: { snapshot: async () => ({ settings: { "charts.sources": sources } }) },
    cacheDir: join(folder, "kept"),
    cwd: folder,
    env: () => ({ PATH: process.env.PATH }),
    now: () => NOON,
    ...(timeoutMs ? { timeoutMs } : {}),
  });
}

test("a link belongs to the longest base that it starts with, up to a /, ?, or #", () => {
  const sources = {
    "https://grafana.acme.dev/": "grafana-chart",
    "https://grafana.acme.dev/d/slo": "slo-chart",
    "https://metrics.acme.dev": "metrics-chart",
  };
  expect(chartSourceFor(sources, "https://grafana.acme.dev/d/abc?viewPanel=4")?.command).toBe(
    "grafana-chart",
  );
  expect(chartSourceFor(sources, "https://grafana.acme.dev/d/slo/latency")?.command).toBe(
    "slo-chart",
  );
  expect(chartSourceFor(sources, "https://metrics.acme.dev?q=up")?.command).toBe("metrics-chart");
  // A base is not a prefix of another host's name.
  expect(chartSourceFor(sources, "https://metrics.acme.dev.evil.example/")).toBeUndefined();
  expect(chartSourceFor(sources, "https://grafana.acme.dev/d/slow")?.command).toBe("grafana-chart");
  expect(chartSourceFor({ "https://a.dev": "  " }, "https://a.dev/x")).toBeUndefined();
});

test("a source's command reads the link and its range from its environment, and prints rows", async () => {
  const seen = join(folder, "seen.txt");
  const sources = sourcesWith({
    "https://metrics.acme.dev": `printf '%s\\n%s\\n%s\\n' "$MED_CHART_LINK" "$MED_CHART_FROM" "$MED_CHART_TO" > ${seen}; printf 'time,p99\\n1763290800,120\\n1763294400,180\\n'`,
  });
  const read = await sources.read({
    link: "https://metrics.acme.dev/q?metric=latency&from=now-1h&to=now",
    at: NOON,
  });
  expect(read).toMatchObject({
    source: "https://metrics.acme.dev",
    rows: "time,p99\n1763290800,120\n1763294400,180",
    range: [NOON - 3_600_000, NOON],
    live: false,
    fetched: NOON,
  });
  expect((await readFile(seen, "utf8")).split("\n").slice(0, 3)).toEqual([
    "https://metrics.acme.dev/q?metric=latency&from=now-1h&to=now",
    String(NOON - 3_600_000),
    String(NOON),
  ]);
});

test("a link's text never runs: it reaches the command only through the environment", async () => {
  const sources = sourcesWith({ "https://metrics.acme.dev": `echo '[{"a":"x","b":1}]'` });
  const planted = join(folder, "planted");
  await sources.read({
    link: `https://metrics.acme.dev/q?x=$(touch ${planted})';touch ${planted};'`,
  });
  await expect(readFile(planted)).rejects.toThrow("ENOENT");
});

test("a printed chart keeps its unit, marks, and threshold, with times in seconds read as milliseconds", async () => {
  const chart = {
    title: "Checkout p99",
    unit: "ms",
    threshold: { value: 500, label: "SLO" },
    marks: [{ at: 1763290800, label: "Deploy" }],
    series: [
      {
        name: "p99",
        points: [
          [1763290800, 120],
          [1763294400000, null],
        ],
      },
    ],
    link: "https://grafana.acme.dev/d/abc",
  };
  const file = join(folder, "chart.json");
  await writeFile(file, JSON.stringify(chart));
  const read = await sourcesWith({ "https://metrics.acme.dev": `cat ${file}` }).read({
    link: "https://metrics.acme.dev/latency",
  });
  expect(read.chart).toEqual({
    ...chart,
    marks: [{ at: 1763290800000, label: "Deploy" }],
    series: [
      {
        name: "p99",
        points: [
          [1763290800000, 120],
          [1763294400000, null],
        ],
      },
    ],
  });
  expect(read.range).toBeUndefined();
});

test("Med keeps what a source read, so a chart draws the same; Refresh runs the command again", async () => {
  const count = join(folder, "count");
  const command = `echo run >> ${count}; echo 'label,value'; echo "runs,$(wc -l < ${count} | tr -d ' ')"`;
  const sources = sourcesWith({ "https://metrics.acme.dev": command });
  const link = "https://metrics.acme.dev/runs";
  expect((await sources.read({ link })).rows).toBe("label,value\nruns,1");
  expect((await sources.read({ link })).rows).toBe("label,value\nruns,1");
  // A new Med reads what the last one kept, and runs nothing; a changed
  // command reads again.
  expect((await sourcesWith({ "https://metrics.acme.dev": command }).read({ link })).rows).toBe(
    "label,value\nruns,1",
  );
  await expect(
    sourcesWith({ "https://metrics.acme.dev": "exit 1" }).read({ link }),
  ).rejects.toThrow("failed (1)");
  expect((await sources.read({ link, refresh: true })).rows).toBe("label,value\nruns,2");
});

test("a source that fails, prints nothing, or prints a chart without data says why; a link no source covers says what to add", async () => {
  const sources = sourcesWith(
    {
      "https://fails.dev": "echo 'token expired: sign in again' >&2; exit 3",
      "https://quiet.dev": "true",
      "https://odd.dev": `echo '{"title":"No data"}'`,
      "https://slow.dev": "sleep 5",
    },
    300,
  );
  await expect(sources.read({ link: "https://fails.dev/x" })).rejects.toThrow(
    "The chart source failed (3): token expired: sign in again",
  );
  await expect(sources.read({ link: "https://quiet.dev/x" })).rejects.toThrow("printed nothing");
  await expect(sources.read({ link: "https://odd.dev/x" })).rejects.toThrow(
    "A chart has series or bars.",
  );
  await expect(sources.read({ link: "https://slow.dev/x" })).rejects.toThrow("longer than 0 s");
  await expect(sources.read({ link: "https://elsewhere.dev/x" })).rejects.toMatchObject({
    code: "chart-source-missing",
  });
});
