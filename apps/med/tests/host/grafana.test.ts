import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import {
  createGrafana,
  createGrafanaSettings,
  createGrafanaTokens,
  framesToSeries,
  grafanaAddress,
  grafanaTime,
  interpolate,
  parsePanelLink,
  variableChoices,
} from "../../src/host/grafana";
import { createSettingsFile } from "../../src/host/settings-file";
import { FAKE_TOKEN, startFakeGrafana, type FakeGrafana } from "../fixtures/fake-grafana";

const NOON = new Date(2026, 10, 16, 12, 0).getTime();
let folder: string;
let fake: FakeGrafana;
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "med-grafana-"));
  // Its deploy and rollback fall in the hour before noon.
  fake = await startFakeGrafana({ base: "/grafana", anchor: NOON - 3_600_000 });
});
afterEach(async () => {
  await fake.close();
  await rm(folder, { recursive: true, force: true });
});

async function setUp(token = FAKE_TOKEN) {
  const tokens = createGrafanaTokens(join(folder, "grafana-tokens.json"));
  await tokens.set(fake.address, token);
  const grafana = createGrafana({
    sites: async () => [fake.address],
    token: async (address) => (await tokens.read())[address],
    cacheDir: join(folder, "charts"),
    now: () => NOON,
  });
  return { grafana, tokens };
}

test("an address keeps Grafana's path and drops a dashboard's", () => {
  expect(grafanaAddress("https://grafana.acme.dev/")).toBe("https://grafana.acme.dev");
  expect(grafanaAddress("https://acme.dev/grafana/d/abc/checkout?viewPanel=4")).toBe(
    "https://acme.dev/grafana",
  );
  expect(grafanaAddress("ftp://grafana.acme.dev")).toBeNull();
  expect(grafanaAddress("https://user:pass@grafana.acme.dev")).toBeNull();
  expect(grafanaAddress("grafana")).toBeNull();
});

test("a panel's link gives its Grafana, dashboard, panel, range, and variables", () => {
  const link = parsePanelLink(
    "https://acme.dev/grafana/d/checkout/checkout?orgId=1&viewPanel=panel-4&from=now-3h&to=now&var-env=prod&var-env=staging",
    ["https://acme.dev/grafana", "https://acme.dev"],
  );
  expect(link).toMatchObject({
    site: "https://acme.dev/grafana",
    uid: "checkout",
    panel: 4,
    from: "now-3h",
    to: "now",
  });
  expect(link.vars.get("env")).toEqual(["prod", "staging"]);
  expect(parsePanelLink("https://g.dev/d-solo/x/y?panelId=7", ["https://g.dev"]).panel).toBe(7);
  expect(() => parsePanelLink("https://other.dev/d/x?viewPanel=1", ["https://g.dev"])).toThrow(
    "Add https://other.dev in Settings → Grafana",
  );
  expect(() => parsePanelLink("https://g.dev/d/x/y", ["https://g.dev"])).toThrow(
    "The link names no panel",
  );
  expect(() => parsePanelLink("https://g.dev/explore?left=x", ["https://g.dev"])).toThrow(
    "not a dashboard's",
  );
});

test("times read as Grafana writes them, relative to a given now", () => {
  expect(grafanaTime("now", NOON)).toBe(NOON);
  expect(grafanaTime("now-6h", NOON)).toBe(NOON - 6 * 3_600_000);
  expect(grafanaTime("now-1d/d", NOON)).toBe(new Date(2026, 10, 15).getTime());
  expect(grafanaTime("now-1d/d", NOON, true)).toBe(new Date(2026, 10, 16).getTime() - 1);
  expect(grafanaTime("now/w", NOON)).toBe(new Date(2026, 10, 16).getTime());
  expect(grafanaTime("1763254800000", NOON)).toBe(1763254800000);
  expect(grafanaTime("1763254800", NOON)).toBe(1763254800000);
  expect(grafanaTime("2026-11-16T04:00:00.000Z", NOON)).toBe(Date.UTC(2026, 10, 16, 4));
  expect(grafanaTime("now-6x", NOON)).toBeNull();
});

