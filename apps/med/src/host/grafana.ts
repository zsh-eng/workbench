import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { GrafanaPanel, GrafanaSite } from "../shared/charts";
import { grafanaTime } from "../shared/grafana-time";
import { HostError } from "./runtime/errors";

export { grafanaTime };

// Grafana panels for the charts in replies. A chart block names a panel by
// its link; Med finds the panel in its dashboard, runs the panel's queries
// over the link's range with the token from Settings, and keeps the answer,
// so the chart shows the same data each time it is read. Grafana's own
// page fills in dashboard variables before it queries, so Med does too.

/** Grafana's address as Med keeps it: scheme, host, and any path below
 * which Grafana is served, with no slash at the end. A dashboard's link
 * gives its Grafana. */
export function grafanaAddress(text: string): string | null {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password)
    return null;
  const path = url.pathname
    .replace(/\/(?:d|d-solo|dashboards|explore|login|alerting|a)(?:\/.*)?$/, "")
    .replace(/\/+$/, "");
  return `${url.origin}${path}`;
}

/** Whether `url` is on the Grafana at `address`. */
function onSite(url: URL, address: string) {
  const site = new URL(address);
  return (
    url.origin === site.origin &&
    `${url.pathname}/`.startsWith(`${site.pathname.replace(/\/$/, "")}/`)
  );
}

export interface PanelLink {
  site: string;
  uid: string;
  panel: number;
  from?: string;
  to?: string;
  /** `var-name` values in the link. */
  vars: Map<string, string[]>;
}

/** A panel's link, such as …/d/uid/slug?viewPanel=4&from=now-6h&to=now. */
export function parsePanelLink(link: string, sites: readonly string[]): PanelLink {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    throw new HostError("invalid-chart", "The chart's grafana line holds no link.", 400);
  }
  const site = sites
    .filter((address) => onSite(url, address))
    .sort((a, b) => b.length - a.length)[0];
  if (!site)
    throw new HostError(
      "grafana-not-set",
      `Add ${url.origin} in Settings → Grafana, with a token, to draw this chart.`,
      404,
    );
  const rest = url.pathname.slice(new URL(site).pathname.replace(/\/$/, "").length);
  const uid = /^\/(?:d|d-solo)\/([^/]+)/.exec(rest)?.[1];
  if (!uid)
    throw new HostError(
      "invalid-chart",
      "The link is not a dashboard's. In Grafana, open the panel with View and copy its address.",
      400,
    );
  const raw =
    url.searchParams.get("viewPanel") ??
    url.searchParams.get("editPanel") ??
    url.searchParams.get("panelId");
  const panel = Number(raw?.replace(/^panel-/, ""));
  if (!raw || !Number.isInteger(panel))
    throw new HostError(
      "invalid-chart",
      "The link names no panel. In Grafana, open the panel with View and copy its address.",
      400,
    );
  const vars = new Map<string, string[]>();
  for (const [key, value] of url.searchParams)
    if (key.startsWith("var-")) vars.set(key.slice(4), [...(vars.get(key.slice(4)) ?? []), value]);
  return {
    site,
    uid: decodeURIComponent(uid),
    panel,
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    vars,
  };
}

interface Variable {
  name?: string;
  type?: string;
  query?: unknown;
  current?: { value?: unknown };
  options?: { value?: unknown }[];
  allValue?: string | null;
}

interface Choice {
  values: string[];
  all: boolean;
  allValue?: string;
  options: string[];
}

const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((entry) => typeof entry === "string")
    : typeof value === "string"
      ? [value]
      : [];

/** Each dashboard variable's value: the link's, else the dashboard's. */
export function variableChoices(variables: readonly Variable[], link: Map<string, string[]>) {
  const choices = new Map<string, Choice>();
  for (const variable of variables) {
    if (!variable.name) continue;
    const saved =
      variable.type === "constant" ? strings(variable.query) : strings(variable.current?.value);
    const values = link.get(variable.name) ?? saved;
    const options = (variable.options ?? [])
      .flatMap((option) => strings(option.value))
      .filter((value) => value !== "$__all");
    choices.set(variable.name, {
      values: values.filter((value) => value !== "$__all"),
      all: values.includes("$__all"),
      ...(variable.allValue ? { allValue: variable.allValue } : {}),
      options,
    });
  }
  return choices;
}

