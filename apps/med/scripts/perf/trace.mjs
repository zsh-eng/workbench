// Reads a Chrome trace (CDP Tracing events) for the budget: main-thread time
// by kind, long tasks, forced layouts, worker time, React's phases and
// renders (profiling build), and where the time of an interaction goes.

/** Trace categories that the budget records. */
export const TRACE_CATEGORIES = [
  "devtools.timeline",
  "disabled-by-default-devtools.timeline",
  "blink.user_timing",
  "toplevel",
  "v8.execute",
  "v8",
];

const SCRIPT = new Set([
  "FunctionCall",
  "EvaluateScript",
  "v8.compile",
  "v8.compileModule",
  "v8.evaluateModule",
  "v8.callFunction",
  "v8.callAsConstructor",
  "v8.newInstance",
  "v8.run",
  "TimerFire",
  "EventDispatch",
  "FireAnimationFrame",
  "FireIdleCallback",
  "RunMicrotasks",
  "XHRReadyStateChange",
  "XHRLoad",
  "V8.DeoptimizeCode",
  // Promise reactions: JavaScript, also when no inner event names it.
  "BlinkScheduler_PerformMicrotaskCheckpoint",
]);
const STYLE = new Set(["UpdateLayoutTree", "RecalculateStyles", "ParseAuthorStyleSheet"]);
const LAYOUT = new Set(["Layout", "IntersectionObserverController::computeIntersections"]);
const PAINT = new Set([
  "Paint",
  "PrePaint",
  "Layerize",
  "Commit",
  "PaintImage",
  "UpdateLayer",
  "ScrollLayer",
  "Decode Image",
]);
const PARSE = new Set(["ParseHTML"]);

/** Main-thread kinds, in bin codes. 0 is idle. */
export const KINDS = [
  "idle",
  "other",
  "script",
  "gc",
  "style",
  "layout",
  "paint",
  "parse",
  "react",
];
const CODE = Object.fromEntries(KINDS.map((kind, index) => [kind, index]));

function kindOf(event) {
  const { name } = event;
  if (/GC|Scavenge|MarkCompact|Sweep/.test(name)) return "gc";
  if (SCRIPT.has(name)) return "script";
  if (STYLE.has(name)) return "style";
  if (LAYOUT.has(name)) return "layout";
  if (PAINT.has(name)) return "paint";
  if (PARSE.has(name)) return "parse";
  return null;
}

/** The scheduler phases in which React works; the others are waits. */
const REACT_WORK = new Set([
  "Render",
  "Prepared",
  "Hydrated",
  "Recovered",
  "Prewarm",
  "Commit",
  "Remaining Effects",
]);

/** Bins of 0.1 ms. */
const BIN = 100;

/**
 * Indexes a trace. `toEpoch(ts)` converts trace microseconds to epoch
 * milliseconds; it comes from a user-timing mark whose epoch time is known.
 */
export function readTrace(events) {
  const names = new Map();
  for (const event of events)
    if (event.ph === "M" && event.name === "thread_name")
      names.set(`${event.pid}:${event.tid}`, event.args?.name);
  const threads = new Map();
  let main;
  for (const event of events) {
    if (event.ph !== "X" || !event.dur) continue;
    const key = `${event.pid}:${event.tid}`;
    const name = names.get(key) ?? "";
    if (!threads.has(key)) threads.set(key, { name, events: [] });
    threads.get(key).events.push(event);
    if (name === "CrRendererMain" && !main) main = key;
  }
  // With several renderers, the main thread with the most work is the page's.
  let most = 0;
  for (const [key, thread] of threads)
    if (thread.name === "CrRendererMain") {
      const busy = thread.events.reduce(
        (sum, event) => sum + (event.name === "RunTask" ? event.dur : 0),
        0,
      );
      if (busy > most) [most, main] = [busy, key];
    }
  const marks = events.filter(
    (event) => event.cat?.includes("blink.user_timing") && event.ph !== "M",
  );
  const stamps = events.filter((event) => event.name === "TimeStamp" && event.args?.data);
  return { threads, main: main && threads.get(main), mainKey: main, marks, stamps, events };
}

