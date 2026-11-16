// The numbers behind a chart: its scales, ticks, labels, and paths. Pure, so
// the chart, its copies, and the tests share them.

/** A time in milliseconds and its value; null is a gap, as Grafana sends one. */
export type Point = readonly [time: number, value: number | null];

export interface Series {
  name: string;
  points: readonly Point[];
}

/** An event on the time axis, such as a deploy. */
export interface Mark {
  at: number;
  label: string;
}

/** A level that matters, such as an SLO. */
export interface Threshold {
  value: number;
  label: string;
}

/** What a time chart shows, as the agent's block describes it. */
export interface LineChartSpec {
  /** The point of the chart, in a sentence: "p99 tripled after the deploy". */
  title: string;
  /** What is measured, and in what. */
  subtitle?: string;
  unit?: string;
  marks?: readonly Mark[];
  threshold?: Threshold;
  /** Series of one measure (p50, p95, p99) take one hue in steps. */
  ramp?: boolean;
  scale?: "linear" | "log";
}

export interface Bar {
  label: string;
  value: number;
  /** The one the chart is about, such as this branch. */
  highlight?: boolean;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** A number with at most `digits` decimals, and none that are zero. */
function trim(value: number, digits: number) {
  return Number(value.toFixed(digits)).toLocaleString("en-US", {
    maximumFractionDigits: digits,
  });
}

/** 1.2k, 34M: a count in a few characters. */
function compact(value: number, digits: number) {
  const size = Math.abs(value);
  for (const [step, suffix] of [
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "k"],
  ] as const)
    if (size >= step) return `${trim(value / step, size >= step * 100 ? 0 : digits)}${suffix}`;
  return trim(value, size >= 100 ? 0 : size >= 10 ? Math.min(digits, 1) : digits);
}

/**
 * A value as the chart writes it. An axis label is short and leaves out a
 * count's unit, which the subtitle names; a readout is exact and names it.
 */
export function formatValue(value: number, unit = "", axis = false): string {
  if (axis && value === 0) return "0";
  const digits = axis ? 1 : 2;
  if (unit === "ms")
    return Math.abs(value) >= 1000
      ? `${trim(value / 1000, digits)} s`
      : `${trim(value, Math.abs(value) < 10 ? 1 : 0)} ms`;
  if (unit === "s") return `${trim(value, digits)} s`;
  if (unit === "%") return `${trim(value, Math.abs(value) < 10 ? 1 : 0)}%`;
  if (unit === "B") {
    const sizes = ["B", "kB", "MB", "GB", "TB"];
    let size = Math.abs(value);
    let index = 0;
    while (size >= 1000 && index < sizes.length - 1) {
      size /= 1000;
      index++;
    }
    return `${trim(Math.sign(value) * size, index ? digits - 1 : 0)} ${sizes[index]}`;
  }
  const number = compact(value, digits);
  return axis || !unit ? number : `${number} ${unit}`;
}

export interface Domain {
  min: number;
  max: number;
  ticks: number[];
}

/**
 * A linear axis around `min`..`max`, ending on round values. Values that are
 * all positive and spread far from zero start at zero, so a doubling looks
 * like one.
 */
export function linearDomain(min: number, max: number, count = 4): Domain {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1, ticks: [0, 1] };
  if (max === min) max = min === 0 ? 1 : min + Math.abs(min) * 0.5;
  const low = min >= 0 && min < max * 0.6 ? 0 : min - (max - min) * 0.08;
  // The round step (1, 2, 2.5, or 5 times a power of ten) that gives nearest
  // `count` intervals, and of those the one that ends nearest the values.
  const power = 10 ** Math.floor(Math.log10((max - low) / count));
  let best = { step: power, intervals: Infinity, over: Infinity };
  for (const factor of [0.5, 1, 2, 2.5, 5, 10]) {
    const step = factor * power;
    const intervals = Math.ceil(max / step - 1e-9) - Math.floor(low / step + 1e-9);
    const over = Math.ceil(max / step - 1e-9) * step - max;
    const miss = Math.abs(intervals - count);
    const bestMiss = Math.abs(best.intervals - count);
    if (miss < bestMiss || (miss === bestMiss && over < best.over))
      best = { step, intervals, over };
  }
  const step = best.step;
  const from = Math.floor(low / step + 1e-9) * step;
  const to = Math.ceil(max / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let tick = from; tick <= to + step / 2; tick += step)
    ticks.push(Number(tick.toPrecision(12)));
  return { min: from, max: to, ticks };
}

