import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { isMap, LineCounter, parseDocument } from "yaml";
import { chartSourceFor, type GrafanaPanel, type LinkChart } from "../shared/charts";
import {
  DASHBOARD_SUFFIX,
  inputValues,
  panelChartText,
  panelTitle,
  panelType,
  panelWidth,
  firstRange,
  sourceName,
  substitute,
  WIDTH_WORDS,
  type Dashboard,
  type DashboardCheck,
  type DashboardEntry,
  type DashboardFile,
  type DashboardInput,
  type DashboardPanel,
  type DashboardProblem,
  type OptionsSource,
  type PanelCheck,
} from "../shared/dashboards";
import type { RegisteredRepository } from "../shared/protocol";
import {
  grafanaRequest,
  linkRequest,
  parseChartBlock,
  parseCsv,
  rowsData,
  type ChartData,
} from "../web/components/chart/chart-block";
import {
  dataWarnings,
  REDUCES,
  statOf,
  summarize,
  tableFromData,
  tableOf,
  type Reduce,
} from "../web/components/chart/chart-summary";
import { formatValue } from "../web/components/chart/chart-model";
import { HostError } from "./runtime/errors";
import type { LinkRequest } from "./chart-sources";
import type { PanelRequest } from "./grafana";

// Dashboards (shared/dashboards.ts has the format): Med finds each
// `*.dashboard.yaml` in the repositories it knows and in the dashboards
// folder beside its settings, reads one for its page, and checks one for an
// agent: it reads every panel through the same chart sources the page uses,
// and says in words what each drew.

const NAME = /^[A-Za-z][\w-]*$/;
const KEY = /^[a-z][\w-]*$/;
const RESERVED = new Set(["from", "to", "range", "view"]);
const CHART_TYPES = new Set(["line", "bars", "stat", "table"]);
const DATA_KEYS = ["link", "grafana", "file", "rows"];
/** A link, as `https://…`; else a path. */
const LINK = /^[a-z][\w+.-]*:\/\//i;