/** Paints one thread's events into bins over [from, to) (trace µs): deepest event wins. */
function paint(thread, from, to, reactSpans = []) {
  const size = Math.max(1, Math.ceil((to - from) / BIN));
  const bins = new Uint8Array(size);
  // For "other" time: the innermost event's name, as an index into `names`.
  const owners = new Uint16Array(size);
  const names = [""];
  const nameIndex = new Map();
  const forced = { layout: 0, style: 0 };
  const tasks = [];
  if (!thread) return { bins, owners, names, forced, tasks };
  const list = thread.events
    .filter((event) => event.ts < to && event.ts + event.dur > from)
    .sort((a, b) => a.ts - b.ts || b.dur - a.dur);
  const stack = [];
  for (const event of list) {
    while (stack.length && stack.at(-1).end <= event.ts) stack.pop();
    const parent = stack.at(-1);
    let kind = kindOf(event) ?? parent?.kind ?? "other";
    const inScript = stack.some((entry) => entry.kind === "script");
    if ((kind === "layout" || kind === "style") && inScript)
      forced[kind] += Math.min(event.ts + event.dur, to) - Math.max(event.ts, from);
    if (event.name === "RunTask" && !parent) tasks.push({ ts: event.ts, dur: event.dur });
    const start = Math.max(0, Math.floor((event.ts - from) / BIN));
    const end = Math.min(size, Math.ceil((event.ts + event.dur - from) / BIN));
    bins.fill(CODE[kind], start, end);
    if (!nameIndex.has(event.name) && names.length < 65_000) {
      nameIndex.set(event.name, names.length);
      names.push(event.name);
    }
    owners.fill(nameIndex.get(event.name) ?? 0, start, end);
    stack.push({ end: event.ts + event.dur, kind });
  }
  // Script inside React's render and commit phases is React's.
  for (const [start, end] of reactSpans) {
    const first = Math.max(0, Math.floor((start - from) / BIN));
    const last = Math.min(size, Math.ceil((end - from) / BIN));
    for (let i = first; i < last; i++) if (bins[i] === CODE.script) bins[i] = CODE.react;
  }
  return { bins, owners, names, forced, tasks };
}

/** React's working spans (scheduler phases) and renders, from the profiling build. */
function reactWork(trace, from, to) {
  const spans = [];
  const phases = {};
  const components = {};
  let renders = 0;
  for (const event of trace.stamps) {
    const data = event.args.data;
    const start = Number(data.start);
    const end = Number(data.end);
    if (!(end > from && start < to)) continue;
    if (data.trackGroup === "Scheduler ⚛") {
      if (!REACT_WORK.has(data.name)) continue;
      const ms = (Math.min(end, to) - Math.max(start, from)) / 1000;
      phases[data.name] = (phases[data.name] ?? 0) + ms;
      spans.push([start, end]);
    } else if (data.track === "Components ⚛" && end > start) {
      renders++;
      components[data.name] = (components[data.name] ?? 0) + 1;
    }
  }
  // Activity shows (Reconnect) and hides (Disconnect) a tree: user-timing spans.
  const reconnect = { count: 0, ms: 0 };
  const opened = new Map();
  for (const event of trace.marks) {
    if (event.name !== "Reconnect") continue;
    if (event.ph === "b") opened.set(event.id2?.local ?? event.id ?? event.tid, event.ts);
    else if (event.ph === "e") {
      const start = opened.get(event.id2?.local ?? event.id ?? event.tid);
      if (start !== undefined && event.ts > from && start < to) {
        reconnect.count++;
        reconnect.ms += (event.ts - start) / 1000;
      }
    }
  }
  return { spans, phases, components, renders, reconnect, present: trace.stamps.length > 0 };
}

const round = (value) => Math.round(value * 10) / 10;

/**
 * Sums a window of the trace (trace µs). `extra` adds spans in trace µs that
 * explain idle main-thread time: { git: [[start, end]], network: [[start, end]] }.
 * `breakdown` says where each 0.1 ms between `from` and `to` went: main-thread
 * kinds first, then worker, Git, host and network, and idle waits.
 */
