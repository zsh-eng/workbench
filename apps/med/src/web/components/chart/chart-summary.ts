import { cellTime, parseCsv, type ChartData } from "./chart-block";
import { formatValue, type Series } from "./chart-model";

// What a chart's data comes to, without drawing it: a stat panel's one
// number, a table panel's rows, and the line that `med dashboard check`
// prints for a panel. Pure, so the page and the server agree.

export type Reduce = "last" | "first" | "sum" | "mean" | "max" | "min";
export const REDUCES: readonly Reduce[] = ["last", "first", "sum", "mean", "max", "min"];

const present = (series: Series) =>
  series.points.flatMap(([, value]) => (value === null ? [] : [value]));

function reduce(values: readonly number[], how: Reduce): number | null {
  if (!values.length) return null;
  if (how === "first") return values[0]!;
  if (how === "last") return values.at(-1)!;
  if (how === "max") return Math.max(...values);
  if (how === "min") return Math.min(...values);
  const sum = values.reduce((total, value) => total + value, 0);
  return how === "sum" ? sum : sum / values.length;
}

export interface Stat {
  value: number | null;
  /** Its name: the line's or the bar's. */
  label?: string;
  /** The change over the range, as a fraction, for the last value. */
  change: number | null;
  /** The line it comes from, for a sparkline. */
  points: readonly (number | null)[];
  /** Each point's time, for a dashboard's shared cursor. */
  times?: readonly number[];
}

/** A stat panel's number: the first line's last value (or its sum, mean…),
 * or the first bar's value (or the bars' sum…). */
export function statOf(data: ChartData, how: Reduce = "last"): Stat {
  if (data.kind === "bars") {
    const values = data.bars.map((bar) => bar.value);
    return {
      value: how === "last" || how === "first" ? (values[0] ?? null) : reduce(values, how),
      ...(data.bars[0] && (how === "last" || how === "first") ? { label: data.bars[0].label } : {}),
      change: null,
      points: [],
    };
  }
  if (data.kind !== "line" || !data.series[0]) return { value: null, change: null, points: [] };
  const series = data.series[0];
  const values = present(series);
  const first = values[0];
  const last = values.at(-1);
  return {
    value: reduce(values, how),
    label: series.name,
    change:
      how === "last" &&
      first !== undefined &&
      last !== undefined &&
      first !== 0 &&
      values.length > 1
        ? (last - first) / Math.abs(first)
        : null,
    points: series.points.map(([, value]) => value),
    times: series.points.map(([time]) => time),
  };
}

export interface Table {
  columns: string[];
  rows: string[][];
  /** The columns whose cells are all numbers, which sort and align as numbers. */
  numeric: boolean[];
  /** The columns of times, which show as dates and sort as times. */
  times?: boolean[];
}

const isNumber = (cell: string) =>
  cell !== "" && Number.isFinite(Number(cell.replace(/[,_\s%]/g, "")));

/** Rows of CSV or JSON as a table, as they came. */
export function tableOf(text: string): Table | { error: string } {
  const trimmed = text.trim();
  let grid: string[][];
  if (trimmed.startsWith("[")) {
    try {
      const list = JSON.parse(trimmed) as Record<string, unknown>[];
      const columns = [...new Set(list.flatMap((entry) => Object.keys(entry ?? {})))];
      grid = [
        columns,
        ...list.map((entry) =>
          columns.map((column) => {
            const cell = entry?.[column];
            return cell === null || cell === undefined
              ? ""
              : typeof cell === "object"
                ? JSON.stringify(cell)
                : String(cell);
          }),
        ),
      ];
    } catch {
      return { error: "The JSON is not a list of rows." };
    }
  } else grid = parseCsv(trimmed);
  const [columns, ...rows] = grid;
  if (!columns?.length) return { error: "The rows hold no data." };
  const filled = (index: number) => rows.some((row) => !!row[index]);
  // A column of times: dates, or numbers since 1970 under a time's name.
  const times = columns.map(
    (name, index) =>
      rows.length > 0 &&
      filled(index) &&
      rows.every((row) => !row[index] || cellTime(row[index]!) !== null) &&
      (/^(?:time|date|day|timestamp|at|when|published)$/i.test(name.trim()) ||
        rows.every((row) => !row[index] || /^\d{4}-\d{2}-\d{2}/.test(row[index]!))),
  );
  const numeric = columns.map(
    (_, index) =>
      !times[index] &&
      rows.length > 0 &&
      rows.every((row) => !row[index] || isNumber(row[index]!)) &&
      filled(index),
  );
  return { columns, rows, numeric, times };
}

