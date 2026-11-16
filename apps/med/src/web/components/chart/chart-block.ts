import {
  formatValue,
  type Bar,
  type Mark,
  type Point,
  type Series,
  type Threshold,
} from "./chart-model";

// A `chart` block in a reply: lines of `key: value`, then, for data the
// agent has, rows of CSV. The data comes from one of three places:
//
//   grafana: https://grafana.acme.dev/d/abc/checkout?viewPanel=4&from=…&to=…
//   file: bench/results.csv
//   (or CSV rows after the keys)
//
// Other keys: title, subtitle, unit, scale (linear or log), type (line or
// bars), live, from, to, mark (repeatable: "10:42 Deploy v412"), threshold
// ("500 SLO"), highlight (the bar the chart is about).

const KEYS = new Set([
  "grafana",
  "file",
  "title",
  "subtitle",
  "unit",
  "scale",
  "type",
  "live",
  "from",
  "to",
  "mark",
  "threshold",
  "highlight",
]);

export interface ChartBlock {
  source:
    | { kind: "grafana"; link: string; from?: string; to?: string; live: boolean }
    | { kind: "file"; path: string }
    | { kind: "rows"; text: string };
  title?: string;
  subtitle?: string;
  unit?: string;
  scale?: "linear" | "log";
  type?: "line" | "bars";
  /** As written: a time, resolved against the data's range (`markTimes`). */
  marks: { at: string; label: string }[];
  threshold?: { value: number; label?: string };
  highlight?: string;
}