/** A dashboard file as Med reads it: what it says, and what is wrong in it. */
export function parseDashboard(
  text: string,
  fallbackTitle = "Dashboard",
): { dashboard?: Dashboard; problems: DashboardProblem[] } {
  const lines = new LineCounter();
  const document = parseDocument(text, { lineCounter: lines, uniqueKeys: true });
  const at = (offset: number | undefined) =>
    offset === undefined ? undefined : lines.linePos(offset).line;
  const problems: DashboardProblem[] = document.errors.map((error) => ({
    message: error.message.split("\n")[0]!,
    ...(at(error.pos[0]) !== undefined ? { line: at(error.pos[0]) } : {}),
  }));
  if (problems.length) return { problems };
  const lineOf = (path: (string | number)[]) => {
    const node = document.getIn(path, true) as { range?: [number, number, number] } | undefined;
    return at(node?.range?.[0]);
  };
  const problem = (message: string, path: (string | number)[]) => {
    const line = lineOf(path);
    problems.push({ message, ...(line !== undefined ? { line } : {}) });
  };
  const root = document.contents;
  if (!isMap(root)) {
    problems.push({ message: "A dashboard is a map of keys, as title: and views:." });
    return { problems };
  }
  const value = document.toJS() as Record<string, unknown>;
  const known = new Set(["title", "description", "range", "live", "inputs", "views", "panels"]);
  for (const key of Object.keys(value))
    if (!known.has(key))
      problem(
        `Med does not know the key ${key}. A dashboard has title, description, range, live, inputs, and views (or panels).`,
        [key],
      );
  const text_ = (key: string) => {
    const field = value[key];
    if (field === undefined || field === null) return undefined;
    if (typeof field === "string" || typeof field === "number") return String(field);
    problem(`${key} is text.`, [key]);
    return undefined;
  };
  const title = text_("title") ?? fallbackTitle;
  const description = text_("description");
  let range = text_("range");
  if (range !== undefined && !firstRange(range)) {
    problem(
      "range is the time picker's first range, relative to now: now-6h, today, last 7 days, or now-7d to now-1d.",
      ["range"],
    );
    range = undefined;
  }
  const live = truthy(value.live);
  if (live === null) problem("live is true or false.", ["live"]);

  // Inputs: a map of name to settings, or to a default, or to a list of choices.
  const inputs: DashboardInput[] = [];
  if (value.inputs !== undefined && value.inputs !== null) {
    if (!isPlainObject(value.inputs))
      problem("inputs is a map of each input's name to it.", ["inputs"]);
    else
      for (const [name, raw] of Object.entries(value.inputs)) {
        const path = ["inputs", name];
        if (!NAME.test(name) || RESERVED.has(name)) {
          problem(
            RESERVED.has(name)
              ? `${name} is Med's own name; call the input something else.`
              : `An input's name is letters, digits, - and _, starting with a letter: not ${name}.`,
            path,
          );
          continue;
        }
        const settings = isPlainObject(raw)
          ? raw
          : Array.isArray(raw)
            ? { options: raw }
            : { default: raw };
        const options = Array.isArray(settings.options)
          ? settings.options.map((option) => String(option))
          : undefined;
        const source =
          options || settings.options === undefined
            ? undefined
            : optionsSource(settings.options, name, [...path, "options"], problem);
        if (settings.options !== undefined && !options && source === undefined) continue;
        const type =
          settings.type === undefined
            ? options || source
              ? "choice"
              : "text"
            : String(settings.type);
        if (type !== "text" && type !== "choice") {
          problem(`${name} is a text or a choice input, not ${type}.`, [...path, "type"]);
          continue;
        }
        if (type === "choice" && !options?.length && !source) {
          problem(`${name} is a choice: give it options.`, path);
          continue;
        }
        // Options read from a file are known only as Med reads it (readOptions).
        const fallback = type === "choice" && options ? options[0]! : "";
        const given =
          settings.default === undefined || settings.default === null
            ? fallback
            : String(settings.default);
        if (type === "choice" && options && !options.includes(given))
          problem(`${name}'s default is not one of its options.`, [...path, "default"]);
        const pattern = settings.pattern === undefined ? undefined : String(settings.pattern);
        if (pattern !== undefined)
          try {
            new RegExp(pattern);
          } catch {
            problem(`${name}'s pattern is not a regular expression.`, [...path, "pattern"]);
          }
        const line = lineOf(path);
        inputs.push({
          name,
          label: settings.label === undefined ? name : String(settings.label),
          type,
          default: type === "choice" && options && !options.includes(given) ? fallback : given,
          ...(options ? { options } : {}),
          ...(source ? { source } : {}),
          ...(pattern !== undefined ? { pattern } : {}),
          ...(line !== undefined ? { line } : {}),
        });
      }
  }

  // Views of panels, or panels as one view.
  const views: Dashboard["views"] = [];
  const panelsAt = (list: unknown, path: (string | number)[]) => {
    if (!Array.isArray(list)) {
      problem("panels is a list.", path);
      return [];
    }
    return list.flatMap((raw, index) => {
      const panel = readPanel(raw, [...path, index], problem);
      if (!panel) return [];
      const line = lineOf([...path, index]);
      return [{ ...panel, ...(line !== undefined ? { line } : {}) }];
    });
  };
  if (value.views !== undefined && value.panels !== undefined)
    problem("A dashboard has views, or panels as its one view, not both.", ["panels"]);
  if (Array.isArray(value.views))
    value.views.forEach((view, index) => {
      if (!isPlainObject(view))
        return problem("Each view is a map: name and panels.", ["views", index]);
      views.push({
        name: view.name === undefined ? `View ${index + 1}` : String(view.name),
        panels: panelsAt(view.panels ?? [], ["views", index, "panels"]),
      });
    });
  else if (value.views !== undefined) problem("views is a list.", ["views"]);
  else if (value.panels !== undefined)
    views.push({ name: title, panels: panelsAt(value.panels, ["panels"]) });
  if (!views.length) problem("The dashboard has no views or panels yet.", []);
  return {
    dashboard: {
      title,
      ...(description !== undefined ? { description } : {}),
      ...(range !== undefined ? { range } : {}),
      live: !!live,
      inputs,
      views,
    },
    problems,
  };
}

/** Where an input's options come from: a file's path or a link, or a map of
 * `file` or `link`, the `value` and `label` columns, and the link's keys. */