/**
 * A log axis around `min`..`max` (as exponents of ten), a little wider than
 * the values. Ticks are the decades, with 2 and 5 between them when the axis
 * spans few decades.
 */
export function logDomain(min: number, max: number): Domain {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= 0)
    return { min: 0, max: 1, ticks: [1, 10] };
  let low = Math.log10(Math.max(min, 1e-9));
  let high = Math.log10(Math.max(max, 1e-9));
  if (high - low < 1) {
    const middle = (high + low) / 2;
    low = middle - 0.5;
    high = middle + 0.5;
  }
  const pad = (high - low) * 0.06;
  low -= pad;
  high += pad;
  const steps = high - low <= 2.6 ? [1, 2, 5] : [1];
  const ticks: number[] = [];
  for (let decade = Math.floor(low); decade <= Math.ceil(high); decade++)
    for (const step of steps) {
      const value = Number((step * 10 ** decade).toPrecision(12));
      const exponent = Math.log10(value);
      if (exponent >= low - 1e-9 && exponent <= high + 1e-9) ticks.push(value);
    }
  return { min: low, max: high, ticks };
}

/** The extent of the values between two times, with a point beyond each end. */
export function extent(series: readonly Series[], from: number, to: number) {
  let min = Infinity;
  let max = -Infinity;
  let positive = Infinity;
  for (const { points } of series) {
    const start = Math.max(0, nearestIndex(points, from) - 1);
    const end = Math.min(points.length - 1, nearestIndex(points, to) + 1);
    for (let index = start; index <= end; index++) {
      const value = points[index]![1];
      if (value === null) continue;
      if (value < min) min = value;
      if (value > max) max = value;
      if (value > 0 && value < positive) positive = value;
    }
  }
  return { min, max, positive };
}

/** The index of the point nearest `time`; points are in time order. */
export function nearestIndex(points: readonly Point[], time: number) {
  let low = 0;
  let high = points.length - 1;
  if (high < 0) return -1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (points[middle]![0] < time) low = middle + 1;
    else high = middle;
  }
  if (low > 0 && Math.abs(points[low - 1]![0] - time) <= Math.abs(points[low]![0] - time))
    return low - 1;
  return low;
}

const TIME_STEPS = [
  SECOND,
  5 * SECOND,
  15 * SECOND,
  30 * SECOND,
  MINUTE,
  2 * MINUTE,
  5 * MINUTE,
  10 * MINUTE,
  15 * MINUTE,
  30 * MINUTE,
  HOUR,
  2 * HOUR,
  3 * HOUR,
  6 * HOUR,
  12 * HOUR,
  DAY,
  2 * DAY,
  7 * DAY,
  14 * DAY,
  30 * DAY,
];

/** Round times between `from` and `to`, about `gap` pixels apart, on the
 * local clock: hours on the hour, days at midnight. */
export function timeTicks(from: number, to: number, width: number, gap = 88) {
  const span = to - from;
  const step =
    TIME_STEPS.find((candidate) => (span / candidate) * gap <= width) ?? TIME_STEPS.at(-1)!;
  const ticks: number[] = [];
  const offset = new Date(from).getTimezoneOffset() * MINUTE;
  for (let tick = Math.ceil((from - offset) / step) * step + offset; tick <= to; tick += step)
    ticks.push(tick);
  return { ticks, step };
}

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (value: number) => String(value).padStart(2, "0");

/** A tick's label: the time of day, or the date at midnight and for days. */
export function formatTick(time: number, step: number) {
  const date = new Date(time);
  if (step >= DAY || (date.getHours() === 0 && date.getMinutes() === 0 && step >= HOUR))
    return `${months[date.getMonth()]} ${date.getDate()}`;
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return step < MINUTE ? `${clock}:${pad(date.getSeconds())}` : clock;
}