const escapeRegex = (value: string) => value.replace(/[\\^$*+?.()|[\]{}]/g, "\\$&");

function formatChoice(choice: Choice, format: string | undefined, kind: string) {
  if (choice.all && choice.allValue) return choice.allValue;
  const values = choice.all ? choice.options : choice.values;
  const regex = kind === "prometheus" || kind === "loki";
  if (!values.length) return choice.all ? (regex ? ".*" : "*") : "";
  switch (format) {
    case "raw":
    case "csv":
      return values.join(",");
    case "pipe":
      return values.join("|");
    case "json":
      return JSON.stringify(values);
    case "singlequote":
      return values.map((value) => `'${value.replaceAll("'", "\\'")}'`).join(",");
    case "doublequote":
      return values.map((value) => `"${value.replaceAll('"', '\\"')}"`).join(",");
    case "sqlstring":
      return values.map((value) => `'${value.replaceAll("'", "''")}'`).join(",");
    case "regex":
      return values.length === 1
        ? escapeRegex(values[0]!)
        : `(${values.map(escapeRegex).join("|")})`;
    case "glob":
      return values.length === 1 ? values[0]! : `{${values.join(",")}}`;
  }
  if (values.length === 1) return values[0]!;
  return regex ? `(${values.map(escapeRegex).join("|")})` : `{${values.join(",")}}`;
}

// Grafana's own pattern: $name, [[name:format]], ${name:format}.
const VARIABLE = /\$(\w+)|\[\[(\w+?)(?::(\w+))?\]\]|\$\{(\w+)(?:\.([^:^}]+))?(?::([^}]+))?\}/g;

/** Text with the dashboard's variables filled in. Grafana's own `$__…`
 * variables, such as `$__rate_interval`, stay for Grafana to fill. */
export function interpolate(text: string, choices: Map<string, Choice>, kind = "") {
  return text.replace(VARIABLE, (match, plain, bracket, bracketFormat, braced, _path, format) => {
    const name = String(plain ?? bracket ?? braced);
    const choice = choices.get(name);
    if (name.startsWith("__") || !choice) return match;
    return formatChoice(choice, bracketFormat ?? format, kind);
  });
}

function interpolateDeep(value: unknown, choices: Map<string, Choice>, kind: string): unknown {
  if (typeof value === "string") return interpolate(value, choices, kind);
  if (Array.isArray(value)) return value.map((entry) => interpolateDeep(entry, choices, kind));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        key === "datasource" ? entry : interpolateDeep(entry, choices, kind),
      ]),
    );
  return value;
}

/** A Grafana unit in Med's terms, and the factor that converts its values. */
export function grafanaUnit(unit: unknown): { unit?: string; factor: number } {
  switch (unit) {
    case "ms":
      return { unit: "ms", factor: 1 };
    case "s":
      return { unit: "ms", factor: 1000 };
    case "µs":
    case "us":
      return { unit: "ms", factor: 1e-3 };
    case "ns":
      return { unit: "ms", factor: 1e-6 };
    case "percent":
      return { unit: "%", factor: 1 };
    case "percentunit":
      return { unit: "%", factor: 100 };
    case "bytes":
    case "decbytes":
      return { unit: "B", factor: 1 };
    case "reqps":
      return { unit: "req/s", factor: 1 };
    case "ops":
      return { unit: "ops/s", factor: 1 };
    case "rps":
      return { unit: "reads/s", factor: 1 };
    case "wps":
      return { unit: "writes/s", factor: 1 };
    default:
      return { factor: 1 };
  }
}

interface Field {
  name?: string;
  type?: string;
  labels?: Record<string, string>;
  config?: { displayName?: string; displayNameFromDS?: string };
}
interface Frame {
  schema?: { name?: string; refId?: string; fields?: Field[] };
  data?: { values?: unknown[][] };
}
interface Override {
  matcher?: { id?: string; options?: unknown };
  properties?: { id?: string; value?: unknown }[];
}

function labelText(labels: Record<string, string> | undefined) {
  const entries = Object.entries(labels ?? {}).filter(([key]) => key !== "__name__");
  if (entries.length === 1) return entries[0]![1];
  if (!entries.length) return undefined;
  return `${labels?.__name__ ?? ""}{${entries.map(([key, value]) => `${key}="${value}"`).join(", ")}}`;
}