/** A chart's data as a table: a time and a column a line, or a label and a
 * value a row. */
export function tableFromData(data: ChartData): Table | { error: string } {
  if (data.kind === "error") return { error: data.error };
  if (data.kind === "bars")
    return {
      columns: ["", "value"],
      rows: data.bars.map((bar) => [bar.label, String(bar.value)]),
      numeric: [false, true],
    };
  const times = [
    ...new Set(data.series.flatMap((series) => series.points.map(([time]) => time))),
  ].sort((a, b) => a - b);
  return {
    columns: ["time", ...data.series.map((series) => series.name)],
    rows: times.map((time) => [
      new Date(time).toISOString(),
      ...data.series.map((series) => {
        const value = series.points.find(([at]) => at === time)?.[1];
        return value === null || value === undefined ? "" : String(value);
      }),
    ]),
    numeric: [false, ...data.series.map(() => true)],
    times: [true, ...data.series.map(() => false)],
  };
}

const clock = (at: number) =>
  new Date(at).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

/** A line on what a chart drew, for an agent that cannot see it: its lines
 * or bars, their span, and their values. */
export function summarize(data: ChartData, unit?: string) {
  const value = (number: number) => formatValue(number, unit);
  if (data.kind === "error") return data.error;
  if (data.kind === "bars") {
    const shown = data.bars
      .slice(0, 6)
      .map((bar) => `${bar.label} ${value(bar.value)}`)
      .join(", ");
    return `${data.bars.length} bar${data.bars.length === 1 ? "" : "s"}: ${shown}${data.bars.length > 6 ? ", …" : ""}`;
  }
  const times = data.series.flatMap((series) => series.points.map(([time]) => time));
  const points = Math.max(0, ...data.series.map((series) => series.points.length));
  const span = times.length ? `${clock(Math.min(...times))} – ${clock(Math.max(...times))}` : "";
  const lines = data.series.slice(0, 5).map((series) => {
    const values = present(series);
    if (!values.length) return `${series.name} has no values`;
    return `${series.name} last ${value(values.at(-1)!)}, min ${value(Math.min(...values))}, max ${value(Math.max(...values))}`;
  });
  return [
    `${data.series.length} line${data.series.length === 1 ? "" : "s"}, ${points} points${span ? `, ${span}` : ""}`,
    ...lines,
  ].join("; ");
}

/** What looks wrong in a chart's data, though it drew. */
export function dataWarnings(data: ChartData): string[] {
  if (data.kind === "bars") return data.bars.length ? [] : ["It has no bars."];
  if (data.kind !== "line") return [];
  const warnings: string[] = [];
  if (!data.series.length) warnings.push("It has no lines.");
  for (const series of data.series) {
    const values = present(series);
    if (!series.points.length) warnings.push(`${series.name} has no points.`);
    else if (!values.length) warnings.push(`${series.name} has only gaps.`);
    else if (series.points.length === 1) warnings.push(`${series.name} has one point.`);
  }
  return warnings;
}

/** A time column's cell as the table shows it: a date, with its time of day
 * when it has one. */
export function timeCell(cell: string) {
  const at = cellTime(cell);
  if (at === null) return cell;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(cell.trim());
  return new Date(at).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    ...(new Date(at).getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}),
    ...(dateOnly ? {} : { hour: "2-digit", minute: "2-digit" }),
  });
}
