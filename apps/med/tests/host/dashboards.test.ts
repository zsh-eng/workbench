import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { createDashboards, optionsOf, parseDashboard } from "../../src/host/dashboards";
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
      - link: https://status.acme.dev/\${service}
        metric: requests
        type: stat
        title: Requests
      - link: https://status.acme.dev/\${service}
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
        ["link", "https://status.acme.dev/${service}"],
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
        ["link", "https://status.acme.dev/${service}"],
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
range: Nov 14
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
    {
      line: 2,
      message: expect.stringContaining("range is the time picker's first range, relative to now"),
    },
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
  // Every source ran again, as of one minute, with the inputs' values and
  // the range as keys: MED_CHART_ENV, MED_CHART_FROM, and so on.
  expect(asked[0]).toEqual({
    link: "https://status.acme.dev/checkout",
    at: Date.UTC(2026, 10, 17, 12, 0),
    live: true,
    meta: {
      metric: "requests",
      service: "checkout",
      env: "staging",
      owner: "payments-team",
      from: "now-6h",
      to: "now",
    },
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

test("an input's options come from a file or a link, read again each time Med reads the dashboard", async () => {
  const personal = join(folder, "dashboards");
  await mkdir(personal, { recursive: true });
  const teams = join(folder, "teams.txt");
  await writeFile(
    join(personal, "envs.dashboard.yaml"),
    `title: Environments
inputs:
  env: { options: environments.json, default: staging }
  region:
    options: { file: regions.csv, value: code, label: name }
  team: { type: text, options: ${teams} }
  host:
    options: { link: https://inventory.acme.dev/hosts, kind: web }
panels:
  - text: \${env} in \${region}
`,
  );
  await writeFile(join(personal, "environments.json"), '["prod", "staging", "qa"]');
  await writeFile(
    join(personal, "regions.csv"),
    "code,name\nsg,Singapore\nus,United States\nsg,Singapore again\n",
  );
  await writeFile(teams, "# The teams on call\npayments\n\ncheckout\n");
  const asked: LinkRequest[] = [];
  const dashboards = createDashboards({
    folder: personal,
    repositories: () => [],
    sources: async () => ({ "https://inventory.acme.dev": "inventory" }),
    async readLink(input): Promise<LinkChart> {
      asked.push(input);
      return {
        source: "https://inventory.acme.dev",
        rows: "name\nweb-1\nweb-2\n",
        live: true,
        fetched: 1,
      };
    },
    readGrafana: async () => {
      throw new Error("no Grafana here");
    },
  });

  const first = await dashboards.read("personal/envs");
  expect(first.problems).toEqual([]);
  expect(
    first.dashboard!.inputs.map(({ name, type, default: start, options, labels }) => ({
      name,
      type,
      default: start,
      options,
      labels,
    })),
  ).toEqual([
    { name: "env", type: "choice", default: "staging", options: ["prod", "staging", "qa"] },
    {
      name: "region",
      type: "choice",
      default: "sg",
      options: ["sg", "us"],
      labels: { sg: "Singapore", us: "United States" },
    },
    // A text input's options are its suggestions.
    { name: "team", type: "text", default: "", options: ["payments", "checkout"] },
    { name: "host", type: "choice", default: "web-1", options: ["web-1", "web-2"] },
  ]);
  // The link's command gets its keys, as a chart's does, and runs again only
  // after a while, though the page reads the dashboard every few seconds.
  expect(asked).toEqual([
    { link: "https://inventory.acme.dev/hosts", live: true, meta: { kind: "web" } },
  ]);

  // The script that writes the file runs again: the page reads what it wrote.
  await writeFile(join(personal, "environments.json"), '["prod", "qa"]');
  await rm(join(personal, "regions.csv"));
  const second = await dashboards.read("personal/envs");
  expect(asked).toHaveLength(1);
  expect(second.dashboard!.inputs[0]).toMatchObject({ options: ["prod", "qa"], default: "prod" });
  expect(second.problems).toEqual([
    {
      line: 3,
      message: "env's default staging is not in environments.json, so it starts at prod.",
    },
    {
      line: 5,
      message: `region's options from regions.csv: There is no file ${join(personal, "regions.csv")}.`,
    },
  ]);

  // A check reads them as the page does, every link again, and says what
  // each input read; a value that is not an option is a problem, and one for
  // an input whose options could not be read goes.
  const check = await dashboards.check({
    id: "personal/envs",
    values: { env: "staging", region: "eu" },
  });
  expect(asked.at(-1)).toMatchObject({ refresh: true });
  expect(check.values).toMatchObject({ env: "prod", region: "eu" });
  expect(check.problems.at(-1)).toEqual({
    message: 'env takes one of prod, qa, not "staging".',
  });
  expect(check.options).toEqual([
    { name: "env", from: "environments.json", options: ["prod", "qa"] },
    { name: "team", from: teams, options: ["payments", "checkout"] },
    { name: "host", from: "https://inventory.acme.dev/hosts", options: ["web-1", "web-2"] },
  ]);
});

test("an input's options read as JSON lists and maps, CSV and TSV, or a value a line", () => {
  expect(optionsOf('[{"id": "a", "title": "A"}, {"id": "b"}, "c"]', { label: "title" })).toEqual({
    options: ["a", "b", "c"],
    labels: { a: "A" },
    cut: false,
  });
  expect(optionsOf('{"prod": {"title": "Production"}, "qa": {}}', { label: "title" })).toEqual({
    options: ["prod", "qa"],
    labels: { prod: "Production" },
    cut: false,
  });
  expect(optionsOf("env\tregion\nprod\tsg\nqa\tus", { value: "Region" })).toMatchObject({
    options: ["sg", "us"],
  });
  expect(optionsOf("env,region\nprod,sg", { value: "zone" })).toEqual({
    error: "It has no column zone; its columns are env, region.",
  });
  expect(optionsOf('[{"id": "a"}]', { value: "name" })).toEqual({
    error: "No item has a field name.",
  });
  expect(optionsOf("prod", {}, "json")).toEqual({ error: "Its JSON does not parse." });
  expect(optionsOf("\n# none yet\n", {})).toEqual({ error: "It holds no options." });

  const { dashboard, problems } = parseDashboard(`inputs:
  a: { options: { file: a.csv, link: https://a.dev/q } }
  b: { options: { value: name } }
  c: { options: { file: c.json, kind: web } }
  d: { options: 3 }
panels:
  - text: Inputs
`);
  expect(problems).toEqual([
    { line: 2, message: "a's options come from a file or a link, not both." },
    { line: 3, message: "b's options need a file or a link to read them from." },
    { line: 4, message: "c's options from a file take value and label, not kind." },
    { line: 5, message: expect.stringContaining("d's options are a list, a file or a link") },
  ]);
  expect(dashboard!.inputs).toEqual([]);
});
