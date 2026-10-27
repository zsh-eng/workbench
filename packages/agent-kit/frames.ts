/**
 * `kit frames <trace.json>`: the frames of each marked part of a Chrome
 * trace that `kit … --trace` recorded. A part runs from the page's
 * `performance.mark("kit:<name>:start")` to `kit:<name>:end`.
 *
 * Each display frame has one or two of Chrome's frame reports
 * (`PipelineReporter`) in the page's renderer, which together give it a
 * state:
 *
 * - complete: presented with every update it waited for, the page's own
 *   (main thread) included;
 * - behind: presented with the main thread's update for the frame before,
 *   while this frame's is still on its way. Chrome runs so when the main
 *   thread cannot finish a frame in time; motion is a frame late but does
 *   not stop, and Chrome does not count it as a dropped frame;
 * - partial: presented without any main-thread update. Whatever the main
 *   thread moves (a requestAnimationFrame animation) stood still; the
 *   compositor's own scrolling and animations still moved;
 * - dropped: not presented, where Chrome counts it against smoothness;
 * - idle: nothing to update.
 *
 * It prints, per part, the frames from the first to the last update, the
 * frame interval, the longest run without a frame that showed an update,
 * how busy the main thread was, and its tasks longer than a frame, and draws
 * the parts as a PNG strip chart.
 */
import type { BrowserType } from "@playwright/test";

type TraceEvent = {
  name: string;
  ph: string;
  ts: number;
  dur?: number;
  pid: number;
  tid: number;
  args?: {
    frame_reporter?: { state: string; affects_smoothness?: boolean };
  };
};

type FrameState = "complete" | "behind" | "partial" | "dropped" | "idle";

type Part = {
  name: string;
  span: number;
  frames: { at: number; state: FrameState }[];
  tasks: { at: number; ms: number }[];
  interval: number;
  counts: Record<FrameState, number>;
  longestStall: number;
  /** Share of the frames' span that the main thread spent in tasks. */
  busy: number;
};

/** A display frame's state from the states of its reports. */
function frameState(reports: { state: string; smooth: boolean }[]) {
  const has = (state: string) => reports.some((r) => r.state === state);
  const complete = has("STATE_PRESENTED_ALL");
  const partial = has("STATE_PRESENTED_PARTIAL");
  if (complete && partial) return "behind";
  if (complete) return "complete";
  if (partial) return "partial";
  if (reports.some((r) => r.state === "STATE_DROPPED" && r.smooth))
    return "dropped";
  return "idle";
}

export function readParts(json: string): Part[] {
  const events = (JSON.parse(json) as { traceEvents: TraceEvent[] })
    .traceEvents;
  const marks = new Map(
    events
      .filter((event) => event.name?.startsWith("kit:"))
      .map((event) => [event.name, event]),
  );
  const names = [...marks.keys()]
    .filter((name) => name.endsWith(":start"))
    .map((name) => name.slice(4, -6));
  return names.flatMap((name) => {
    const start = marks.get(`kit:${name}:start`)!;
    const end = marks.get(`kit:${name}:end`);
    if (!end) return [];
    const inside = (event: TraceEvent) =>
      event.pid === start.pid && event.ts >= start.ts && event.ts <= end.ts;
    const byTime = new Map<number, { state: string; smooth: boolean }[]>();
    for (const event of events) {
      if (event.name !== "PipelineReporter" || event.ph !== "b") continue;
      const report = event.args?.frame_reporter;
      if (!inside(event) || !report) continue;
      // Reports of one frame share its time to within a few microseconds.
      const at = Math.round(event.ts / 100) * 100;
      const reports = byTime.get(at) ?? [];
      reports.push({
        state: report.state,
        smooth: !!report.affects_smoothness,
      });
      byTime.set(at, reports);
    }
    const all = [...byTime]
      .sort(([a], [b]) => a - b)
      .map(([at, reports]) => ({
        at: (at - start.ts) / 1000,
        state: frameState(reports) as FrameState,
      }));
    const busy = all.filter((frame) => frame.state !== "idle");
    const first = busy[0]?.at ?? 0;
    const last = busy.at(-1)?.at ?? 0;
    const frames = all.filter((frame) => frame.at >= first && frame.at <= last);
    const gaps = all.slice(1).map((frame, i) => frame.at - all[i]!.at);
    const interval = median(gaps.filter((gap) => gap > 1)) || 16.7;
    const counts = { complete: 0, behind: 0, partial: 0, dropped: 0, idle: 0 };
    for (const frame of frames) counts[frame.state]++;
    let longestStall = 0;
    let since = first;
    for (const frame of frames) {
      if (frame.state !== "complete" && frame.state !== "behind") continue;
      longestStall = Math.max(longestStall, frame.at - since);
      since = frame.at;
    }
    const mainTasks = events
      .filter(
        (event) =>
          event.name === "RunTask" && event.tid === start.tid && inside(event),
      )
      .map((event) => ({
        at: (event.ts - start.ts) / 1000,
        ms: (event.dur ?? 0) / 1000,
      }));
    const tasks = mainTasks.filter((task) => task.ms > interval);
    const spanMs = last - first || 1;
    const busyMs = mainTasks
      .filter((task) => task.at >= first && task.at <= last)
      .reduce((sum, task) => sum + Math.min(task.ms, last - task.at), 0);
    return [
      {
        name,
        span: (end.ts - start.ts) / 1000,
        frames,
        tasks,
        interval,
        counts,
        longestStall,
        busy: busyMs / spanMs,
      },
    ];
  });
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)]! : 0;
}