export function summarize(trace, from, to, extra = {}) {
  const react = reactWork(trace, from, to);
  const main = paint(trace.main, from, to, react.spans);
  const totals = Object.fromEntries(KINDS.slice(1).map((kind) => [kind, 0]));
  const other = new Map();
  for (let i = 0; i < main.bins.length; i++) {
    const code = main.bins[i];
    if (!code) continue;
    totals[KINDS[code]] += BIN / 1000;
    if (code === CODE.other) {
      const name = main.names[main.owners[i]] ?? "";
      other.set(name, (other.get(name) ?? 0) + BIN / 1000);
    }
  }
  const longTasks = main.tasks
    .filter((task) => task.dur >= 50_000)
    .map((task) => round(task.dur / 1000));
  // When the work ends: the start of the first 100 ms in which the main
  // thread works less than 5 ms. Without one, the end of the window.
  let quiet = main.bins.length;
  const span = 1000;
  let busy = 0;
  for (let i = 0; i < main.bins.length; i++) {
    busy += main.bins[i] ? 1 : 0;
    if (i >= span) busy -= main.bins[i - span] ? 1 : 0;
    if (i >= span - 1 && busy < 50) {
      quiet = i - span + 1;
      break;
    }
  }
  const longest = main.tasks.reduce((most, task) => Math.max(most, task.dur), 0) / 1000;
  // Workers: busy time, and the bins in which any worker works.
  const size = main.bins.length;
  const workerBins = new Uint8Array(size);
  let workerMs = 0;
  let workers = 0;
  for (const [key, thread] of trace.threads) {
    if (key === trace.mainKey || !/Worker/.test(thread.name)) continue;
    let busy = 0;
    for (const event of thread.events) {
      if (event.name !== "RunTask" || event.ts >= to || event.ts + event.dur <= from) continue;
      const start = Math.max(event.ts, from);
      const end = Math.min(event.ts + event.dur, to);
      busy += end - start;
      workerBins.fill(1, Math.floor((start - from) / BIN), Math.ceil((end - from) / BIN));
    }
    if (busy > 0) workers++;
    workerMs += busy / 1000;
  }
  const spanBins = (spans = []) => {
    const bins = new Uint8Array(size);
    for (const [start, end] of spans)
      if (end > from && start < to)
        bins.fill(
          1,
          Math.max(0, Math.floor((start - from) / BIN)),
          Math.min(size, Math.ceil((end - from) / BIN)),
        );
    return bins;
  };
  const git = spanBins(extra.git);
  const network = spanBins(extra.network);
  const breakdown = {
    react: 0,
    script: 0,
    style: 0,
    layout: 0,
    paint: 0,
    gc: 0,
    other: 0,
    worker: 0,
    git: 0,
    host: 0,
    idle: 0,
  };
  for (let i = 0; i < size; i++) {
    const code = main.bins[i];
    let kind;
    if (code) kind = KINDS[code] === "parse" ? "other" : KINDS[code];
    else if (workerBins[i]) kind = "worker";
    else if (git[i]) kind = "git";
    else if (network[i]) kind = "host";
    else kind = "idle";
    breakdown[kind] += BIN / 1000;
  }
  return {
    main: Object.fromEntries(Object.entries(totals).map(([kind, ms]) => [kind, round(ms)])),
    // What "other" main-thread time was: the innermost trace events, largest first.
    other: Object.fromEntries(
      [...other]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, ms]) => [name, round(ms)]),
    ),
    forcedLayout: round(main.forced.layout / 1000),
    forcedStyle: round(main.forced.style / 1000),
    quietMs: round((quiet * BIN) / 1000),
    tasks: main.tasks.length,
    longTasks: longTasks.length,
    longTaskMs: round(longTasks.reduce((sum, ms) => sum + ms, 0)),
    longestTask: round(longest),
    workerMs: round(workerMs),
    workers,
    breakdown: Object.fromEntries(Object.entries(breakdown).map(([kind, ms]) => [kind, round(ms)])),
    ...(react.present && {
      react: {
        ms: round(Object.values(react.phases).reduce((sum, ms) => sum + ms, 0)),
        phases: Object.fromEntries(
          Object.entries(react.phases).map(([name, ms]) => [name, round(ms)]),
        ),
        renders: react.renders,
        components: react.components,
        reconnects: react.reconnect.count,
        reconnectMs: round(react.reconnect.ms),
      },
    }),
  };
}

/** The trace time of a user-timing mark by name (the last one), in µs. */
export function markTime(trace, name) {
  const found = trace.marks.filter((event) => event.name === name);
  return found.at(-1)?.ts;
}