/** A block's text as a chart, or why it is not one. */
export function parseChartBlock(text: string): ChartBlock | { error: string } {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const keys = new Map<string, string>();
  const marks: ChartBlock["marks"] = [];
  let index = 0;
  for (; index < lines.length; index++) {
    const match = /^\s*([a-z]+)\s*:\s*(.*?)\s*$/i.exec(lines[index]!);
    if (!match || !KEYS.has(match[1]!.toLowerCase())) break;
    const key = match[1]!.toLowerCase();
    const value = match[2]!;
    if (key === "mark") {
      const mark = /^(\S+(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)\s+(.+)$/.exec(value);
      if (mark) marks.push({ at: mark[1]!, label: mark[2]! });
    } else keys.set(key, value);
  }
  const rows = lines.slice(index).join("\n").trim();
  const grafana = keys.get("grafana");
  const file = keys.get("file");
  const sources = [grafana, file, rows || undefined].filter(Boolean).length;
  if (sources === 0)
    return { error: "This chart has no data: add a grafana link, a file, or rows of CSV." };
  if (sources > 1) return { error: "A chart takes one of a grafana link, a file, or rows of CSV." };
  const scale = keys.get("scale")?.toLowerCase();
  const type = keys.get("type")?.toLowerCase();
  const threshold = /^(-?[\d.]+)\s*(.*)$/.exec(keys.get("threshold") ?? "");
  const unit = keys.get("unit");
  return {
    source: grafana
      ? {
          kind: "grafana",
          link: grafana,
          ...(keys.get("from") ? { from: keys.get("from") } : {}),
          ...(keys.get("to") ? { to: keys.get("to") } : {}),
          live: /^(?:yes|true|on)$/i.test(keys.get("live") ?? ""),
        }
      : file
        ? { kind: "file", path: file }
        : { kind: "rows", text: rows },
    ...(keys.get("title") ? { title: keys.get("title") } : {}),
    ...(keys.get("subtitle") ? { subtitle: keys.get("subtitle") } : {}),
    ...(unit ? { unit } : {}),
    ...(scale === "log" || scale === "linear" ? { scale } : {}),
    ...(type === "bars" || type === "line" ? { type } : {}),
    marks,
    ...(threshold && Number.isFinite(Number(threshold[1]))
      ? {
          threshold: {
            value: Number(threshold[1]),
            ...(threshold[2] ? { label: threshold[2] } : {}),
          },
        }
      : {}),
    ...(keys.get("highlight") ? { highlight: keys.get("highlight") } : {}),
  };
}

/** Rows of CSV (or tab-separated), with quoted cells as spreadsheets write them. */
export function parseCsv(text: string): string[][] {
  const first = text.split("\n", 1)[0] ?? "";
  const separator = first.includes("\t") && !first.includes(",") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index++;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && !cell) quoted = true;
    else if (char === separator) {
      row.push(cell.trim());
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index++;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

/** A time in a cell: a date, a date and time, or seconds or milliseconds
 * since 1970. Null for anything else. */
export function cellTime(text: string): number | null {
  const value = text.trim();
  if (/^\d{9,10}(?:\.\d+)?$/.test(value)) return Math.round(Number(value) * 1000);
  if (/^\d{12,13}$/.test(value)) return Number(value);
  if (!/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
  const parsed = Date.parse(value.replace(" ", "T"));
  return Number.isNaN(parsed) ? null : parsed;
}

const cellNumber = (text: string) => {
  const value = text.replace(/[,_\s]/g, "");
  if (!value || /^(?:null|nan|-)$/i.test(value)) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

export type ChartData =
  | { kind: "line"; series: Series[] }
  | { kind: "bars"; bars: Bar[] }
  | { kind: "error"; error: string };

/** Rows as a chart's data: a time column and a series a column, or a label
 * and a value a row. JSON in place of CSV is a list of rows as objects. */
export function rowsData(text: string, block: Pick<ChartBlock, "type" | "highlight">): ChartData {
  let rows: string[][];
  const trimmed = text.trim();
  if (trimmed.startsWith("[")) {
    try {
      const list = JSON.parse(trimmed) as Record<string, unknown>[];
      const columns = [...new Set(list.flatMap((entry) => Object.keys(entry ?? {})))];
      rows = [
        columns,
        ...list.map((entry) => columns.map((column) => String(entry?.[column] ?? ""))),
      ];
    } catch {
      return { kind: "error", error: "The JSON is not a list of rows." };
    }
  } else rows = parseCsv(trimmed);
  const [header, ...body] = rows;
  if (!header || !body.length) return { kind: "error", error: "The rows hold no data." };
  const timed = body.every((row) => cellTime(row[0] ?? "") !== null);
  if (block.type === "bars" || (!timed && block.type !== "line")) {
    const bars = body.flatMap((row) => {
      const value = cellNumber(row[1] ?? "");
      return value === null || !row[0]
        ? []
        : [{ label: row[0], value, ...(row[0] === block.highlight ? { highlight: true } : {}) }];
    });
    return bars.length
      ? { kind: "bars", bars }
      : { kind: "error", error: "Each row needs a label, then a number." };
  }
  if (!timed) return { kind: "error", error: "Each row of a line chart starts with a time." };
  const series = header.slice(1).map((name, column) => ({
    name: name || `Series ${column + 1}`,
    points: body
      .map((row): Point => [cellTime(row[0]!)!, cellNumber(row[column + 1] ?? "")])
      .sort((a, b) => a[0] - b[0]),
  }));
  return series.length
    ? { kind: "line", series }
    : { kind: "error", error: "A line chart needs a column for each line, after the time." };
}

/**
 * Marks as written, at times on the chart: a full date and time, or a
 * clock time such as 10:42 on the range's last day (or the day before,
 * when that falls in the range).
 */
export function markTimes(marks: ChartBlock["marks"], range: readonly [number, number]): Mark[] {
  return marks.flatMap(({ at, label }) => {
    const full = cellTime(at);
    if (full !== null) return [{ at: full, label }];
    const clock = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(at);
    if (!clock) return [];
    for (let back = 0; back <= 1; back++) {
      const day = new Date(range[1]);
      day.setDate(day.getDate() - back);
      day.setHours(Number(clock[1]), Number(clock[2]), Number(clock[3] ?? 0), 0);
      const time = day.getTime();
      if (time >= range[0] && time <= range[1]) return [{ at: time, label }];
    }
    return [];
  });
}

/** The block's threshold, labelled with its value when the block names none. */
export function thresholdOf(block: ChartBlock, unit?: string): Threshold | undefined {
  if (!block.threshold) return undefined;
  const value = formatValue(block.threshold.value, unit);
  return {
    value: block.threshold.value,
    label: block.threshold.label ? `${block.threshold.label} ${value}` : value,
  };
}

/** Series of one measure at several percentiles take one hue in steps. */
export const isRamp = (series: readonly { name: string }[]) =>
  series.length > 1 &&
  series.every(({ name }) => /^(?:p\d{1,3}(?:\.\d+)?|0\.\d+|median|min|max|avg|mean)$/i.test(name));
