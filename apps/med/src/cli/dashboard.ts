import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { clientPort, getStateDirectory, readConnection } from "../host/runtime/connection";
import {
  DASHBOARD_SUFFIX,
  dashboardRoutes,
  type DashboardCheck,
  type PanelCheck,
} from "../shared/dashboards";
import { UsageError } from "./exit-status";
import { request } from "./review";

export const dashboardHelp = `Usage: med dashboard                      List the dashboards Med finds
       med dashboard check <file|id> [--set name=value]… [--range now-6h]
                       [--view <name>] [--json]
                                          Read every panel, and say what each drew
       med dashboard link <file|id>       Print the link that opens it in Med
Options: --port <port> (or MED_PORT), --state-dir <path> (or MED_STATE_DIR)

A dashboard is a YAML file, <name>${DASHBOARD_SUFFIX}, that opens as its own page in Med,
as an Obsidian Base does: inputs, views as tabs, and panels whose data chart
sources print. Med finds them in the repositories it knows, and in the
dashboards folder beside its settings. med docs dashboards has the format.

check reads each panel through the same chart sources the page uses, running
each again, and prints a line on what it drew: its lines or bars, their span,
and their values, or why it failed. It exits 1 when a panel fails or the file
has a problem, so an agent can write, check, and fix until it passes.`;

const mark = (panel: PanelCheck) =>
  panel.status === "error"
    ? "✗"
    : panel.status === "text"
      ? "·"
      : panel.warnings.length
        ? "!"
        : "✓";

/** The check as an agent reads it: a line a panel, with what it drew. */
export function describeCheck(check: DashboardCheck, link?: string) {
  const lines: string[] = [`${check.title}  ${check.path}`];
  const values = Object.entries(check.values);
  if (values.length)
    lines.push(`Inputs: ${values.map(([name, value]) => `${name}=${value}`).join("  ")}`);
  for (const problem of check.problems)
    lines.push(`✗ ${problem.line !== undefined ? `Line ${problem.line}: ` : ""}${problem.message}`);
  let view = "";
  for (const panel of check.panels) {
    if (panel.view !== view) {
      view = panel.view;
      lines.push("", view);
    }
    const where = [panel.type, panel.line !== undefined ? `line ${panel.line}` : ""]
      .filter(Boolean)
      .join(", ");
    const head = `  ${mark(panel)} ${panel.index}. ${panel.title} (${where})`;
    if (panel.status === "text") {
      lines.push(head);
      continue;
    }
    lines.push(
      `${head}${panel.from ? ` from ${panel.from}` : ""}${panel.ms !== undefined ? `, ${(panel.ms / 1000).toFixed(1)} s` : ""}`,
    );
    if (panel.error) lines.push(`      ${panel.error}`);
    if (panel.summary) lines.push(`      ${panel.summary}`);
    for (const note of panel.notes ?? []) lines.push(`      Note: ${note}`);
    for (const warning of panel.warnings) lines.push(`      ! ${warning}`);
  }
  const charts = check.panels.filter((panel) => panel.status !== "text");
  const failed = charts.filter((panel) => panel.status === "error").length;
  const warned = charts.filter((panel) => panel.status === "ok" && panel.warnings.length).length;
  lines.push(
    "",
    `${charts.length} chart${charts.length === 1 ? "" : "s"}: ${charts.length - failed} drew, ${failed} failed${warned ? `, ${warned} with warnings` : ""}${check.problems.length ? `; ${check.problems.length} problem${check.problems.length === 1 ? "" : "s"} in the file` : ""}.`,
  );
  if (link) lines.push(`[Open the dashboard in Med](${link})`);
  return lines.join("\n");
}

/** `med dashboard`: the dashboards, through the running server. */
export async function runDashboardCommand(args: string[], print = console.log) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      set: { type: "string", multiple: true },
      range: { type: "string" },
      view: { type: "string" },
      json: { type: "boolean" },
      port: { type: "string" },
      "state-dir": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    print(dashboardHelp);
    return;
  }
  const [action = "list", target] = positionals;
  const valid =
    (action === "list" && positionals.length <= 1) ||
    ((action === "check" || action === "link") && positionals.length === 2);
  if (!valid) throw new UsageError(dashboardHelp);
  const stateDir = getStateDirectory(values["state-dir"]);
  const connection = await readConnection(stateDir, await clientPort(stateDir, values.port));
  const call = (route: { path: string }, body?: unknown) =>
    request(connection, route.path, fetch, body);
  const list = dashboardRoutes.list.output.parse(await call(dashboardRoutes.list));
  const linkOf = (id: string) =>
    new URL(`/dashboards/${id.split("/").map(encodeURIComponent).join("/")}`, connection.origin)
      .href;

  if (action === "list") {
    if (values.json) return print(JSON.stringify(list, null, 2));
    if (!list.dashboards.length)
      return print(
        `No dashboards yet. Write one as <name>${DASHBOARD_SUFFIX} in a repository, or in ${list.folder}. med docs dashboards has the format.`,
      );
    for (const entry of list.dashboards)
      print(
        `${entry.id}  ${entry.title}  ${entry.panels} panel${entry.panels === 1 ? "" : "s"}${entry.problem ? `  ✗ ${entry.problem}` : ""}\n  ${entry.path}`,
      );
    return;
  }
  // A target is a file, or the id that the list gives.
  const file = target!.endsWith(DASHBOARD_SUFFIX) ? resolve(target!) : undefined;
  const entry = list.dashboards.find((item) => (file ? item.path === file : item.id === target));
  if (!file && !entry)
    throw new UsageError(
      `Med has no dashboard ${target}. Name its file (…${DASHBOARD_SUFFIX}), or an id from med dashboard.`,
    );
  if (action === "link") {
    if (!entry)
      throw new UsageError(
        `Med does not find ${file} yet: keep dashboards in a repository Med knows, or in ${list.folder}.`,
      );
    return print(`[${entry.title}](${linkOf(entry.id)})`);
  }
  const given: Record<string, string> = {};
  for (const pair of values.set ?? []) {
    const equals = pair.indexOf("=");
    if (equals < 1) throw new UsageError(`--set takes name=value, not ${pair}.`);
    given[pair.slice(0, equals)] = pair.slice(equals + 1);
  }
  if (values.range) given.range = values.range;
  if (values.view) given.view = values.view;
  const check = dashboardRoutes.check.output.parse(
    await call(dashboardRoutes.check, {
      ...(entry ? { id: entry.id } : { path: file }),
      values: given,
    }),
  );
  if (values.json) print(JSON.stringify(check, null, 2));
  else {
    print(describeCheck(check, entry ? linkOf(entry.id) : undefined));
    if (!entry)
      print(
        `Med does not list this file: keep dashboards in a repository Med knows, or in ${list.folder}.`,
      );
  }
  if (check.problems.length || check.panels.some((panel) => panel.status === "error"))
    process.exitCode = 1;
}