function optionsSource(
  raw: unknown,
  name: string,
  path: (string | number)[],
  problem: (message: string, path: (string | number)[]) => void,
): OptionsSource | undefined {
  const usage = `${name}'s options are a list, a file or a link to read them from, or a map: file or link, and the value and label columns.`;
  if (typeof raw === "string" && raw.trim())
    return LINK.test(raw.trim()) ? { link: raw.trim() } : { file: raw.trim() };
  if (!isPlainObject(raw)) {
    problem(usage, path);
    return undefined;
  }
  const source: OptionsSource = {};
  const meta: Record<string, string> = {};
  for (const [key, field] of Object.entries(raw)) {
    const text = scalar(field);
    if (text === undefined || !text.trim()) {
      problem(`${name}'s options: ${key} is text.`, [...path, key]);
      return undefined;
    }
    if (key === "file" || key === "link" || key === "value" || key === "label")
      source[key] = text.trim();
    else if (KEY.test(key)) meta[key] = text;
    else {
      problem(`A key is lower-case letters, digits, - and _: not ${key}.`, [...path, key]);
      return undefined;
    }
  }
  if (!source.file === !source.link) {
    problem(
      source.file
        ? `${name}'s options come from a file or a link, not both.`
        : `${name}'s options need a file or a link to read them from.`,
      path,
    );
    return undefined;
  }
  if (Object.keys(meta).length) {
    if (source.file) {
      problem(
        `${name}'s options from a file take value and label, not ${Object.keys(meta).join(", ")}.`,
        path,
      );
      return undefined;
    }
    source.meta = meta;
  }
  return source;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** true, false, or null for neither. */
function truthy(value: unknown): boolean | null {
  if (value === undefined || value === null || value === false) return false;
  if (value === true) return true;
  if (typeof value === "string" && /^(?:yes|true|on)$/i.test(value)) return true;
  if (typeof value === "string" && /^(?:no|false|off)$/i.test(value)) return false;
  return null;
}

/** A key's value as a chart block's text. */
function scalar(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "yes" : "no";
  return undefined;
}

function readPanel(
  raw: unknown,
  path: (string | number)[],
  problem: (message: string, path: (string | number)[]) => void,
): DashboardPanel | undefined {
  if (!isPlainObject(raw)) {
    problem("Each panel is a map of keys, as a chart block's.", path);
    return undefined;
  }
  const widthRaw = raw.width;
  let width = widthRaw === undefined ? null : panelWidth(widthRaw);
  if (widthRaw !== undefined && width === null)
    problem(`width is ${WIDTH_WORDS.join(", ")}, or columns of 12: not ${String(widthRaw)}.`, [
      ...path,
      "width",
    ]);
  if (raw.text !== undefined) {
    const others = Object.keys(raw).filter((key) => key !== "text" && key !== "width");
    if (others.length)
      problem(`A text panel takes text and width, not ${others.join(", ")}.`, path);
    return { kind: "text", width: width ?? 12, text: String(raw.text) };
  }
  const keys: [string, string][] = [];
  let rows: string | undefined;
  for (const [key, field] of Object.entries(raw)) {
    const at = [...path, key];
    if (key === "width") continue;
    if (!KEY.test(key)) {
      problem(`A key is lower-case letters, digits, - and _: not ${key}.`, at);
      continue;
    }
    if (key === "rows") {
      if (typeof field === "string") rows = field;
      else if (Array.isArray(field)) rows = JSON.stringify(field);
      else problem("rows are CSV text, or a list of rows as maps.", at);
      continue;
    }
    if (key === "mark" || key === "marks") {
      const marks = Array.isArray(field) ? field : [field];
      for (const mark of marks) {
        if (typeof mark === "string") keys.push(["mark", mark]);
        else if (isPlainObject(mark) && mark.at !== undefined && mark.label !== undefined)
          keys.push(["mark", `${String(mark.at)} ${String(mark.label)}`]);
        else problem('A mark is a time and a label, as "10:42 Deploy v412".', at);
      }
      continue;
    }
    if (key === "threshold" && isPlainObject(field)) {
      if (typeof field.value !== "number") problem("A threshold has a value, a number.", at);
      else
        keys.push(["threshold", `${field.value}${field.label ? ` ${String(field.label)}` : ""}`]);
      continue;
    }
    const text = scalar(field);
    if (text === undefined) {
      problem(`${key} is text, a number, or yes or no.`, at);
      continue;
    }
    if (key === "type" && !CHART_TYPES.has(text.toLowerCase()))
      problem(`type is line, bars, stat, or table: not ${text}.`, at);
    if (key === "reduce" && !REDUCES.includes(text as Reduce))
      problem(`reduce is ${REDUCES.join(", ")}: not ${text}.`, at);
    keys.push([key, text]);
  }
  const sources = DATA_KEYS.filter((key) => key in raw);
  if (sources.length !== 1)
    problem(
      sources.length
        ? `A panel takes one of ${sources.join(" and ")}.`
        : "A panel needs a link, a grafana link, a file, rows, or text.",
      path,
    );
  const type = keys.find(([key]) => key === "type")?.[1]?.toLowerCase();
  return {
    kind: "chart",
    width: width ?? (type === "stat" ? 3 : 12),
    keys,
    ...(rows !== undefined ? { rows } : {}),
  };
}

/** The most options an input takes from a file or a link. */
const MAX_OPTIONS = 5000;
/** The largest file that an input reads its options from. */
const MAX_OPTIONS_BYTES = 4 << 20;
/** How long a link's options last before its command runs again. */
const LINK_OPTIONS_MS = 60_000;

/** A cell as an option's text, or none for one that is empty or not text. */
function cell(value: unknown) {
  const text = scalar(value)?.trim();
  return text ? text : undefined;
}

/**
 * The options in a file's or a command's text: a JSON list of values, or of
 * maps whose `value` field (the first, when none is named) is the value; a
 * JSON map, whose keys are; CSV or TSV under a header, its `value` column or
 * the first; or a value a line, without blank lines and # notes. The `label`
 * field or column names each option on the page.
 */
export function optionsOf(
  text: string,
  source: Pick<OptionsSource, "value" | "label">,
  kind?: "json" | "csv" | "lines",
): { options: string[]; labels: Record<string, string>; cut: boolean } | { error: string } {
  const trimmed = text.trim();
  const as =
    kind ?? (/^[[{]/.test(trimmed) ? "json" : /^[^\n]*[,\t]/.test(trimmed) ? "csv" : "lines");
  const pairs: [string | undefined, string | undefined][] = [];
  if (as === "json") {
    let data: unknown;
    try {
      data = JSON.parse(trimmed);
    } catch {
      return { error: "Its JSON does not parse." };
    }
    if (Array.isArray(data)) {
      for (const item of data)
        if (isPlainObject(item)) {
          const key = source.value ?? Object.keys(item)[0];
          pairs.push([
            key === undefined ? undefined : cell(item[key]),
            source.label ? cell(item[source.label]) : undefined,
          ]);
        } else pairs.push([cell(item), undefined]);
      if (source.value && data.length && pairs.every(([value]) => value === undefined))
        return { error: `No item has a field ${source.value}.` };
    } else if (isPlainObject(data))
      for (const [key, item] of Object.entries(data))
        pairs.push([
          key,
          source.label && isPlainObject(item) ? cell(item[source.label]) : undefined,
        ]);
    else return { error: "Its JSON is a list of options, or a map whose keys are the options." };
  } else if (as === "csv") {
    const [header = [], ...rows] = parseCsv(trimmed);
    const column = (name: string | undefined, fallback: number) => {
      if (name === undefined) return fallback;
      const exact = header.indexOf(name);
      return exact >= 0
        ? exact
        : header.findIndex((each) => each.toLowerCase() === name.toLowerCase());
    };
    const valueAt = column(source.value, 0);
    const labelAt = column(source.label, -1);
    for (const [name, at] of [
      [source.value, valueAt],
      [source.label, labelAt],
    ] as const)
      if (name !== undefined && at < 0)
        return { error: `It has no column ${name}; its columns are ${header.join(", ")}.` };
    for (const row of rows)
      pairs.push([cell(row[valueAt]), labelAt >= 0 ? cell(row[labelAt]) : undefined]);
  } else
    for (const line of trimmed.split(/\r?\n/)) {
      const value = line.trim();
      if (value && !value.startsWith("#")) pairs.push([value, undefined]);
    }
  const options: string[] = [];
  const labels: Record<string, string> = {};
  const seen = new Set<string>();
  for (const [value, label] of pairs) {
    if (value === undefined || seen.has(value)) continue;
    seen.add(value);
    options.push(value);
    if (label !== undefined && label !== value) labels[value] = label;
  }
  if (!options.length) return { error: "It holds no options." };
  const cut = options.length > MAX_OPTIONS;
  if (cut) for (const value of options.splice(MAX_OPTIONS)) delete labels[value];
  return { options, labels, cut };
}

const git = (cwd: string, args: string[]) =>
  new Promise<string>((done, failed) =>
    execFile(
      "git",
      args,
      { cwd, encoding: "utf8", maxBuffer: 1 << 24, timeout: 10_000 },
      (error, stdout) => (error ? failed(error) : done(stdout)),
    ),
  );

/** The dashboard files under `folder`, a few levels down. */
async function filesIn(folder: string, depth = 3): Promise<string[]> {
  const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
  const found: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const path = join(folder, entry.name);
    if (entry.isDirectory() && depth > 0) found.push(...(await filesIn(path, depth - 1)));
    else if (entry.isFile() && entry.name.endsWith(DASHBOARD_SUFFIX)) found.push(path);
  }
  return found;
}

export interface DashboardsOptions {
  /** The personal dashboards' folder, beside Med's settings. */
  folder: string;
  repositories(): readonly RegisteredRepository[];
  /** The chart sources in Settings, by base. */
  sources(): Promise<Record<string, string>>;
  readLink(input: LinkRequest, signal?: AbortSignal): Promise<LinkChart>;
  readGrafana(input: PanelRequest, signal?: AbortSignal): Promise<GrafanaPanel>;
  now?(): number;
}

/** At most `count` of `work` at once, in order. */
async function inTurns<T, R>(items: readonly T[], count: number, work: (item: T) => Promise<R>) {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(count, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await work(items[index]!);
      }
    }),
  );
  return results;
}