test("variables fill a query as Grafana fills it, leaving Grafana's own", () => {
  const choices = variableChoices(
    [
      { name: "env", current: { value: "prod" } },
      { name: "pod", current: { value: ["a.1", "b"] } },
      {
        name: "region",
        current: { value: "$__all" },
        options: [{ value: "$__all" }, { value: "eu" }, { value: "us" }],
      },
      { name: "job", current: { value: "$__all" }, allValue: ".+" },
    ],
    new Map([["env", ["staging"]]]),
  );
  expect(interpolate('up{env="$env"}[$__rate_interval]', choices, "prometheus")).toBe(
    'up{env="staging"}[$__rate_interval]',
  );
  expect(interpolate('pod=~"$pod"', choices, "prometheus")).toBe('pod=~"(a\\.1|b)"');
  expect(interpolate("${pod:csv} [[env]] ${region}", choices, "influxdb")).toBe(
    "a.1,b staging {eu,us}",
  );
  expect(interpolate("$job $unknown", choices, "prometheus")).toBe(".+ $unknown");
});

test("data frames become series, named as Grafana's legend names them", () => {
  const series = framesToSeries(
    [
      {
        schema: {
          refId: "A",
          fields: [
            { name: "Time", type: "time" },
            { name: "Value", type: "number", labels: { quantile: "0.99" } },
            { name: "Value", type: "number", config: { displayNameFromDS: "p50" } },
          ],
        },
        data: {
          values: [
            [2000, 1000],
            [0.2, null],
            [0.05, 0.04],
          ],
        },
      },
      {
        schema: {
          refId: "B",
          fields: [
            { name: "time", type: "time" },
            { name: "errors", type: "number" },
          ],
        },
        data: { values: [[1000], [3]] },
      },
    ],
    {
      factor: 1000,
      overrides: [
        {
          matcher: { id: "byFrameRefID", options: "B" },
          properties: [{ id: "displayName", value: "Errors" }],
        },
      ],
    },
  );
  expect(series).toEqual([
    {
      name: "0.99",
      points: [
        [1000, null],
        [2000, 200],
      ],
    },
    {
      name: "p50",
      points: [
        [1000, 40],
        [2000, 50],
      ],
    },
    { name: "Errors", points: [[1000, 3000]] },
  ]);
});

test("a panel's queries run with the dashboard's variables, over a range from the reply's time", async () => {
  const { grafana } = await setUp();
  const at = NOON - 3_600_000;
  const panel = await grafana.panel({
    link: `${fake.address}/d/checkout/checkout?viewPanel=4&from=now-3h&to=now`,
    at,
  });
  expect(panel).toMatchObject({
    title: "Latency",
    dashboard: "Checkout",
    unit: "ms",
    range: [at - 3 * 3_600_000, at],
    live: false,
    fetched: NOON,
    notes: [],
    threshold: { value: 500, label: "" },
  });
  expect(panel.series.map((entry) => entry.name)).toEqual(["p50", "p95", "p99"]);
  // Seconds became milliseconds.
  expect(panel.series[0]!.points[0]![1]).toBeGreaterThan(20);
  expect(panel.series[0]!.points[0]![1]).toBeLessThan(80);
  // The dashboard's deploy, and this panel's own note; not another panel's.
  expect(panel.marks.map((mark) => mark.label)).toEqual(["Deploy v412", "Rollback to v411"]);
  // The data source variable named a data source, which Grafana knows by uid.
  expect(fake.queries[0]).toMatchObject({ datasource: { uid: "prom" } });
  expect(fake.queries[0]!.expr).toContain('env="prod"');
  expect(fake.queries[0]!.expr).toContain("[$__rate_interval]");
  expect(panel.link).toBe(
    `${fake.address}/d/checkout?viewPanel=4&from=${at - 3 * 3_600_000}&to=${at}`,
  );
  // The block's variables and range win over the link's, as a dashboard's
  // inputs and time picker give them; the link to Grafana shows the same.
  const staging = await grafana.panel({
    link: `${fake.address}/d/checkout/checkout?viewPanel=4&from=now-3h&to=now&var-env=prod`,
    at,
    from: "now-1h",
    to: "now",
    vars: { env: "staging" },
  });
  expect(staging.range).toEqual([at - 3_600_000, at]);
  expect(fake.queries.at(-1)!.expr).toContain('env="staging"');
  expect(staging.link).toBe(
    `${fake.address}/d/checkout?viewPanel=4&from=${at - 3_600_000}&to=${at}&var-env=staging`,
  );
});