function describe(part: Part) {
  const { counts, frames } = part;
  const shown = frames.length - counts.idle;
  const length = frames.length ? frames.at(-1)!.at - frames[0]!.at : 0;
  const tasks = part.tasks.length
    ? part.tasks
        .map((task) => `${task.ms.toFixed(0)} ms at ${task.at.toFixed(0)}`)
        .join(", ")
    : "none";
  return (
    `${part.name}: ${shown} frames over ${length.toFixed(0)} ms ` +
    `(${(1000 / part.interval).toFixed(0)} Hz): ${counts.complete} complete, ` +
    `${counts.behind} behind, ${counts.partial} partial, ` +
    `${counts.dropped} dropped; longest without an update ` +
    `${part.longestStall.toFixed(0)} ms; main thread busy ` +
    `${(part.busy * 100).toFixed(0)}%; tasks over a frame: ${tasks}`
  );
}

const COLOURS: Record<FrameState, string> = {
  complete: "#2f9e5b",
  behind: "#8cc9a3",
  partial: "#e0a526",
  dropped: "#d1453b",
  idle: "#d7d7d7",
};

function chart(parts: Part[], title: string) {
  const width = 960;
  const scale = (width - 140) / Math.max(...parts.map((part) => part.span), 1);
  const rows = parts
    .map((part, row) => {
      const y = 50 + row * 110;
      const ticks = part.frames
        .map(
          (frame) =>
            `<rect x="${120 + frame.at * scale}" y="${y}" width="${Math.max(1.5, part.interval * scale - 1)}" height="34" fill="${COLOURS[frame.state]}"/>`,
        )
        .join("");
      const tasks = part.tasks
        .map(
          (task) =>
            `<rect x="${120 + task.at * scale}" y="${y + 42}" width="${task.ms * scale}" height="10" fill="#555"/>`,
        )
        .join("");
      const { counts } = part;
      return `<text x="10" y="${y + 22}" font-size="15" font-weight="600">${part.name}</text>
        ${ticks}${tasks}
        <text x="120" y="${y + 74}" font-size="12" fill="#444">${counts.complete} complete · ${counts.behind} a frame behind · ${counts.partial} partial · ${counts.dropped} dropped · longest without an update ${part.longestStall.toFixed(0)} ms · main thread busy ${(part.busy * 100).toFixed(0)}% · grey bars: tasks over a frame</text>`;
    })
    .join("");
  const height = 70 + parts.length * 110;
  const legend = (Object.keys(COLOURS) as FrameState[])
    .map(
      (state, i) =>
        `<rect x="${470 + i * 95}" y="14" width="12" height="12" fill="${COLOURS[state]}"/><text x="${486 + i * 95}" y="25" font-size="12">${state}</text>`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" font-family="-apple-system, Helvetica, sans-serif">
    <rect width="100%" height="100%" fill="#fff"/>
    <text x="10" y="25" font-size="14" font-weight="600">${title}</text>${legend}${rows}</svg>`;
}

/** Prints each part's frames, and draws them to `out` as a PNG. */
export async function summarizeFrames(
  json: string,
  out: string,
  browser: BrowserType,
  title = "Frames",
) {
  const parts = readParts(json);
  if (!parts.length) return "no kit:<name>:start/end marks in this trace";
  const instance = await browser.launch();
  const page = await instance.newPage({ deviceScaleFactor: 2 });
  await page.setContent(`<body style="margin:0">${chart(parts, title)}</body>`);
  await page.locator("svg").screenshot({ path: out });
  await instance.close();
  return [...parts.map(describe), `chart ${out}`].join("\n");
}