/** A series' name as Grafana's legend shows it, in the common cases. */
function seriesName(
  frame: Frame,
  field: Field,
  template: string | undefined,
  overrides: Override[],
) {
  let name =
    field.config?.displayNameFromDS ??
    field.config?.displayName ??
    (template
      ? template.replace(
          /\$\{__(field|series)\.(name|labels)(?:\.([\w.-]+))?\}/g,
          (_m, of, what, label) =>
            what === "name"
              ? ((of === "series" ? frame.schema?.name : field.name) ?? "")
              : label
                ? (field.labels?.[label] ?? "")
                : (labelText(field.labels) ?? ""),
        )
      : undefined) ??
    labelText(field.labels) ??
    (field.name === "Value" && frame.schema?.name ? frame.schema.name : undefined) ??
    field.name ??
    frame.schema?.refId ??
    "Value";
  for (const override of overrides) {
    const { id, options } = override.matcher ?? {};
    const matches =
      (id === "byName" && (options === name || options === field.name)) ||
      (id === "byFrameRefID" && options === frame.schema?.refId);
    const rename = override.properties?.find((property) => property.id === "displayName")?.value;
    if (matches && typeof rename === "string") name = rename;
  }
  return name;
}

/** The time series in Grafana's data frames, in Med's units. */
export function framesToSeries(
  frames: readonly Frame[],
  options: { factor?: number; template?: string; overrides?: Override[] } = {},
): GrafanaPanel["series"] {
  const factor = options.factor ?? 1;
  const series: GrafanaPanel["series"] = [];
  const seen = new Map<string, number>();
  for (const frame of frames) {
    const fields = frame.schema?.fields ?? [];
    const values = frame.data?.values ?? [];
    const timeIndex = fields.findIndex((field) => field.type === "time");
    if (timeIndex < 0) continue;
    const times = values[timeIndex] ?? [];
    fields.forEach((field, index) => {
      if (field.type !== "number") return;
      const column = values[index] ?? [];
      const points: [number, number | null][] = [];
      for (let row = 0; row < times.length; row++) {
        const time = times[row];
        if (typeof time !== "number" || !Number.isFinite(time)) continue;
        const value = column[row];
        points.push([
          time,
          typeof value === "number" && Number.isFinite(value) ? value * factor : null,
        ]);
      }
      let name = seriesName(frame, field, options.template, options.overrides ?? []);
      const count = (seen.get(name) ?? 0) + 1;
      seen.set(name, count);
      if (count > 1) name = `${name} (${count})`;
      series.push({ name, points: points.sort((a, b) => a[0] - b[0]) });
    });
  }
  return series;
}

/** At most `limit` points in all: a long series keeps every nth point. The
 * chart draws a pixel's worth from the points it gets. */
function thin(series: GrafanaPanel["series"], limit = 60_000) {
  const total = series.reduce((sum, { points }) => sum + points.length, 0);
  if (total <= limit) return series;
  const every = Math.ceil(total / limit);
  return series.map(({ name, points }) => ({
    name,
    points: points.filter((_, index) => index % every === 0 || index === points.length - 1),
  }));
}

/** An annotation's text as a short label: its first line, no HTML. */
function markLabel(text: unknown, tags: unknown) {
  const plain =
    typeof text === "string"
      ? text
          .replace(/<[^>]*>/g, " ")
          .split("\n")[0]!
          .replace(/\s+/g, " ")
          .trim()
      : "";
  const label = plain || strings(tags).join(", ");
  return label.length > 32 ? `${label.slice(0, 31)}…` : label;
}

interface PanelModel {
  id?: number;
  type?: string;
  title?: string;
  datasource?: unknown;
  targets?: Record<string, unknown>[];
  panels?: PanelModel[];
  libraryPanel?: { uid?: string };
  transformations?: unknown[];
  fieldConfig?: {
    defaults?: {
      unit?: string;
      displayName?: string;
      custom?: { scaleDistribution?: { type?: string }; thresholdsStyle?: { mode?: string } };
      thresholds?: { mode?: string; steps?: { value?: number | null }[] };
    };
    overrides?: Override[];
  };
}

