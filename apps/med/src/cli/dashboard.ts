import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { clientPort, getStateDirectory, readConnection } from "../host/runtime/connection";
import {
  DASHBOARD_SUFFIX,
  dashboardPath,
  dashboardRoutes,
  inputValues,
  listed,
  type DashboardCheck,
  type PanelCheck,
} from "../shared/dashboards";
import { parseRange, rangeLabel } from "../shared/time-range";
import { UsageError } from "./exit-status";
import { openBrowser, request } from "./review";

export const dashboardHelp = `Usage: med dashboard                      List the dashboards, and the one on screen
       med dashboard open [<id>] [values]    Show it in Med with these values
       med dashboard check [<file|id>] [values] [--json]
                                          Read every panel, and say what each drew
       med dashboard link [<id>] [values]    Print the link that opens it so
Values: --set name=value (each input), --range <words> (6h, yesterday,
        "yesterday 14:00 to 16:30", "since 9:00", now-7d), --from and --to
        (now-6h, now, an ISO time), --view <name>
Options: --port <port> (or MED_PORT), --state-dir <path> (or MED_STATE_DIR)

A dashboard is a YAML file, <name>${DASHBOARD_SUFFIX}, that opens as its own page in Med,
as an Obsidian Base does: inputs, views as tabs, and panels whose data chart
sources print. Med finds them in the repositories it knows, and in the
dashboards folder beside its settings. med docs dashboards has the format.

Without a dashboard, open, check, and link take the one that the reader's
Med window shows, or showed last, with the values it shows: so when the
reader asks for staging, or for yesterday afternoon, open --set env=staging
or open --range "yesterday 12:00 to 18:00" changes only that, on their
screen. Back in Med undoes it.

check reads each panel through the same chart sources the page uses, running
each again, and prints a line on what it drew: its lines or bars, their span,
and their values, or why it failed. It exits 1 when a panel fails or the file
has a problem, so an agent can write, check, and fix until it passes, and can
answer what a dashboard shows in words.`;

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
  const values = valuesLine(check.values);
  if (values) lines.push(`Inputs: ${values}`);
  for (const read of check.options ?? [])
    lines.push(
      `Options of ${read.name}, from ${read.from}: ${listed(read.options, 8)} (${read.options.length})`,
    );
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

/** The values in words: "service=checkout  env=staging  Yesterday". */
function valuesLine(values: Record<string, string>, now = Date.now()) {
  const { from, to, view, ...inputs } = values;
  return [
    ...Object.entries(inputs).map(([name, value]) => `${name}=${value}`),
    ...(from !== undefined ? [rangeLabel({ from, to: to ?? "now" }, now)] : []),
    ...(view ? [`view ${view}`] : []),
  ].join("  ");
}

