import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { createDashboards, parseDashboard } from "../../src/host/dashboards";
import type { LinkRequest } from "../../src/host/chart-sources";
import type { LinkChart } from "../../src/shared/charts";
import type { RegisteredRepository } from "../../src/shared/protocol";

let folder: string;
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "med-dashboards-"));
});
afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
});

const CHECKOUT = `title: Checkout health
description: As on-call reads it.
range: now-6h
live: true
inputs:
  service: { type: text, default: checkout, pattern: "[a-z-]+" }
  env: [prod, staging]
  owner: payments-team
views:
  - name: Overview
    panels:
      - link: https://status.acme.dev/\${service}?env=\${env}&from=\${from}
        metric: requests
        type: stat
        title: Requests
      - link: https://status.acme.dev/\${service}?env=\${env}
        metric: latency
        width: two-thirds
        threshold: { value: 500, label: SLO }
        marks: ["10:42 Deploy v412"]
      - text: "**Owner**: \${owner}"
        width: third
  - name: Endpoints
    panels:
      - link: https://status.acme.dev/\${service}
        metric: endpoints
        type: table
        title: Endpoints
`;

test("a dashboard file reads as its title, inputs, and views of panels, each a chart block's keys", () => {
  const { dashboard, problems } = parseDashboard(CHECKOUT);
  expect(problems).toEqual([]);
  expect(dashboard).toMatchObject({
    title: "Checkout health",
    description: "As on-call reads it.",
    range: "now-6h",
    live: true,
    inputs: [
      { name: "service", type: "text", default: "checkout", pattern: "[a-z-]+" },
      { name: "env", type: "choice", default: "prod", options: ["prod", "staging"] },
      { name: "owner", type: "text", default: "payments-team" },
    ],
  });
  const [overview, endpoints] = dashboard!.views;
  expect(overview!.panels).toEqual([
    {
      kind: "chart",
      width: 3,
      line: 12,
      keys: [
        ["link", "https://status.acme.dev/${service}?env=${env}&from=${from}"],
        ["metric", "requests"],
        ["type", "stat"],
        ["title", "Requests"],
      ],
    },
    {
      kind: "chart",
      width: 8,
      line: 16,
      keys: [
        ["link", "https://status.acme.dev/${service}?env=${env}"],
        ["metric", "latency"],
        ["threshold", "500 SLO"],
        ["mark", "10:42 Deploy v412"],
      ],
    },
    { kind: "text", width: 4, line: 21, text: "**Owner**: ${owner}" },
  ]);
  expect(endpoints!.panels[0]).toMatchObject({ kind: "chart", width: 12 });
  // One view's panels can sit at the top.
  expect(parseDashboard("panels:\n  - rows: 'a,1'\n", "notes").dashboard).toMatchObject({
    title: "notes",
    views: [{ name: "notes", panels: [{ kind: "chart", rows: "a,1" }] }],
  });
});

test("what is wrong in a file is said with its line, and what is right still draws", () => {
  const { dashboard, problems } = parseDashboard(`title: Broken
range: yesterday
colour: blue
inputs:
  from: x
  env: { type: choice }
panels:
  - link: https://a.dev/q
    width: wide
    type: pie
  - title: No data
  - link: https://a.dev/q
    rows: "a,1"
`);
  expect(problems).toEqual([
    { line: 3, message: expect.stringContaining("Med does not know the key colour") },
    { line: 2, message: expect.stringContaining("range is the time picker's first value") },
    { line: 5, message: "from is Med's own name; call the input something else." },
    { line: 6, message: "env is a choice: give it options." },
    { line: 9, message: expect.stringContaining("width is full, three-quarters") },
    { line: 10, message: "type is line, bars, stat, or table: not pie." },
    { line: 11, message: "A panel needs a link, a grafana link, a file, rows, or text." },
    { line: 12, message: "A panel takes one of link and rows." },
  ]);
  expect(dashboard!.views[0]!.panels).toHaveLength(3);
  expect(parseDashboard("title: [unclosed").problems[0]).toMatchObject({ line: 1 });
});