function findPanel(panels: readonly PanelModel[] | undefined, id: number): PanelModel | undefined {
  for (const panel of panels ?? []) {
    if (panel.id === id) return panel;
    const nested = findPanel(panel.panels, id);
    if (nested) return nested;
  }
  return undefined;
}

/** The private file that holds each Grafana's token, by address. */
export function createGrafanaTokens(path: string) {
  async function read(): Promise<Record<string, string>> {
    try {
      const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? Object.fromEntries(
            Object.entries(parsed).filter(
              (entry): entry is [string, string] => typeof entry[1] === "string",
            ),
          )
        : {};
    } catch {
      return {};
    }
  }
  let writing: Promise<unknown> = Promise.resolve();
  function change(address: string, token: string | null) {
    const write = writing.then(async () => {
      const tokens = await read();
      if (token === null) delete tokens[address];
      else tokens[address] = token;
      await mkdir(dirname(path), { recursive: true });
      const temporary = `${path}.${randomUUID()}.tmp`;
      // Only this user reads it.
      await writeFile(temporary, `${JSON.stringify(tokens, null, 2)}\n`, { mode: 0o600 });
      await chmod(temporary, 0o600);
      await rename(temporary, path);
    });
    writing = write.catch(() => {});
    return write;
  }
  return { path, read, set: change };
}

const hint = (token: string) => token.slice(-4);

export function siteList(
  addresses: readonly string[],
  tokens: Record<string, string>,
): GrafanaSite[] {
  return addresses.map((address) => ({
    address,
    token: !!tokens[address],
    ...(tokens[address] ? { hint: hint(tokens[address]) } : {}),
  }));
}

/** Why a request to Grafana failed, in words that say what to do. */
function reachFailure(address: string, reason: unknown) {
  const cause = (reason as { cause?: { code?: string; message?: string } })?.cause;
  const code = cause?.code ?? "";
  const host = new URL(address).host;
  if ((reason as Error)?.name === "TimeoutError")
    return new HostError("grafana-unreachable", `${host} did not answer within 20 seconds.`, 502);
  if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY/.test(code))
    return new HostError(
      "grafana-unreachable",
      `Med does not trust ${host}'s certificate. Start Med with NODE_EXTRA_CA_CERTS set to your company's CA file.`,
      502,
    );
  return new HostError(
    "grafana-unreachable",
    `Med could not reach ${host}${cause?.message ? `: ${cause.message}` : "."}`,
    502,
  );
}

export interface GrafanaOptions {
  /** The addresses in Settings. */
  sites(): Promise<string[]>;
  tokens: ReturnType<typeof createGrafanaTokens>;
  /** Where Med keeps what it read; none keeps nothing. */
  cacheDir?: string;
  fetch?: typeof fetch;
  now?(): number;
}

export interface PanelRequest {
  link: string;
  at?: number;
  from?: string;
  to?: string;
  live?: boolean;
  refresh?: boolean;
}

const KEPT = 400;
const LIVE_MS = 15_000;

