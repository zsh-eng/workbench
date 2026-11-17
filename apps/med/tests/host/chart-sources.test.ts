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

test("a source's command reads the link, the reply's time, and the block's other keys from its environment, and prints rows", async () => {
  const seen = join(folder, "seen.txt");
  const sources = sourcesWith({
    "https://metrics.acme.dev": `printf '%s|' "$MED_CHART_LINK" "$MED_CHART_AT" "$MED_CHART_LIVE" "$MED_CHART_FROM" "$MED_CHART_PANEL_ID" > ${seen}; printf 'time,p99\\n1763290800,120\\n1763294400,180\\n'`,
  });
  const yesterday = NOON - 86_400_000;
  // Med reads neither the link nor the keys: the command does.
  const read = await sources.read({
    link: "https://metrics.acme.dev/q?metric=latency&from=now-1h&to=now",
    at: yesterday,
    meta: { from: "now-3h", "panel-id": "4", at: "a key cannot stand in for Med's" },
  });
  expect(read).toEqual({
    source: "https://metrics.acme.dev",
    rows: "time,p99\n1763290800,120\n1763294400,180",
    live: false,
    fetched: NOON,
  });
  expect(await readFile(seen, "utf8")).toBe(
    `https://metrics.acme.dev/q?metric=latency&from=now-1h&to=now|${yesterday}||now-3h|4|`,
  );
  // A live chart's now is the present.
  await sources.read({ link: "https://metrics.acme.dev/q", at: yesterday, live: true });
  expect(await readFile(seen, "utf8")).toBe(`https://metrics.acme.dev/q|${NOON}|1|||`);
});

test("a link's text, and its keys', never run: they reach the command only through the environment", async () => {
  const sources = sourcesWith({ "https://metrics.acme.dev": `echo '[{"a":"x","b":1}]'` });
  const planted = join(folder, "planted");
  await sources.read({
    link: `https://metrics.acme.dev/q?x=$(touch ${planted})';touch ${planted};'`,
    meta: { query: `$(touch ${planted}); touch ${planted}` },
  });
  await expect(readFile(planted)).rejects.toThrow("ENOENT");
});

test("a printed chart keeps its unit, marks, and threshold, with times in seconds read as milliseconds", async () => {
  const chart = {
    title: "Checkout p99",
    range: [1763287200, 1763294400],
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
    range: [1763287200000, 1763294400000],
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
});

test("Med keeps what a source read, so a chart draws the same; another reply's chart, other keys, or Refresh run the command again", async () => {
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
  expect((await sources.read({ link, at: NOON - 60_000 })).rows).toBe("label,value\nruns,2");
  expect((await sources.read({ link, meta: { panel: "4" } })).rows).toBe("label,value\nruns,3");
  expect((await sources.read({ link, refresh: true })).rows).toBe("label,value\nruns,4");
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