function git(cwd: string, ...args: string[]) {
  execFileSync("git", args, { cwd, env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" } });
}

test("Med finds dashboards in its folder and in its repositories, and checks one through the chart sources", async () => {
  const personal = join(folder, "dashboards");
  const repo = join(folder, "shop");
  await mkdir(join(personal, "team"), { recursive: true });
  await mkdir(join(repo, "ops"), { recursive: true });
  await writeFile(join(personal, "team", "checkout.dashboard.yaml"), CHECKOUT);
  await writeFile(join(personal, "notes.yaml"), "title: not a dashboard\n");
  await writeFile(join(repo, "ops", "shop.dashboard.yaml"), "title: [unclosed");
  git(repo, "init", "-q");
  const asked: LinkRequest[] = [];
  const dashboards = createDashboards({
    folder: personal,
    repositories: () => [{ name: "shop", path: repo } as RegisteredRepository],
    sources: async () => ({ "https://status.acme.dev": "status-chart" }),
    async readLink(input): Promise<LinkChart> {
      asked.push(input);
      const metric = input.meta?.metric;
      if (metric === "requests")
        return {
          source: "https://status.acme.dev",
          rows: "time,req/s\n1763290800,400\n1763290860,500",
          live: true,
          fetched: 1,
        };
      if (metric === "latency")
        return {
          source: "https://status.acme.dev",
          chart: {
            unit: "ms",
            notes: ["Sampled each minute."],
            series: [
              {
                name: "p99",
                points: [
                  [1763290800000, 180],
                  [1763290860000, null],
                ],
              },
            ],
          },
          live: true,
          fetched: 1,
        };
      throw new Error("The chart source failed (3): token expired");
    },
    readGrafana: async () => {
      throw new Error("no Grafana here");
    },
    now: () => Date.UTC(2026, 10, 17, 12, 0, 30),
  });
  const { dashboards: found } = await dashboards.list();
  expect(
    found.map(({ id, title, where, panels, problem }) => ({ id, title, where, panels, problem })),
  ).toEqual([
    {
      id: "personal/team/checkout",
      title: "Checkout health",
      where: "Personal",
      panels: 4,
      problem: undefined,
    },
    {
      id: "shop/ops/shop",
      title: "shop",
      where: "shop",
      panels: 0,
      problem: expect.stringMatching(/^Line 1: /),
    },
  ]);
  const read = await dashboards.read("personal/team/checkout");
  expect(read.dashboard?.title).toBe("Checkout health");

  const check = await dashboards.check({
    id: "personal/team/checkout",
    values: { env: "staging" },
  });
  expect(check.values).toEqual({
    service: "checkout",
    env: "staging",
    owner: "payments-team",
    from: "now-6h",
    to: "now",
  });
  expect(check.panels).toEqual([
    expect.objectContaining({
      view: "Overview",
      index: 1,
      title: "Requests",
      type: "stat",
      status: "ok",
      from: "https://status.acme.dev",
      summary: "500 (req/s), +25.0% over the range",
    }),
    expect.objectContaining({
      index: 2,
      status: "ok",
      summary: expect.stringContaining("1 line, 2 points"),
      // What the source says about its data is a note, not a warning.
      notes: ["Sampled each minute."],
      warnings: [],
    }),
    expect.objectContaining({ index: 3, type: "text", status: "text" }),
    expect.objectContaining({
      view: "Endpoints",
      status: "error",
      error: "The chart source failed (3): token expired",
    }),
  ]);
  // Every source ran again, as of one minute, with the inputs' values.
  expect(asked[0]).toEqual({
    link: "https://status.acme.dev/checkout?env=staging&from=now-6h",
    at: Date.UTC(2026, 10, 17, 12, 0),
    live: true,
    meta: { metric: "requests" },
    refresh: true,
  });
  // A file that Med does not list yet checks by its path.
  const loose = join(folder, "loose.dashboard.yaml");
  await writeFile(loose, "panels:\n  - rows: |\n      label,value\n      a,1\n    type: bars\n");
  expect((await dashboards.check({ path: loose })).panels[0]).toMatchObject({
    status: "ok",
    summary: "1 bar: a 1",
  });
  await expect(dashboards.check({ id: "personal/nope" })).rejects.toMatchObject({
    code: "dashboard-missing",
  });
});