export function createGrafana(options: GrafanaOptions) {
  const request = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const settingsBySite = new Map<string, { at: number; value: Promise<FrontendSettings> }>();
  const live = new Map<string, { at: number; panel: GrafanaPanel }>();
  const running = new Map<string, Promise<GrafanaPanel>>();

  async function call<T>(
    address: string,
    token: string | undefined,
    path: string,
    signal: AbortSignal | undefined,
    body?: unknown,
  ): Promise<T> {
    let response: Response;
    try {
      response = await request(`${address}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          accept: "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: "manual",
        signal: AbortSignal.any([AbortSignal.timeout(20_000), ...(signal ? [signal] : [])]),
      });
    } catch (reason) {
      if (signal?.aborted) throw reason;
      throw reachFailure(address, reason);
    }
    const host = new URL(address).host;
    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      throw new HostError(
        "grafana-failed",
        response.status >= 300 && response.status < 400
          ? `${host} sent Med to a sign-in page. A sign-in proxy may stand in front of Grafana's API.`
          : `${host} answered ${response.status} with a web page, not Grafana's API. Check the address in Settings → Grafana.`,
        502,
      );
    }
    const message = (parsed as { message?: unknown })?.message;
    const said = typeof message === "string" && message ? `: ${message}` : ".";
    if (response.status === 401)
      throw new HostError(
        "grafana-denied",
        `${host} turned the token down (401). Check it in Settings → Grafana.`,
        502,
      );
    if (response.status === 403)
      throw new HostError("grafana-denied", `Grafana answered 403${said}`, 502);
    if (response.status === 404)
      throw new HostError("grafana-missing", `Grafana answered 404${said}`, 404);
    // A query that partly failed answers 207, with each query's error.
    if (!response.ok && response.status !== 207)
      throw new HostError("grafana-failed", `Grafana answered ${response.status}${said}`, 502);
    return parsed as T;
  }

  interface FrontendSettings {
    datasources?: Record<string, { uid?: string; type?: string; name?: string }>;
    defaultDatasource?: string;
  }
  /** Data sources by name, for dashboards that name theirs, and the default one. */
  function frontendSettings(address: string, token: string, signal?: AbortSignal) {
    const kept = settingsBySite.get(address);
    if (kept && now() - kept.at < 10 * 60_000) return kept.value;
    const value = call<FrontendSettings>(address, token, "/api/frontend/settings", signal);
    settingsBySite.set(address, { at: now(), value });
    value.catch(() => settingsBySite.delete(address));
    return value;
  }

  async function datasource(
    ref: unknown,
    choices: Map<string, Choice>,
    address: string,
    token: string,
    signal?: AbortSignal,
  ): Promise<{ uid: string; type?: string }> {
    const named = async (name: string) => {
      const settings = await frontendSettings(address, token, signal);
      const found = settings.datasources?.[name];
      return found?.uid
        ? { uid: found.uid, ...(found.type ? { type: found.type } : {}) }
        : undefined;
    };
    if (ref === null || ref === undefined) {
      const settings = await frontendSettings(address, token, signal);
      const found = settings.defaultDatasource && (await named(settings.defaultDatasource));
      if (!found)
        throw new HostError("grafana-failed", "Grafana names no default data source.", 502);
      return found;
    }
    if (typeof ref === "string") {
      const name = interpolate(ref, choices);
      return (await named(name)) ?? { uid: name };
    }
    const object = ref as { uid?: unknown; type?: unknown };
    const uid = typeof object.uid === "string" ? interpolate(object.uid, choices) : "";
    const type = typeof object.type === "string" ? object.type : undefined;
    // A variable's value can be a data source's name.
    if (uid !== object.uid) {
      const found = await named(uid).catch(() => undefined);
      if (found) return found;
    }
    return { uid, ...(type ? { type } : {}) };
  }

  async function read(
    link: PanelLink,
    range: [number, number],
    isLive: boolean,
    signal?: AbortSignal,
  ) {
    const token = (await options.tokens.read())[link.site];
    if (!token)
      throw new HostError(
        "grafana-not-set",
        `Add a token for ${new URL(link.site).host} in Settings → Grafana to draw this chart.`,
        404,
      );
    const { dashboard } = await call<{
      dashboard?: {
        title?: string;
        panels?: PanelModel[];
        rows?: { panels?: PanelModel[] }[];
        templating?: { list?: Variable[] };
      };
    }>(link.site, token, `/api/dashboards/uid/${encodeURIComponent(link.uid)}`, signal);
    if (!dashboard)
      throw new HostError("grafana-missing", `Grafana has no dashboard ${link.uid}.`, 404);
    let panel =
      findPanel(dashboard.panels, link.panel) ??
      findPanel(
        (dashboard.rows ?? []).flatMap((row) => row.panels ?? []),
        link.panel,
      );
    if (!panel)
      throw new HostError(
        "grafana-missing",
        `“${dashboard.title ?? link.uid}” has no panel ${link.panel}.`,
        404,
      );
    // A library panel keeps its queries in the library.
    if (panel.libraryPanel?.uid && !panel.targets) {
      const library = await call<{ result?: { model?: PanelModel } }>(
        link.site,
        token,
        `/api/library-elements/${encodeURIComponent(panel.libraryPanel.uid)}`,
        signal,
      );
      panel = {
        ...library.result?.model,
        ...panel,
        ...{ targets: library.result?.model?.targets },
      };
    }
    const choices = variableChoices(dashboard.templating?.list ?? [], link.vars);
    const targets = (panel.targets ?? []).filter((target) => target.hide !== true);
    if (!targets.length)
      throw new HostError(
        "grafana-missing",
        `The panel “${panel.title ?? link.panel}” has no queries.`,
        404,
      );
    const panelSource =
      panel.datasource && typeof panel.datasource === "object"
        ? (panel.datasource as { uid?: string }).uid
        : panel.datasource;
    if (panelSource === "-- Dashboard --")
      throw new HostError(
        "invalid-chart",
        "This panel shows another panel's query; link to that panel.",
        400,
      );
    const mixed = panelSource === "-- Mixed --";
    const span = range[1] - range[0];
    const maxDataPoints = 600;
    const intervalMs = Math.max(1000, Math.round(span / maxDataPoints));
    const queries = await Promise.all(
      targets.map(async (target) => {
        const source = await datasource(
          target.datasource ?? (mixed ? undefined : panel.datasource),
          choices,
          link.site,
          token,
          signal,
        );
        return {
          ...(interpolateDeep(target, choices, source.type ?? "") as Record<string, unknown>),
          refId: typeof target.refId === "string" ? target.refId : "A",
          datasource: source,
          intervalMs,
          maxDataPoints,
        };
      }),
    );
    const answer = await call<{
      results?: Record<string, { frames?: Frame[]; error?: string; status?: number }>;
    }>(link.site, token, "/api/ds/query", signal, {
      queries,
      from: String(range[0]),
      to: String(range[1]),
    });
    const results = Object.values(answer.results ?? {});
    const failed = results.filter((result) => result.error);
    if (results.length && failed.length === results.length)
      throw new HostError("grafana-failed", `Grafana's query failed: ${failed[0]!.error}`, 502);
    const defaults = panel.fieldConfig?.defaults ?? {};
    const { unit, factor } = grafanaUnit(defaults.unit);
    const series = thin(
      framesToSeries(
        results.flatMap((result) => result.frames ?? []),
        {
          factor,
          ...(defaults.displayName ? { template: defaults.displayName } : {}),
          overrides: panel.fieldConfig?.overrides ?? [],
        },
      ),
    );
    const notes: string[] = [];
    if (failed.length)
      notes.push(`${failed.length} of the panel's queries failed: ${failed[0]!.error}`);
    if (panel.transformations?.length)
      notes.push("Med does not apply the panel's transformations.");
    // A threshold that the panel draws as a line.
    const style = defaults.custom?.thresholdsStyle?.mode ?? "off";
    const step =
      style !== "off" && defaults.thresholds?.mode !== "percentage"
        ? defaults.thresholds?.steps?.find((entry) => typeof entry.value === "number")
        : undefined;
    const threshold =
      typeof step?.value === "number" ? { value: step.value * factor, label: "" } : undefined;
    // The dashboard's own annotations, such as deploys.
    const marks = await call<{ time?: number; text?: unknown; tags?: unknown; panelId?: number }[]>(
      link.site,
      token,
      `/api/annotations?${new URLSearchParams({
        dashboardUID: link.uid,
        from: String(range[0]),
        to: String(range[1]),
        limit: "30",
      })}`,
      signal,
    )
      .then((list) =>
        (Array.isArray(list) ? list : [])
          .filter(
            (entry) =>
              typeof entry.time === "number" && (!entry.panelId || entry.panelId === link.panel),
          )
          .map((entry) => ({ at: entry.time!, label: markLabel(entry.text, entry.tags) }))
          .filter((mark) => mark.label)
          .sort((a, b) => a.at - b.at)
          .slice(0, 12),
      )
      .catch(() => []);
    const url = new URL(link.site);
    const own = new URL(
      `${url.pathname.replace(/\/$/, "")}/d/${encodeURIComponent(link.uid)}`,
      url.origin,
    );
    own.searchParams.set("viewPanel", String(link.panel));
    own.searchParams.set("from", isLive ? (link.from ?? "now-6h") : String(range[0]));
    own.searchParams.set("to", isLive ? (link.to ?? "now") : String(range[1]));
    for (const [name, values] of link.vars)
      for (const value of values) own.searchParams.append(`var-${name}`, value);
    return {
      title: panel.title ?? "",
      dashboard: dashboard.title ?? "",
      ...(unit ? { unit } : {}),
      ...(defaults.custom?.scaleDistribution?.type === "log" ? { scale: "log" as const } : {}),
      ...(threshold ? { threshold } : {}),
      marks,
      series,
      range,
      live: isLive,
      fetched: now(),
      link: own.toString(),
      notes,
    } satisfies GrafanaPanel;
  }

  const keyOf = (link: PanelLink, range: readonly number[], isLive: boolean) =>
    createHash("sha256")
      .update(
        JSON.stringify([
          link.site,
          link.uid,
          link.panel,
          [...link.vars].sort(),
          isLive ? [link.from, link.to] : range,
        ]),
      )
      .digest("hex")
      .slice(0, 32);

  async function keep(key: string, panel: GrafanaPanel) {
    if (!options.cacheDir) return;
    await mkdir(options.cacheDir, { recursive: true });
    const temporary = join(options.cacheDir, `${key}.${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify(panel));
    await rename(temporary, join(options.cacheDir, `${key}.json`));
    // The newest few hundred stay.
    const names = (await readdir(options.cacheDir)).filter((name) => name.endsWith(".json"));
    if (names.length <= KEPT + 20) return;
    const dated = await Promise.all(
      names.map(async (name) => ({
        name,
        at: (await stat(join(options.cacheDir!, name)).catch(() => undefined))?.mtimeMs ?? 0,
      })),
    );
    dated.sort((a, b) => b.at - a.at);
    await Promise.all(
      dated.slice(KEPT).map(({ name }) => rm(join(options.cacheDir!, name), { force: true })),
    );
  }

  async function kept(key: string): Promise<GrafanaPanel | undefined> {
    if (!options.cacheDir) return undefined;
    try {
      return JSON.parse(await readFile(join(options.cacheDir, `${key}.json`), "utf8"));
    } catch {
      return undefined;
    }
  }

  return {
    /** A panel's data over the range of its link or of the block. */
    async panel(input: PanelRequest, signal?: AbortSignal): Promise<GrafanaPanel> {
      const link = parsePanelLink(input.link, await options.sites());
      const fromText = input.from ?? link.from ?? "now-6h";
      const toText = input.to ?? link.to ?? "now";
      const relative = /^now/.test(fromText) || /^now/.test(toText);
      const isLive = !!input.live && relative;
      // A range relative to now counts from the reply, so the chart shows
      // what the agent looked at.
      const base = isLive ? now() : Math.min(input.at ?? now(), now());
      const from = grafanaTime(fromText, base);
      const to = grafanaTime(toText, base, true);
      if (from === null || to === null || to <= from)
        throw new HostError(
          "invalid-chart",
          `Med cannot read the range ${fromText} to ${toText}.`,
          400,
        );
      const range: [number, number] = [from, to];
      const key = keyOf({ ...link, from: fromText, to: toText }, range, isLive);
      if (!input.refresh) {
        const recent = live.get(key);
        if (isLive && recent && now() - recent.at < LIVE_MS) return recent.panel;
        if (!isLive) {
          const saved = await kept(key);
          if (saved) return saved;
        }
      }
      const pending = running.get(key);
      if (pending) return pending;
      const work = read({ ...link, from: fromText, to: toText }, range, isLive, signal).then(
        async (panel) => {
          if (isLive) live.set(key, { at: now(), panel });
          else await keep(key, panel).catch(() => {});
          return panel;
        },
      );
      running.set(key, work);
      try {
        return await work;
      } finally {
        running.delete(key);
      }
    },
    /** Checks a token: Grafana's version, and the organization it reads. */
    async check(address: string, token: string, signal?: AbortSignal) {
      const health = await call<{ version?: string }>(
        address,
        undefined,
        "/api/health",
        signal,
      ).catch((reason: unknown) => {
        if (reason instanceof HostError && reason.code === "grafana-unreachable") throw reason;
        return {} as { version?: string };
      });
      const organization = await call<{ name?: string }>(address, token, "/api/org", signal);
      return {
        ...(health.version ? { version: health.version } : {}),
        ...(organization.name ? { organization: organization.name } : {}),
      };
    },
  };
}