export function createDashboards(options: DashboardsOptions) {
  const now = options.now ?? Date.now;
  const parsed = new Map<
    string,
    { modified: number; text: string; read: ReturnType<typeof parseDashboard> }
  >();

  async function readParsed(path: string) {
    const info = await stat(path);
    const cached = parsed.get(path);
    if (cached && cached.modified === info.mtimeMs) return cached;
    const text = await readFile(path, "utf8");
    const read = parseDashboard(text, basename(path, DASHBOARD_SUFFIX));
    const entry = { modified: info.mtimeMs, text, read };
    parsed.set(path, entry);
    return entry;
  }

  // A link's options, kept a while: the page reads the dashboard every few
  // seconds, and the link's command need not run each time.
  const linkOptions = new Map<string, { at: number; rows: Promise<string> }>();

  /** The text an input's options are in, and what kind of text it is. */
  async function optionsText(
    source: OptionsSource,
    folder: string,
    refresh: boolean,
    signal?: AbortSignal,
  ): Promise<{ text: string; kind?: "json" | "csv" | "lines" }> {
    if (source.file) {
      const path = source.file.startsWith("~/")
        ? join(homedir(), source.file.slice(2))
        : resolve(folder, source.file);
      const info = await stat(path).catch(() => undefined);
      if (!info?.isFile()) throw new Error(`There is no file ${path}.`);
      if (info.size > MAX_OPTIONS_BYTES)
        throw new Error(`The file is over ${MAX_OPTIONS_BYTES >> 20} MB.`);
      const extension = extname(path).toLowerCase();
      return {
        text: await readFile(path, "utf8"),
        ...(extension === ".json"
          ? { kind: "json" as const }
          : extension === ".csv" || extension === ".tsv"
            ? { kind: "csv" as const }
            : extension === ".txt"
              ? { kind: "lines" as const }
              : {}),
      };
    }
    const key = JSON.stringify([source.link, source.meta ?? {}]);
    const kept = linkOptions.get(key);
    let rows = !refresh && kept && now() - kept.at < LINK_OPTIONS_MS ? kept.rows : undefined;
    if (!rows) {
      rows = options
        .readLink(
          {
            link: source.link!,
            live: true,
            ...(source.meta ? { meta: source.meta } : {}),
            ...(refresh ? { refresh } : {}),
          },
          signal,
        )
        .then((chart) => {
          if (chart.rows === undefined) throw new Error("Its command printed a chart, not rows.");
          return chart.rows;
        });
      // One that failed waits its while too, so a broken command is not run
      // each time the page reads.
      rows.catch(() => {});
      if (!refresh) linkOptions.set(key, { at: now(), rows });
    }
    const text = await rows;
    return { text, kind: /^\s*[[{]/.test(text) ? "json" : "csv" };
  }

  /** An input with its options read from its file or link, what is wrong
   * with them, and what it read. */
  async function inputOptions(
    input: DashboardInput,
    folder: string,
    refresh: boolean,
    signal?: AbortSignal,
  ): Promise<{
    input: DashboardInput;
    problems: DashboardProblem[];
    read?: { name: string; from: string; options: string[] };
  }> {
    if (!input.source) return { input, problems: [] };
    const from = sourceName(input.source);
    const problem = (message: string) => ({
      message,
      ...(input.line !== undefined ? { line: input.line } : {}),
    });
    let found: ReturnType<typeof optionsOf>;
    try {
      const { text, kind } = await optionsText(input.source, folder, refresh, signal);
      found = optionsOf(text, input.source, kind);
    } catch (error) {
      found = { error: error instanceof Error ? error.message : String(error) };
    }
    if ("error" in found)
      return {
        input: { ...input, options: [] },
        problems: [problem(`${input.name}'s options from ${from}: ${found.error}`)],
      };
    const problems = found.cut
      ? [problem(`${input.name} takes the first ${MAX_OPTIONS} options of ${from}.`)]
      : [];
    let first = input.default;
    if (input.type === "choice" && !found.options.includes(first)) {
      if (first)
        problems.push(
          problem(
            `${input.name}'s default ${first} is not in ${from}, so it starts at ${found.options[0]}.`,
          ),
        );
      first = found.options[0]!;
    }
    return {
      input: {
        ...input,
        default: first,
        options: found.options,
        ...(Object.keys(found.labels).length ? { labels: found.labels } : {}),
      },
      problems,
      read: { name: input.name, from, options: found.options },
    };
  }

  /** The dashboard with each input's options read, in the inputs' order. */
  async function withOptions(
    dashboard: Dashboard,
    folder: string,
    refresh = false,
    signal?: AbortSignal,
  ) {
    const found = await Promise.all(
      dashboard.inputs.map((input) => inputOptions(input, folder, refresh, signal)),
    );
    return {
      dashboard: { ...dashboard, inputs: found.map((each) => each.input) },
      problems: found.flatMap((each) => each.problems),
      read: found.flatMap((each) => each.read ?? []),
    };
  }

  async function list(): Promise<{ folder: string; dashboards: DashboardEntry[] }> {
    const places: { where: string; root: string; files: string[] }[] = [
      { where: "Personal", root: options.folder, files: await filesIn(options.folder) },
    ];
    for (const repository of options.repositories()) {
      const out = await git(repository.path, [
        "ls-files",
        "-z",
        "--cached",
        "--others",
        "--exclude-standard",
        "--",
        `*${DASHBOARD_SUFFIX}`,
      ]).catch(() => "");
      const files = out
        .split("\0")
        .filter(Boolean)
        .map((file) => join(repository.path, file));
      if (files.length) places.push({ where: repository.name, root: repository.path, files });
    }
    const taken = new Set<string>();
    const dashboards: DashboardEntry[] = [];
    for (const place of places)
      for (const path of [...new Set(place.files)].sort()) {
        const read = await readParsed(path).catch(() => undefined);
        if (!read) continue;
        const rel = relative(place.root, path);
        const stem = `${place.where === "Personal" ? "personal" : place.where}/${rel.slice(0, -DASHBOARD_SUFFIX.length)}`;
        let id = stem;
        for (let n = 2; taken.has(id); n++) id = `${stem}~${n}`;
        taken.add(id);
        const dashboard = read.read.dashboard;
        dashboards.push({
          id,
          path,
          where: place.where,
          relative: rel,
          title: dashboard?.title ?? basename(path, DASHBOARD_SUFFIX),
          ...(dashboard?.description ? { description: dashboard.description } : {}),
          views: dashboard?.views.length ?? 0,
          panels: dashboard?.views.reduce((total, view) => total + view.panels.length, 0) ?? 0,
          ...(read.read.problems[0] ? { problem: describe(read.read.problems[0]) } : {}),
          modified: read.modified,
        });
      }
    const home = homedir();
    const folder = options.folder.startsWith(`${home}/`)
      ? `~${options.folder.slice(home.length)}`
      : options.folder;
    return { folder, dashboards };
  }

  async function find(id: string) {
    const entry = (await list()).dashboards.find((dashboard) => dashboard.id === id);
    if (!entry) throw new HostError("dashboard-missing", `Med has no dashboard ${id}.`, 404);
    return entry;
  }

  async function read(id: string): Promise<DashboardFile> {
    const entry = await find(id);
    const file = await readParsed(entry.path);
    const sourced = file.read.dashboard
      ? await withOptions(file.read.dashboard, dirname(entry.path))
      : undefined;
    return {
      entry,
      text: file.text,
      ...(sourced ? { dashboard: sourced.dashboard } : {}),
      problems: [...file.read.problems, ...(sourced?.problems ?? [])],
    };
  }

  /** Reads one chart panel as its page would, every source again. */
  async function checkPanel(
    panel: Extract<DashboardPanel, { kind: "chart" }>,
    values: Record<string, string>,
    live: boolean,
    folder: string,
    at: number,
    signal?: AbortSignal,
  ): Promise<Omit<PanelCheck, "view" | "index" | "line" | "title" | "type">> {
    const chart = panelChartText(panel, values, live);
    const warnings = chart.unknown.map((name) => `\${${name}} is no input of the dashboard.`);
    const notes: string[] = [];
    const block = parseChartBlock(chart.text);
    if ("error" in block) return { status: "error", error: block.error, warnings };
    const source = block.source;
    let data: ChartData;
    let text: string | undefined;
    let unit = block.unit;
    let from = "";
    let link: string | undefined;
    try {
      if (source.kind === "rows") {
        from = "rows";
        text = source.text;
      } else if (source.kind === "file") {
        from = "file";
        const path = isAbsolute(source.path) ? source.path : resolve(folder, source.path);
        text = await readFile(path, "utf8");
      } else {
        link = source.link;
        const sources = await options.sources();
        const covered = chartSourceFor(sources, source.link);
        if (source.kind === "grafana" && !covered) {
          from = "Grafana";
          const panelRead = await options.readGrafana(
            { ...grafanaRequest(source, at)!, refresh: true },
            signal,
          );
          unit ??= panelRead.unit;
          data = { kind: "line", series: panelRead.series };
          notes.push(...panelRead.notes);
        } else {
          from = covered?.base ?? "a chart source";
          const linkRead = await options.readLink(
            { ...linkRequest(source, at)!, refresh: true },
            signal,
          );
          if (linkRead.rows !== undefined) text = linkRead.rows;
          else {
            const printed = linkRead.chart!;
            unit ??= printed.unit;
            data =
              printed.bars && !printed.series
                ? { kind: "bars", bars: printed.bars }
                : { kind: "line", series: printed.series ?? [] };
            notes.push(...(printed.notes ?? []));
          }
        }
      }
    } catch (error) {
      return {
        status: "error",
        ...(from ? { from } : {}),
        ...(link ? { link } : {}),
        error: error instanceof Error ? error.message : String(error),
        warnings,
      };
    }
    if (block.type === "table") {
      const table = text !== undefined ? tableOf(text) : tableFromData(data!);
      if ("error" in table)
        return { status: "error", from, ...(link ? { link } : {}), error: table.error, warnings };
      return {
        status: "ok",
        from,
        ...(link ? { link } : {}),
        summary: `${table.rows.length} row${table.rows.length === 1 ? "" : "s"} × ${table.columns.length} columns: ${table.columns.join(", ")}${table.rows[0] ? `; first: ${table.rows[0].join(", ")}` : ""}`,
        warnings: [...warnings, ...(table.rows.length ? [] : ["The table has no rows."])],
        ...(notes.length ? { notes } : {}),
      };
    }
    data ??= rowsData(text!, block);
    if (data.kind === "error")
      return { status: "error", from, ...(link ? { link } : {}), error: data.error, warnings };
    const stat =
      block.type === "stat"
        ? statOf(data, (block.reduce as Reduce | undefined) ?? "last")
        : undefined;
    return {
      status: "ok",
      from,
      ...(link ? { link } : {}),
      summary: stat
        ? stat.value === null
          ? "No value"
          : `${formatValue(stat.value, unit)}${stat.label ? ` (${stat.label})` : ""}${stat.change !== null ? `, ${stat.change >= 0 ? "+" : ""}${(stat.change * 100).toFixed(1)}% over the range` : ""}`
        : summarize(data, unit),
      warnings: [...warnings, ...dataWarnings(data)],
      ...(notes.length ? { notes } : {}),
    };
  }

  async function check(
    input: { id?: string; path?: string; values?: Record<string, string> },
    signal?: AbortSignal,
  ): Promise<DashboardCheck> {
    let path: string;
    let id: string | undefined;
    if (input.id) {
      const entry = await find(input.id);
      path = entry.path;
      id = entry.id;
    } else if (input.path) {
      path = resolve(input.path);
      if (!path.endsWith(DASHBOARD_SUFFIX))
        throw new HostError(
          "invalid-dashboard",
          `A dashboard's file ends in ${DASHBOARD_SUFFIX}.`,
          400,
        );
      id = (await list()).dashboards.find((entry) => entry.path === path)?.id;
    } else throw new HostError("invalid-dashboard", "Name a dashboard: its id or its file.", 400);
    const file = await readParsed(path).catch(() => {
      throw new HostError("dashboard-missing", `There is no dashboard at ${path}.`, 404);
    });
    const problems = [...file.read.problems];
    if (!file.read.dashboard)
      return {
        path,
        ...(id ? { id } : {}),
        title: basename(path),
        problems,
        values: {},
        panels: [],
      };
    // The options as the page would read them now, every link again.
    const sourced = await withOptions(file.read.dashboard, dirname(path), true, signal);
    const dashboard = sourced.dashboard;
    problems.push(...sourced.problems);
    const given = input.values ?? {};
    const { values, problems: valueProblems } = inputValues(dashboard, given);
    problems.push(...valueProblems.map((message) => ({ message })));
    const views = given.view
      ? dashboard.views.filter((view) => view.name === given.view)
      : dashboard.views;
    if (given.view && !views.length)
      problems.push({
        message: `There is no view ${given.view}: ${dashboard.views.map((view) => view.name).join(", ")}.`,
      });
    const at = Math.floor(now() / 60_000) * 60_000;
    const work = views.flatMap((view) =>
      view.panels.map((panel, index) => ({ view: view.name, index: index + 1, panel })),
    );
    const panels = await inTurns(work, 4, async ({ view, index, panel }): Promise<PanelCheck> => {
      const head = {
        view,
        index,
        ...(panel.line !== undefined ? { line: panel.line } : {}),
        title: substitute(panelTitle(panel), values).text,
        type: panelType(panel),
      };
      if (panel.kind === "text") return { ...head, status: "text", warnings: [] };
      const started = now();
      const result = await checkPanel(panel, values, dashboard.live, dirname(path), at, signal);
      return { ...head, ...result, ms: Math.max(0, now() - started) };
    });
    return {
      path,
      ...(id ? { id } : {}),
      title: dashboard.title,
      problems,
      values,
      ...(sourced.read.length ? { options: sourced.read } : {}),
      panels,
    };
  }

  return { list, read, check, folder: options.folder };
}

/** A problem as a line, with where it is. */
export const describe = (problem: DashboardProblem) =>
  problem.line !== undefined ? `Line ${problem.line}: ${problem.message}` : problem.message;

export type Dashboards = ReturnType<typeof createDashboards>;