/** `med dashboard`: the dashboards, through the running server. */
export async function runDashboardCommand(
  args: string[],
  print = console.log,
  openUrl: (url: string) => void = openBrowser,
) {
  const { values: flags, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      set: { type: "string", multiple: true },
      range: { type: "string" },
      from: { type: "string" },
      to: { type: "string" },
      view: { type: "string" },
      json: { type: "boolean" },
      port: { type: "string" },
      "state-dir": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (flags.help) {
    print(dashboardHelp);
    return;
  }
  const [action = "list", target] = positionals;
  const valid =
    (action === "list" && positionals.length <= 1) ||
    ((action === "check" || action === "link" || action === "open") && positionals.length <= 2);
  if (!valid) throw new UsageError(dashboardHelp);
  const stateDir = getStateDirectory(flags["state-dir"]);
  const connection = await readConnection(stateDir, await clientPort(stateDir, flags.port));
  const call = (route: { path: string; method: string }, body?: unknown) =>
    request(connection, route.path, fetch, route.method === "GET" ? undefined : (body ?? {}));
  const list = dashboardRoutes.list.output.parse(await call(dashboardRoutes.list));
  const { shown } = dashboardRoutes.shown.output.parse(
    await call(dashboardRoutes.shown).catch(() => ({})),
  );
  const linkOf = (id: string, values: Record<string, string> = {}) =>
    new URL(dashboardPath(id, values), connection.origin).href;

  if (action === "list") {
    if (flags.json) return print(JSON.stringify({ ...list, ...(shown ? { shown } : {}) }, null, 2));
    if (!list.dashboards.length)
      return print(
        `No dashboards yet. Write one as <name>${DASHBOARD_SUFFIX} in a repository, or in ${list.folder}. med docs dashboards has the format.`,
      );
    if (shown)
      print(
        `${shown.showing ? "On screen" : "Shown last"}: ${shown.id}  ${valuesLine(shown.values)}\n`,
      );
    for (const entry of list.dashboards)
      print(
        `${entry.id}  ${entry.title}  ${entry.panels} panel${entry.panels === 1 ? "" : "s"}${entry.problem ? `  ✗ ${entry.problem}` : ""}\n  ${entry.path}`,
      );
    return;
  }
  // A target is a file, the id that the list gives, or none: the dashboard on screen.
  const named = target ?? shown?.id;
  if (!named)
    throw new UsageError(
      `No Med window shows a dashboard yet, so name one: ${list.dashboards.map((entry) => entry.id).join(", ") || "med dashboard lists them"}.`,
    );
  const file = named.endsWith(DASHBOARD_SUFFIX) ? resolve(named) : undefined;
  const entry = list.dashboards.find((item) => (file ? item.path === file : item.id === named));
  if (!file && !entry)
    throw new UsageError(
      `Med has no dashboard ${named}. Name its file (…${DASHBOARD_SUFFIX}), or an id from med dashboard.`,
    );
  // The values on screen stay unless the command changes them.
  const given: Record<string, string> = entry && shown?.id === entry.id ? { ...shown.values } : {};
  for (const pair of flags.set ?? []) {
    const equals = pair.indexOf("=");
    if (equals < 1) throw new UsageError(`--set takes name=value, not ${pair}.`);
    given[pair.slice(0, equals)] = pair.slice(equals + 1);
  }
  if (flags.range !== undefined) {
    const read = parseRange(flags.range);
    if ("error" in read) throw new UsageError(read.error);
    given.from = read.range.from;
    given.to = read.range.to;
  }
  if (flags.from !== undefined) given.from = flags.from;
  if (flags.to !== undefined) given.to = flags.to;
  if (flags.from !== undefined && flags.to === undefined && flags.range === undefined)
    given.to = "now";
  if (flags.view !== undefined) given.view = flags.view;

  if (action === "check") {
    const check = dashboardRoutes.check.output.parse(
      await call(dashboardRoutes.check, {
        ...(entry ? { id: entry.id } : { path: file }),
        values: given,
      }),
    );
    if (flags.json) print(JSON.stringify(check, null, 2));
    else {
      print(describeCheck(check, entry ? linkOf(entry.id, given) : undefined));
      if (!entry)
        print(
          `Med does not list this file: keep dashboards in a repository Med knows, or in ${list.folder}.`,
        );
    }
    if (check.problems.length || check.panels.some((panel) => panel.status === "error"))
      process.exitCode = 1;
    return;
  }
  if (!entry)
    throw new UsageError(
      `Med does not find ${file} yet: keep dashboards in a repository Med knows, or in ${list.folder}.`,
    );
  // Open and link take only values the dashboard has.
  const read = dashboardRoutes.read.output.parse(
    await call(dashboardRoutes.read, { id: entry.id }),
  );
  const dashboard = read.dashboard;
  if (dashboard) {
    const names = new Set(dashboard.inputs.map((input) => input.name));
    const unknown = Object.keys(given).filter(
      (name) => !names.has(name) && !["from", "to", "view"].includes(name),
    );
    const inputs = dashboard.inputs
      .map((input) =>
        input.options?.length ? `${input.name} (${listed(input.options)})` : input.name,
      )
      .join(", ");
    if (unknown.length)
      throw new UsageError(
        `${dashboard.title} has no input ${unknown.join(", ")}. ${inputs ? `Its inputs: ${inputs}.` : "It has no inputs."}`,
      );
    if ((given.from !== undefined || given.to !== undefined) && dashboard.range === undefined)
      throw new UsageError(`${dashboard.title} has no time picker, so it takes no range.`);
    const { problems } = inputValues(dashboard, given);
    if (problems.length) throw new UsageError(problems.join(" "));
    if (given.view && !dashboard.views.some((view) => view.name === given.view))
      throw new UsageError(
        `${dashboard.title} has no view ${given.view}: ${dashboard.views.map((view) => view.name).join(", ")}.`,
      );
  }
  const title = dashboard?.title ?? entry.title;
  if (action === "link") return print(`[${title}](${linkOf(entry.id, given)})`);
  const shownNow = dashboardRoutes.show.output.parse(
    await call(dashboardRoutes.show, { id: entry.id, values: given }),
  );
  const line = valuesLine(given);
  if (!shownNow.windows) {
    openUrl(`${connection.origin}${shownNow.path}#token=${connection.token}`);
    print(`No Med window was open, so ${title} opened in the browser${line ? `: ${line}` : ""}.`);
  } else print(`Med shows ${title}${line ? `: ${line}` : ""}.`);
  print(`[${title}](${linkOf(entry.id, given)})`);
}
