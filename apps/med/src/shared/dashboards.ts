import { z } from "zod";
import type { RouteContract } from "./routes";
import { isRelative, parseRange, resolveRange, timeValue, type TimeRange } from "./time-range";

// A dashboard is a YAML file that opens as its own page, as an Obsidian Base
// does: `<name>.dashboard.yaml` in a repository Med knows, or in the
// dashboards folder beside Med's settings. Its views are tabs of panels, and
// each panel takes a chart block's keys (a link, a grafana link, a file, or
// rows), or Markdown text. Its inputs are the values a reader picks; `${name}`
// in a panel's keys becomes the value, so a chart source reads it as one more
// key. Med reads what the file says and draws it; the chart sources fetch.
//
//   title: Checkout
//   range: now-6h            # the time picker's first range; ${from} and ${to}
//   live: true               # every chart reads again each minute
//   inputs:
//     service: { type: text, default: checkout }
//     env: { type: choice, options: [prod, staging] }
//   views:
//     - name: Overview
//       panels:
//         - link: https://status.acme.dev/${service}?env=${env}&from=${from}
//           title: p99 latency
//           width: half
//         - text: Deploys go out at 10:00 and 15:00.

export const DASHBOARD_SUFFIX = ".dashboard.yaml";

/** The grid's columns: a panel spans some of them. */
export const DASHBOARD_COLUMNS = 12;

const WIDTHS: Record<string, number> = {
  full: 12,
  "three-quarters": 9,
  "two-thirds": 8,
  half: 6,
  third: 4,
  quarter: 3,
  "3/4": 9,
  "2/3": 8,
  "1/2": 6,
  "1/3": 4,
  "1/4": 3,
};

/** A panel's width as columns of the grid, or null for one that is none. */
export function panelWidth(value: unknown): number | null {
  if (typeof value === "number")
    return Number.isInteger(value) && value >= 1 && value <= DASHBOARD_COLUMNS ? value : null;
  if (typeof value !== "string") return null;
  return WIDTHS[value.trim().toLowerCase()] ?? null;
}
export const WIDTH_WORDS = ["full", "three-quarters", "two-thirds", "half", "third", "quarter"];

/** A dashboard's first range is relative, so it means the same whenever the
 * page opens: now-6h, today, last 7 days, now-7d to now-1d. */
export function firstRange(text: string): TimeRange | null {
  const read = parseRange(text);
  return "range" in read && isRelative(read.range.from) && isRelative(read.range.to)
    ? read.range
    : null;
}

const inputSchema = z.object({
  name: z.string(),
  label: z.string(),
  type: z.enum(["text", "choice"]),
  default: z.string(),
  options: z.array(z.string()).optional(),
  /** A text input's values match this, as a whole. */
  pattern: z.string().optional(),
});
export type DashboardInput = z.infer<typeof inputSchema>;

const panelSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("chart"),
    width: z.number(),
    /** The chart block's keys in order, with `${name}` still in them. */
    keys: z.array(z.tuple([z.string(), z.string()])),
    /** CSV rows, after the keys. */
    rows: z.string().optional(),
    /** Its line in the file. */
    line: z.number().optional(),
  }),
  z.object({
    kind: z.literal("text"),
    width: z.number(),
    text: z.string(),
    line: z.number().optional(),
  }),
]);
export type DashboardPanel = z.infer<typeof panelSchema>;

export const dashboardSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  /** The time picker's first range, as written (firstRange reads it); none
   * shows no picker. */
  range: z.string().optional(),
  live: z.boolean(),
  inputs: z.array(inputSchema),
  views: z.array(z.object({ name: z.string(), panels: z.array(panelSchema) })),
});
export type Dashboard = z.infer<typeof dashboardSchema>;

export const dashboardProblemSchema = z.object({
  message: z.string(),
  /** Where in the file, from 1. */
  line: z.number().optional(),
});
export type DashboardProblem = z.infer<typeof dashboardProblemSchema>;

/** A dashboard file that Med found. */
export const dashboardEntrySchema = z.object({
  /** Its address in Med: /dashboards/<id>. */
  id: z.string(),
  path: z.string(),
  /** "Personal", or the repository's name. */
  where: z.string(),
  /** Its path inside where it is. */
  relative: z.string(),
  title: z.string(),
  description: z.string().optional(),
  views: z.number(),
  panels: z.number(),
  /** The file's first problem, when it has one. */
  problem: z.string().optional(),
  modified: z.number(),
});
export type DashboardEntry = z.infer<typeof dashboardEntrySchema>;