test("Med keeps what it read until asked to read Grafana again", async () => {
  const { grafana } = await setUp();
  const link = `${fake.address}/d/checkout/c?viewPanel=6&from=1763254800000&to=1763276400000`;
  const first = await grafana.panel({ link });
  expect(first.unit).toBe("req/s");
  expect(first.series[0]!.name).toBe("checkout-api");
  const asked = fake.queries.length;
  expect(await grafana.panel({ link })).toEqual(first);
  expect(fake.queries.length).toBe(asked);
  await grafana.panel({ link, refresh: true });
  expect(fake.queries.length).toBe(asked + 1);
});

test("a live chart keeps its relative range, and a log panel stays on a log axis", async () => {
  const { grafana } = await setUp();
  const panel = await grafana.panel({
    link: `${fake.address}/d/checkout/c?viewPanel=9&from=now-2h&to=now`,
    at: NOON - 86_400_000,
    live: true,
  });
  expect(panel.live).toBe(true);
  expect(panel.range).toEqual([NOON - 2 * 3_600_000, NOON]);
  expect(panel.scale).toBe("log");
  expect(panel.unit).toBeUndefined();
  expect(panel.link).toContain("from=now-2h&to=now");
});

test("Grafana's refusals read as what to do", async () => {
  const { grafana } = await setUp();
  await expect(grafana.panel({ link: `${fake.address}/d/payments/p?viewPanel=2` })).rejects.toThrow(
    "Grafana answered 403: Access denied to this dashboard",
  );
  await expect(grafana.panel({ link: `${fake.address}/d/nope/p?viewPanel=2` })).rejects.toThrow(
    "Grafana answered 404: Dashboard not found",
  );
  await expect(
    grafana.panel({ link: `${fake.address}/d/checkout/c?viewPanel=99` }),
  ).rejects.toThrow("“Checkout” has no panel 99.");
  await expect(
    grafana.panel({ link: `${fake.address}/d/checkout/c?viewPanel=12` }),
  ).rejects.toThrow("another panel's query");
  const wrong = await setUp("glsa_wrong");
  await expect(
    wrong.grafana.panel({ link: `${fake.address}/d/checkout/c?viewPanel=4` }),
  ).rejects.toThrow("turned the token down (401)");
});

test("a token is checked with Grafana, and kept where only this user reads it", async () => {
  const { grafana, tokens } = await setUp();
  expect(await grafana.check(fake.address, FAKE_TOKEN)).toEqual({
    version: "11.3.0",
    organization: "Acme",
  });
  await expect(grafana.check(fake.address, "glsa_wrong")).rejects.toThrow("401");
  expect((await stat(tokens.path)).mode & 0o777).toBe(0o600);
  expect(JSON.parse(await readFile(tokens.path, "utf8"))).toEqual({ [fake.address]: FAKE_TOKEN });
  await expect(grafana.check("http://127.0.0.1:9", FAKE_TOKEN)).rejects.toThrow(
    "Med could not reach 127.0.0.1:9",
  );
});

/** Settings → Grafana over a settings file in the test's folder, with a
 * Keychain that holds `items`. */