/** A moment, as the readout writes it: seconds when the points are seconds apart. */
export function formatMoment(time: number, spacing: number, withDate = false) {
  const date = new Date(time);
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}${spacing < MINUTE ? `:${pad(date.getSeconds())}` : ""}`;
  return withDate ? `${months[date.getMonth()]} ${date.getDate()}, ${clock}` : clock;
}

/** A range that ends now, as Grafana names it: "Last 24 hours". */
export function formatSpan(span: number) {
  if (span < 2 * HOUR) return `Last ${Math.round(span / MINUTE)} minutes`;
  if (span <= 2 * DAY) return `Last ${Math.round(span / HOUR)} hours`;
  return `Last ${Math.round(span / DAY)} days`;
}

/** A time range as a footer writes it: "09:00–12:00" on one day. */
export function formatRange(from: number, to: number, now = Date.now()) {
  const start = new Date(from);
  const end = new Date(to);
  const sameDay = start.toDateString() === end.toDateString();
  const today = end.toDateString() === new Date(now).toDateString();
  const day = (date: Date) => `${months[date.getMonth()]} ${date.getDate()}`;
  const clock = (date: Date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (sameDay) return `${today ? "Today" : day(start)} ${clock(start)}–${clock(end)}`;
  return `${day(start)} ${clock(start)} – ${day(end)} ${clock(end)}`;
}

/**
 * An SVG path through the points, with a gap where a value is missing. Many
 * points to a pixel keep their first, lowest, highest, and last, so a spike
 * stays and the path stays short.
 */
export function linePath(
  points: readonly Point[],
  x: (time: number) => number,
  y: (value: number) => number,
) {
  let path = "";
  let pen = false;
  let column = NaN;
  let low = 0;
  let high = 0;
  let last = 0;
  let lastX = 0;
  const flush = () => {
    if (Number.isNaN(column)) return;
    path += `L${lastX.toFixed(1)},${low.toFixed(1)}L${lastX.toFixed(1)},${high.toFixed(1)}L${lastX.toFixed(1)},${last.toFixed(1)}`;
  };
  for (const [time, value] of points) {
    if (value === null) {
      if (low !== high || last !== low) flush();
      column = NaN;
      pen = false;
      continue;
    }
    const px = x(time);
    const py = y(value);
    if (!pen) {
      path += `M${px.toFixed(1)},${py.toFixed(1)}`;
      pen = true;
      column = Math.round(px);
      low = high = last = py;
      lastX = px;
      continue;
    }
    if (Math.round(px) === column) {
      low = Math.min(low, py);
      high = Math.max(high, py);
      last = py;
      lastX = px;
      continue;
    }
    if (low !== high || last !== low) flush();
    path += `L${px.toFixed(1)},${py.toFixed(1)}`;
    column = Math.round(px);
    low = high = last = py;
    lastX = px;
  }
  if (pen && (low !== high || last !== low)) flush();
  return path;
}

/** The area under a line path, down to `base`, for each run without a gap. */
export function areaPath(line: string, base: number) {
  return line
    .split("M")
    .filter(Boolean)
    .map((run) => {
      const first = run.split(/[L,]/)[0];
      const coordinates = run.match(/-?\d+(\.\d+)?,-?\d+(\.\d+)?/g)!;
      const lastX = coordinates.at(-1)!.split(",")[0];
      return `M${first},${base.toFixed(1)}L${run}L${lastX},${base.toFixed(1)}Z`;
    })
    .join("");
}

/** The points as CSV, a column for each series, for Copy as CSV. */
export function seriesCsv(series: readonly Series[]) {
  const times = [...new Set(series.flatMap(({ points }) => points.map(([time]) => time)))].sort(
    (a, b) => a - b,
  );
  const lookups = series.map(({ points }) => new Map(points.map(([time, value]) => [time, value])));
  const quote = (text: string) => (/[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text);
  return [
    ["time", ...series.map(({ name }) => quote(name))].join(","),
    ...times.map((time) =>
      [new Date(time).toISOString(), ...lookups.map((lookup) => lookup.get(time) ?? "")].join(","),
    ),
  ].join("\n");
}