export const dashboardFileSchema = z.object({
  entry: dashboardEntrySchema,
  /** The file as written. */
  text: z.string(),
  /** What Med could read; a file with problems may still draw. */
  dashboard: dashboardSchema.optional(),
  problems: z.array(dashboardProblemSchema),
});
export type DashboardFile = z.infer<typeof dashboardFileSchema>;

/** What `med dashboard check` read for one panel. */
export const panelCheckSchema = z.object({
  view: z.string(),
  /** Its place in the view, from 1. */
  index: z.number(),
  line: z.number().optional(),
  title: z.string(),
  type: z.string(),
  status: z.enum(["ok", "error", "text"]),
  /** Where its data came from: a source's base, Grafana, a file, rows. */
  from: z.string().optional(),
  link: z.string().optional(),
  error: z.string().optional(),
  /** What it drew, in a line: the lines or bars, their span, and values. */
  summary: z.string().optional(),
  warnings: z.array(z.string()),
  /** What the source said about its data: its chart's notes. */
  notes: z.array(z.string()).optional(),
  /** How long its read took, in milliseconds. */
  ms: z.number().optional(),
});
export type PanelCheck = z.infer<typeof panelCheckSchema>;

export const dashboardCheckSchema = z.object({
  path: z.string(),
  id: z.string().optional(),
  title: z.string(),
  problems: z.array(dashboardProblemSchema),
  /** The values each input took. */
  values: z.record(z.string(), z.string()),
  panels: z.array(panelCheckSchema),
});
export type DashboardCheck = z.infer<typeof dashboardCheckSchema>;

/** What a Med window shows on a dashboard, or showed last: the window that
 * the reader uses tells the host, so `med dashboard` names it, and an agent
 * changes what the reader sees. */
export const shownDashboardSchema = z.object({
  id: z.string().min(1).max(2048),
  /** As the address has them: the inputs, `from` and `to`, and `view`. */
  values: z.record(z.string(), z.string().max(4096)),
  /** On screen now; false once the window shows something else. */
  showing: z.boolean(),
  at: z.number(),
});
export type ShownDashboard = z.infer<typeof shownDashboardSchema>;

export const dashboardRoutes = {
  /** The dashboards in the repositories Med knows and in the dashboards
   * folder beside its settings. */
  list: {
    method: "GET",
    path: "/api/dashboards",
    input: z.object({}),
    output: z.object({ folder: z.string(), dashboards: z.array(dashboardEntrySchema) }),
  },
  /** One dashboard's file, and what Med reads in it. */
  read: {
    method: "POST",
    path: "/api/dashboards/read",
    input: z.object({ id: z.string().min(1).max(2048) }),
    output: dashboardFileSchema,
  },
  /** Reads each panel of a dashboard, by its id or a path to its file, as its
   * page would, and says what each drew. Every source runs again. */
  check: {
    method: "POST",
    path: "/api/dashboards/check",
    input: z.object({
      id: z.string().max(2048).optional(),
      path: z.string().max(4096).optional(),
      /** Input values, the range as `from` and `to` (relative times or
       * milliseconds) or as words in `range` (time-range.ts reads them),
       * and the view (`view`). */
      values: z.record(z.string(), z.string().max(4096)).optional(),
    }),
    output: dashboardCheckSchema,
  },
  /** A window says what it shows on a dashboard, or that it left one. */
  report: {
    method: "POST",
    path: "/api/dashboards/report",
    input: shownDashboardSchema.omit({ at: true }),
    output: z.object({}),
  },
  /** The dashboard that a window shows, or showed last. */
  shown: {
    method: "GET",
    path: "/api/dashboards/shown",
    input: z.object({}),
    output: z.object({ shown: shownDashboardSchema.optional() }),
  },
  /** Shows a dashboard, with these values, in the Med window used last. */
  show: {
    method: "POST",
    path: "/api/dashboards/show",
    input: z.object({
      id: z.string().min(1).max(2048),
      values: z.record(z.string(), z.string().max(4096)),
    }),
    /** The windows that heard it; with none, the CLI opens the browser. */
    output: z.object({ windows: z.number(), path: z.string() }),
  },
} as const satisfies Record<string, RouteContract>;

/** The address's names that are not inputs. */
const PAGE_KEYS = new Set(["from", "to", "view"]);

/** A dashboard's address in Med, with its values: /dashboards/<id>?var-env=
 * staging&from=now-6h&to=now&view=Errors, as Grafana writes its own. */
export function dashboardPath(id: string, values: Record<string, string> = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values))
    params.set(PAGE_KEYS.has(key) ? key : `var-${key}`, value);
  const search = params.toString();
  return `/dashboards/${id.split("/").map(encodeURIComponent).join("/")}${search ? `?${search}` : ""}`;
}