function settingsWith(items: Record<string, string>) {
  const settings = createSettingsFile(join(folder, "settings.json"));
  const tokens = createGrafanaTokens(join(folder, "grafana-tokens.json"));
  const reads: string[] = [];
  const sites = createGrafanaSettings({
    settings,
    tokens,
    keychain: async (item) => {
      reads.push(item);
      if (items[item]) return `${items[item]}\n`;
      throw new Error(`Your Keychain has no item named ${item}.`);
    },
  });
  const grafana = createGrafana({
    sites: sites.sites,
    token: sites.token,
    cacheDir: join(folder, "charts"),
    now: () => NOON,
  });
  const check = (address: string, token: string) => grafana.check(address, token);
  return { settings, tokens, sites, grafana, check, reads };
}

test("a Grafana's token can stay in the Keychain: Med keeps only the item's name", async () => {
  const { settings, tokens, sites, grafana, check, reads } = settingsWith({
    "grafana-acme": FAKE_TOKEN,
  });
  const answer = await sites.connect({ address: fake.address, keychain: "grafana-acme" }, check);
  expect(answer).toMatchObject({
    organization: "Acme",
    site: { address: fake.address, token: true, keychain: "grafana-acme" },
  });
  const file = (await settings.snapshot()).settings;
  expect(file["grafana.sites"]).toEqual([fake.address]);
  expect(file["grafana.keychain"]).toEqual({ [fake.address]: "grafana-acme" });
  expect(await tokens.read()).toEqual({});
  // A chart reads the panel with the Keychain's token, read once a minute at most.
  const panel = await grafana.panel({ link: `${fake.address}/d/checkout/c?viewPanel=4` });
  expect(panel.series.length).toBeGreaterThan(0);
  expect(reads).toEqual(["grafana-acme"]);

  // A pasted token takes the Keychain's place, and Remove forgets both.
  await sites.connect({ address: fake.address, token: FAKE_TOKEN }, check);
  expect((await settings.snapshot()).settings["grafana.keychain"]).toEqual({});
  expect((await sites.list())[0]).toEqual({ address: fake.address, token: true, hint: "cdef" });
  expect((await sites.remove(fake.address)).sites).toEqual([]);
  expect(await tokens.read()).toEqual({});
});

test("an agent can name the Keychain item in the settings file itself", async () => {
  const { settings, sites, grafana, check } = settingsWith({ "grafana-acme": FAKE_TOKEN });
  await settings.set("grafana.sites", [fake.address]);
  await settings.set("grafana.keychain", { [`${fake.address}/`]: "grafana-acme" });
  expect(await sites.list()).toEqual([
    { address: fake.address, token: true, keychain: "grafana-acme" },
  ]);
  await expect(
    grafana.panel({ link: `${fake.address}/d/checkout/c?viewPanel=4` }),
  ).resolves.toBeTruthy();
  // Connect with neither a token nor an item checks the one Med has.
  await expect(sites.connect({ address: fake.address }, check)).resolves.toMatchObject({
    organization: "Acme",
  });
});

test("connecting says what is wrong: a missing item, a token turned down, or both given", async () => {
  const { sites, check, settings } = settingsWith({ "grafana-wrong": "glsa_wrong" });
  await expect(
    sites.connect({ address: fake.address, keychain: "grafana-none" }, check),
  ).rejects.toThrow("no item named grafana-none");
  await expect(
    sites.connect({ address: fake.address, keychain: "grafana-wrong" }, check),
  ).rejects.toThrow("401");
  await expect(
    sites.connect({ address: fake.address, keychain: "a", token: "b" }, check),
  ).rejects.toThrow("not both");
  await expect(sites.connect({ address: fake.address }, check)).rejects.toThrow(
    "name the Keychain item",
  );
  // Nothing was kept.
  expect((await settings.snapshot()).settings["grafana.sites"]).toBeUndefined();
});