/** The values an address gives: each var-<name>, from, to, and view. */
export function valuesOfSearch(search: string) {
  const values: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(search))
    if (key.startsWith("var-")) values[key.slice(4)] = value;
    else if (PAGE_KEYS.has(key)) values[key] = value;
  return values;
}

/**
 * Each input's value: the one given when it is allowed, else its default. A
 * dashboard with a time picker gives `from` and `to` too, from the range
 * given (as `from` and `to`, or words in `range`) or its first one; a moment
 * reaches the panels as an ISO time.
 */
export function inputValues(
  dashboard: Pick<Dashboard, "inputs" | "range">,
  given: Record<string, string | undefined>,
  now = Date.now(),
): { values: Record<string, string>; problems: string[]; range?: TimeRange } {
  const values: Record<string, string> = {};
  const problems: string[] = [];
  for (const input of dashboard.inputs) {
    const value = given[input.name];
    if (value === undefined) values[input.name] = input.default;
    else if (input.type === "choice" && input.options && !input.options.includes(value)) {
      problems.push(`${input.name} takes one of ${input.options.join(", ")}, not "${value}".`);
      values[input.name] = input.default;
    } else if (input.pattern && !new RegExp(`^(?:${input.pattern})$`).test(value)) {
      problems.push(`${input.name} must match ${input.pattern}, not "${value}".`);
      values[input.name] = input.default;
    } else values[input.name] = value;
  }
  const first = dashboard.range !== undefined ? firstRange(dashboard.range) : null;
  if (!first) return { values, problems };
  let range = first;
  if (given.range !== undefined) {
    const read = parseRange(given.range, now);
    if ("range" in read) range = read.range;
    else problems.push(read.error);
  } else if (given.from !== undefined || given.to !== undefined) {
    const asked = { from: given.from ?? first.from, to: given.to ?? "now" };
    if (resolveRange(asked, now)) range = asked;
    else
      problems.push(
        `The range runs from a time to a later one, as now-6h to now, not ${asked.from} to ${asked.to}.`,
      );
  }
  values.from = timeValue(range.from);
  values.to = timeValue(range.to);
  return { values, problems, range };
}

/** `text` with each `${name}` as its value, and the names that have none. */
export function substitute(text: string, values: Record<string, string>) {
  const unknown: string[] = [];
  const result = text.replace(/\$\{\s*([A-Za-z][\w-]*)\s*\}/g, (whole, name: string) => {
    if (name in values) return values[name]!;
    unknown.push(name);
    return whole;
  });
  return { text: result, unknown };
}

/** A chart panel as a chart block's text, with the inputs' values in it.
 * A live dashboard's charts are live unless one says otherwise. */
export function panelChartText(
  panel: Extract<DashboardPanel, { kind: "chart" }>,
  values: Record<string, string>,
  live: boolean,
) {
  const unknown = new Set<string>();
  const lines = panel.keys.map(([key, value]) => {
    const resolved = substitute(value, values);
    for (const name of resolved.unknown) unknown.add(name);
    return `${key}: ${resolved.text.replace(/\s*\n\s*/g, " ")}`;
  });
  if (live && !panel.keys.some(([key]) => key === "live")) lines.push("live: yes");
  const rows = panel.rows !== undefined ? substitute(panel.rows, values) : undefined;
  for (const name of rows?.unknown ?? []) unknown.add(name);
  return {
    text: rows ? `${lines.join("\n")}\n\n${rows.text}` : lines.join("\n"),
    unknown: [...unknown],
  };
}

/** A panel's title, for lists and checks. */
export function panelTitle(panel: DashboardPanel) {
  if (panel.kind === "text") {
    // Its first line as it reads: no heading marks, emphasis, or link targets.
    const line = panel.text
      .split("\n", 1)[0]!
      .replace(/^#+\s*/, "")
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/[*_`]/g, "")
      .trim();
    if (line.length <= 60) return line;
    const cut = line.slice(0, 60);
    return `${cut.slice(0, cut.lastIndexOf(" ") > 30 ? cut.lastIndexOf(" ") : 60)}…`;
  }
  const title = panel.keys.find(([key]) => key === "title")?.[1];
  const link = panel.keys.find(([key]) => key === "link" || key === "grafana" || key === "file");
  return title ?? link?.[1] ?? "Chart";
}

/** A panel's chart type: line, bars, stat, or table. */
export const panelType = (panel: DashboardPanel) =>
  panel.kind === "text"
    ? "text"
    : (panel.keys.find(([key]) => key === "type")?.[1]?.toLowerCase() ?? "chart");
