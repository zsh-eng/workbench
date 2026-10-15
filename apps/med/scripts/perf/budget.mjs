// Med's performance budget. It builds a scratch test bed (the exploration demo
// world, six long real or synthetic transcripts, and a thread with a diff of
// about 10,000 lines), starts the built host with a git shim on its PATH, and
// runs these actions in headless Chromium:
//
//   pageLoad        a cold load of /review/<⌘1>, to the thread list and the ready thread
//   firstKey        the first ⌘ after that load, to a thread that has not loaded
//   coldOpen        ⌘ to a thread that has not loaded, after the page idled
//   coldLargeDiff   the same, to the thread with the large diff
//   warmSwitch      ⌘1–⌘9 between loaded threads (the large diff apart)
//   warmLargeDiff   ⌘ to the loaded thread with the large diff
//   agentSteps      three agent steps in a thread that is not on screen
//   idle1, idle2    idle seconds with one window, and with two
//   memory          heap, DOM nodes, and workers when all threads have loaded
//
// For each, it records Git processes (count, time, arguments), HTTP requests
// and WebSocket messages with bytes, host CPU, main-thread time by kind
// (script, style, layout, paint), long tasks, worker time, where the time
// from the key to the commit went, and the load average. A second pass on a
// build with React's profiling renderer counts commits, component renders,
// and React's own time.
//
// Usage (from apps/med, after `bun run build`):
//   node scripts/perf/budget.mjs                        write .benchmarks/perf/budget.json
//   node scripts/perf/budget.mjs --check scripts/perf/baseline.json
//   options: --out <file>  --runs 5  --idle 60  --port 6451  --quick (3 runs, 20 s idle)
//            --transcripts auto|real|synthetic  --no-react  --headed  --frames
//            --tolerance 0.25  --keep (leave the scratch folder and the profiling build)
//            --only load,cold,warm,agent,idle (some actions; not with --check)
//            --host-profile (write the host's CPU profile to the scratch folder; implies --keep)
//
// --check compares the run with a baseline (check.mjs says how) and exits 1
// when the budget fails. check.mjs alone compares two saved runs.
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { cpus, platform, release, tmpdir, totalmem } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { chromium } from "playwright";
import { removeGitEnvironment } from "../git-environment.mjs";
import { compare } from "./check.mjs";
import { buildFixture } from "./fixture.mjs";
import { loadAverage, makeGitShim, readGitLog, startHost } from "./host.mjs";
import { instrument, sidebarOrder, slotState } from "./page.mjs";
import { markTime, readTrace, summarize, TRACE_CATEGORIES } from "./trace.mjs";

// Git in the test bed and the host must not follow a `GIT_DIR` of the
// parent, such as a Git hook's, to another repository. The test bed's own
// Git variables come after this.
removeGitEnvironment();
const app = resolve(import.meta.dirname, "../..");
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);
const quick = flag("quick");
const RUNS = Number(option("runs", quick ? 3 : 5));
const IDLE_S = Number(option("idle", quick ? 20 : 60));
const PORT = Number(option("port", 6451));
const TOLERANCE = Number(option("tolerance", 0.25));
const hostProfile = flag("host-profile");
const keep = flag("keep") || hostProfile;
const headed = flag("headed") || flag("frames");
const frames = flag("frames");
const reactPass = !flag("no-react");
const outFile = resolve(option("out", join(app, ".benchmarks/perf/budget.json")));
const checkFile = option("check");
/** Action groups to run: load, cold, warm, agent, idle (all by default). */
const only = option("only") ? new Set(option("only").split(",")) : undefined;
if (only && checkFile) throw new Error("Use --check with a full run, without --only.");
if (PORT < 6451 || PORT > 6459) throw new Error("Use a port from 6451 to 6459.");

const log = (...parts) => console.log(...parts);
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const median = (values) => {
  const list = values
    .filter((value) => typeof value === "number" && Number.isFinite(value))
    .sort((a, b) => a - b);
  if (!list.length) return undefined;
  const middle = list.length >> 1;
  return list.length % 2 ? list[middle] : (list[middle - 1] + list[middle]) / 2;
};
const round = (value, digits = 1) =>
  typeof value === "number" ? Math.round(value * 10 ** digits) / 10 ** digits : value;

// ------------------------------------------------------------ the scratch bed

const cleanups = [];
const pageErrors = new Set();
let cleaning;
async function cleanup() {
  cleaning ??= (async () => {
    for (const run of cleanups.toReversed())
      await run().catch((error) => console.error("cleanup:", error.message));
  })();
  return cleaning;
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await cleanup();
    process.exit(130);
  });

const scratch = await mkdtemp(join(tmpdir(), "med-perf-"));
cleanups.push(async () => {
  if (keep) log(`kept ${scratch}`);
  else await rm(scratch, { recursive: true, force: true });
});
const gitLog = join(scratch, "git.log");

/** Git processes that started in [from, to) epoch ms. */
async function gitWindow(from, to) {
  const calls = (await readGitLog(gitLog)).filter((call) => call.start >= from && call.start < to);
  const byCommand = {};
  for (const call of calls) {
    // Med's fixed options come first; the subcommand and its first option name the call.
    const words = call.args.split(" ");
    let i = 0;
    while (words[i] === "--no-optional-locks" || words[i] === "-c" || words[i - 1] === "-c") i++;
    const key = words
      .slice(i, i + 2)
      .map((word) => word.replace(/=.*/, "="))
      .join(" ");
    byCommand[key] = (byCommand[key] ?? 0) + 1;
  }
  return {
    count: calls.length,
    ms: round(calls.reduce((sum, call) => sum + call.end - call.start, 0)),
    cpu: round(calls.reduce((sum, call) => sum + call.cpu, 0)),
    byCommand,
    spans: calls.map((call) => [call.start, call.end]),
  };
}

// ------------------------------------------------------------ page recording

/** Requests that only the features to be dropped make (Turn blame, Land). */
const DROPPED = /\/edits$|\/land(\/|$)/;

function normalPath(url) {
  const parsed = new URL(url);
  let path = parsed.pathname
    .replace(/r_[a-f0-9]{24}/g, ":review")
    .replace(/t_[a-f0-9]{24}/g, ":target")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, ":uuid")
    .replace(/^\/(assets|fonts|icons)\/.+$/, "/$1/*")
    .replace(/^\/review\/.+$/, "/review/:review");
  if (parsed.search) path += `?${[...parsed.searchParams.keys()].join("&")}`;
  return path;
}

/** Records a page's requests, WebSocket messages, and metrics through CDP. */
async function record(context, page) {
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable", { maxPostDataSize: 65_536 });
  await cdp.send("Performance.enable", { timeDomain: "timeTicks" });
  const rec = {
    cdp,
    page,
    requests: new Map(),
    frames: [],
    channels: new Map(),
    offset: undefined,
  };
  cdp.on("Network.requestWillBeSent", (event) => {
    if (!/^https?:/.test(event.request.url)) return;
    rec.offset ??= event.wallTime * 1000 - event.timestamp * 1000;
    rec.requests.set(event.requestId, {
      path: normalPath(event.request.url),
      method: event.request.method,
      start: event.timestamp,
      bytes: 0,
    });
    if (event.request.method === "POST" && /\/api\/live\//.test(event.request.url))
      try {
        for (const channel of JSON.parse(event.request.postData ?? "{}").open ?? [])
          rec.channels.set(channel.key, normalPath(`http://x${channel.path}`));
      } catch {
        /* Not a channel request. */
      }
  });
  cdp.on("Network.responseReceived", (event) => {
    const request = rec.requests.get(event.requestId);
    if (request) request.status = event.response.status;
  });
  cdp.on("Network.loadingFinished", (event) => {
    const request = rec.requests.get(event.requestId);
    if (request) Object.assign(request, { end: event.timestamp, bytes: event.encodedDataLength });
  });
  cdp.on("Network.loadingFailed", (event) => {
    const request = rec.requests.get(event.requestId);
    if (request) Object.assign(request, { end: event.timestamp, failed: true });
  });
  const frame = (direction) => (event) => {
    const text = event.response.payloadData ?? "";
    const key = /^event: ([^:\n]+):/.exec(text)?.[1];
    rec.frames.push({
      t: event.timestamp,
      direction,
      bytes: text.length,
      channel: key ? (rec.channels.get(key) ?? key) : "-",
    });
  };
  cdp.on("Network.webSocketFrameReceived", frame("in"));
  cdp.on("Network.webSocketFrameSent", frame("out"));
  rec.epoch = (seconds) => seconds * 1000 + (rec.offset ?? 0);
  rec.metrics = async () =>
    Object.fromEntries(
      (await cdp.send("Performance.getMetrics")).metrics.map(({ name, value }) => [name, value]),
    );
  return rec;
}

/** Requests and messages in [from, to) epoch ms. */
function networkWindow(rec, from, to) {
  const requests = [...rec.requests.values()].filter((request) => {
    const at = rec.epoch(request.start);
    return at >= from && at < to;
  });
  const byPath = {};
  let dropped = 0;
  for (const request of requests) {
    if (DROPPED.test(request.path.split("?")[0])) {
      dropped++;
      continue;
    }
    const key = `${request.method} ${request.path}`;
    byPath[key] ??= { count: 0, bytes: 0 };
    byPath[key].count++;
    byPath[key].bytes += request.bytes;
  }
  const kept = requests.filter((request) => !DROPPED.test(request.path.split("?")[0]));
  const frames = rec.frames.filter((frame) => {
    const at = rec.epoch(frame.t);
    return at >= from && at < to && frame.direction === "in";
  });
  const byChannel = {};
  for (const frame of frames) {
    byChannel[frame.channel] ??= { count: 0, bytes: 0 };
    byChannel[frame.channel].count++;
    byChannel[frame.channel].bytes += frame.bytes;
  }
  return {
    http: {
      count: kept.length,
      api: kept.filter((request) => request.path.startsWith("/api/")).length,
      bytes: kept.reduce((sum, request) => sum + request.bytes, 0),
      dropped,
      byPath,
    },
    ws: {
      messages: frames.length,
      bytes: frames.reduce((sum, frame) => sum + frame.bytes, 0),
      byChannel,
    },
    spans: requests.map((request) => [
      rec.epoch(request.start),
      request.end ? rec.epoch(request.end) : to,
    ]),
  };
}

/** Records a CDP trace while `run` runs. */
async function traced(rec, run) {
  const events = [];
  const collect = ({ value }) => events.push(...value);
  rec.cdp.on("Tracing.dataCollected", collect);
  const complete = new Promise((done) => rec.cdp.once("Tracing.tracingComplete", done));
  await rec.cdp.send("Tracing.start", {
    traceConfig: { includedCategories: TRACE_CATEGORIES },
    transferMode: "ReportEvents",
  });
  let result;
  try {
    result = await run();
  } finally {
    await rec.cdp.send("Tracing.end");
    await complete;
    rec.cdp.off("Tracing.dataCollected", collect);
  }
  return { result, trace: readTrace(events) };
}

// ------------------------------------------------------------ the host and browser

const cli = join(app, "dist/cli.js");
log(`Med performance budget: ${RUNS} runs, ${IDLE_S} s idle, port ${PORT}, load ${loadAverage()}`);
const started = Date.now();
log("building the test bed …");
const fixture = await buildFixture({
  root: join(scratch, "bed"),
  transcripts: option("transcripts", "auto"),
  log,
});
const shim = await makeGitShim(join(scratch, "shim"), fixture.world.env.PATH);
const hostEnv = { ...process.env, ...fixture.world.env };

let host;
async function serve(path) {
  host = await startHost({
    cli: path,
    state: fixture.world.state,
    port: PORT,
    env: hostEnv,
    shim,
    gitLog,
    args: hostProfile ? ["--cpu-prof", "--cpu-prof-dir", join(scratch, "host-profile")] : [],
  });
  return host;
}
cleanups.push(async () => host?.stop());
await serve(cli);
fixture.register(host.cli);
const list = await host.threads();
const idOf = (title) => list.threads.find((thread) => thread.title === title && !thread.found)?.id;
const ids = {
  open: idOf(fixture.long[0].title),
  cold: idOf(fixture.long[2].title),
  atlas: idOf(fixture.atlas.title),
};
/** The threads that the warm switches visit: the long ones, the large diff, and the agent's. */
const switchIds = new Set(
  [...fixture.long.map((thread) => thread.title), fixture.atlas.title, fixture.glossary.title].map(
    idOf,
  ),
);
const inView = list.threads.filter((thread) => !thread.found).length;
log(
  `${list.threads.length} threads (${inView} saved); set-up ${((Date.now() - started) / 1000).toFixed(1)} s`,
);

const browser = await chromium.launch({
  headless: !headed,
  args: headed ? ["--window-size=1440,900", "--window-position=0,0"] : [],
});
cleanups.push(() => browser.close());

async function newPage({ react = false, context } = {}) {
  context ??= await browser.newContext({
    viewport: headed ? null : { width: 1440, height: 900 },
    deviceScaleFactor: headed ? undefined : 2,
    colorScheme: "dark",
  });
  await context.addCookies([
    {
      name: `med_session_${PORT}`,
      value: host.token,
      url: host.origin,
      httpOnly: true,
      sameSite: "Strict",
    },
  ]);
  await context.addInitScript(instrument, { react });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const rec = await record(context, page);
  return { context, page, rec, errors };
}

/** Waits until every thread in view has loaded and the slots stop changing. */
async function settled(page, limit = 45_000) {
  const began = Date.now();
  let last = "";
  let since = Date.now();
  for (;;) {
    const state = await page.evaluate(slotState);
    const key = `${state.slots}/${state.loading}`;
    if (key !== last) [last, since] = [key, Date.now()];
    if (state.loading === 0 && Date.now() - since > 3000) return state;
    if (Date.now() - began > limit) return { ...state, timedOut: true };
    await wait(250);
  }
}

/** The ⌘ digit of a thread in the sidebar's order, or undefined past 9. */
async function digitOf(page, id) {
  const order = await page.evaluate(sidebarOrder);
  const index = order.indexOf(id);
  return index >= 0 && index < 9 ? index + 1 : undefined;
}

// ------------------------------------------------------------ measurements

/** Everything in [from, to) epoch ms, with a trace window and marks. */
async function measure({ recs, from, to, cpu, trace, traceFrom, traceTo, metrics }) {
  const git = await gitWindow(from, to);
  const networks = recs.map((rec) => networkWindow(rec, from, to));
  const merge = (pick) => {
    const all = networks.map(pick);
    const total = { ...all[0] };
    for (const part of all.slice(1))
      for (const [key, value] of Object.entries(part))
        if (typeof value === "number") total[key] += value;
        else if (value && typeof value === "object")
          for (const [name, entry] of Object.entries(value)) {
            total[key] = { ...total[key] };
            total[key][name] = total[key][name]
              ? {
                  count: total[key][name].count + entry.count,
                  bytes: total[key][name].bytes + entry.bytes,
                }
              : entry;
          }
    return total;
  };
  const result = {
    git: { count: git.count, ms: git.ms, cpu: git.cpu, byCommand: git.byCommand },
    http: merge((network) => network.http),
    ws: merge((network) => network.ws),
    host: { cpu: cpu },
  };
  if (trace && recs[0].offset !== undefined) {
    const rec = recs[0];
    const toTrace = (epoch) => (epoch - rec.offset) * 1000;
    const spans = (list) => list.map(([start, end]) => [toTrace(start), toTrace(end)]);
    const summary = summarize(trace, traceFrom, traceTo, {
      git: spans(git.spans),
      network: spans(networks[0].spans),
    });
    Object.assign(result, summary);
  }
  if (metrics) Object.assign(result, metrics);
  return result;
}

/** Main-thread metrics deltas from Performance.getMetrics. */
function metricDelta(before, after) {
  const ms = (name) => round((after[name] - before[name]) * 1000);
  return {
    browser: {
      taskMs: ms("TaskDuration"),
      scriptMs: ms("ScriptDuration"),
      layoutMs: ms("LayoutDuration"),
      styleMs: ms("RecalcStyleDuration"),
      layouts: after.LayoutCount - before.LayoutCount,
      styles: after.RecalcStyleCount - before.RecalcStyleCount,
    },
  };
}

/** Holds GET /api/reviews/<id> until release, so the warm pool stops at that thread. */
async function hold(context, id) {
  const held = [];
  const pattern = (url) => url.pathname === `/api/reviews/${id}`;
  const handler = (route) => held.push(route);
  await context.route(pattern, handler);
  return {
    get hits() {
      return held.length;
    },
    async release() {
      await context.unroute(pattern, handler);
      for (const route of held) await route.abort().catch(() => {});
    },
  };
}

/**
 * Presses ⌘<digit> for thread `id` and waits until SHOWN (nothing pending)
 * plus `tail` ms. It records what the page and the host saw; `keyResult`
 * reads it with the trace that covers it.
 */
async function keyPress(session, id, { tail = 500 } = {}) {
  const { page, rec } = session;
  const digit = await digitOf(page, id);
  if (!digit) throw new Error(`The thread ${id} has no ⌘ key.`);
  const longBefore = await page.evaluate((target) => {
    window.__perf.marks = {};
    window.__perf.armed = target;
    window.__perf.commitsBefore = window.__perf.commits;
    return window.__perf.longTasks.length;
  }, id);
  const load = loadAverage();
  const before = await rec.metrics();
  const cpu0 = host.cpuAsync();
  const from = Date.now();
  let screencast;
  if (frames) {
    screencast = [];
    rec.cdp.on("Page.screencastFrame", (event) => {
      screencast.push(event.metadata.timestamp * 1000);
      rec.cdp.send("Page.screencastFrameAck", { sessionId: event.sessionId }).catch(() => {});
    });
    await rec.cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: 20,
      maxWidth: 480,
      everyNthFrame: 1,
    });
  }
  await page.keyboard.press(`Meta+Digit${digit}`);
  const timedOut = await page
    .waitForFunction(() => window.__perf.marks.SHOWN !== undefined, null, { timeout: 8000 })
    .then(() => false)
    .catch(() => true);
  if (timedOut) log(`  ⌘${digit} did not show ${id} within 8 s`);
  await wait(tail);
  if (screencast) {
    await rec.cdp.send("Page.stopScreencast").catch(() => {});
    rec.cdp.removeAllListeners("Page.screencastFrame");
  }
  const to = Date.now();
  const cpu = (await host.cpuAsync()) - (await cpu0);
  const after = await rec.metrics();
  const seen = await page.evaluate(
    ([count]) => ({
      marks: window.__perf.marks,
      keydownEpoch: window.__perf.keydownEpoch,
      commits: window.__perf.commits - window.__perf.commitsBefore,
      longTasks: window.__perf.longTasks.slice(count).length,
    }),
    [longBefore],
  );
  return { id, load, before, after, from, to, cpu, seen, screencast };
}

/** The result of a key press, with the trace that covers it. */
async function keyResult(session, raw, trace, { react = false } = {}) {
  const { rec } = session;
  const { marks, keydownEpoch } = raw.seen;
  const toTrace = (epoch) => (epoch - rec.offset) * 1000;
  // The page's marks are in ms after the key event's time stamp.
  const eventTs = toTrace(keydownEpoch);
  const endTs = toTrace(raw.to);
  const at = (name) => (marks[name] === undefined ? undefined : eventTs + marks[name] * 1000);
  const result = await measure({
    recs: [rec],
    from: raw.from,
    to: raw.to,
    cpu: raw.cpu,
    trace,
    traceFrom: eventTs,
    traceTo: endTs,
    metrics: metricDelta(raw.before, raw.after),
  });
  // Where the time to the commit, and to SHOWN, went.
  const git = await gitWindow(raw.from, raw.to);
  const network = networkWindow(rec, raw.from, raw.to);
  const extra = {
    git: git.spans.map(([start, end]) => [toTrace(start), toTrace(end)]),
    network: network.spans.map(([start, end]) => [toTrace(start), toTrace(end)]),
  };
  if (at("COMMIT")) result.toCommit = summarize(trace, eventTs, at("COMMIT"), extra).breakdown;
  if (at("SHOWN")) result.toShown = summarize(trace, eventTs, at("SHOWN"), extra).breakdown;
  result.ms = Object.fromEntries(
    ["COMMIT", "FRAME", "PAINTED", "VISIBLE", "SESSION", "SHOWN"].map((name) => [
      name,
      round(marks[name]),
    ]),
  );
  // The main thread is quiet for 100 ms from here: the action's work has ended.
  result.ms.SETTLED = result.quietMs;
  delete result.quietMs;
  // The trace's keydown mark comes just after the event: a check that the clocks agree.
  const mark = markTime(trace, "perf:keydown");
  if (mark !== undefined) result.markLagMs = round((mark - eventTs) / 1000);
  result.cold = !marks.slotBefore;
  result.slotsBefore = marks.slotsBefore;
  result.load = raw.load;
  result.longTasks = raw.seen.longTasks;
  if (react) result.react = { ...result.react, commits: raw.seen.commits };
  if (raw.screencast) {
    const commitEpoch = keydownEpoch + (marks.COMMIT ?? 0);
    const after = raw.screencast.filter((t) => t >= keydownEpoch).sort((a, b) => a - b);
    const first = after.find((t) => t >= commitEpoch);
    const gaps = after.slice(1).map((t, i) => t - after[i]);
    result.frames = {
      firstPaintAfterCommit: first ? round(first - keydownEpoch) : undefined,
      count: after.length,
      longestGap: round(Math.max(0, ...gaps)),
    };
  }
  return result;
}

/** Presses ⌘ for thread `id`, with a trace. */
async function press(session, id, { tail = 500, react = false } = {}) {
  const { result: raw, trace } = await traced(session.rec, () => keyPress(session, id, { tail }));
  return keyResult(session, raw, trace, { react });
}

/**
 * A cold load of /review/<open> in a new context, to the ready thread. With
 * `firstKey`, ⌘ for that thread follows at once, in the same trace.
 */
async function pageLoad({ react = false, firstKey } = {}) {
  const session = await newPage({ react });
  const { page, rec } = session;
  const load = loadAverage();
  const cpu0 = host.cpuAsync();
  const from = Date.now();
  let loaded;
  const { result: raw, trace } = await traced(rec, async () => {
    await page.goto(`${host.origin}/review/${ids.open}`, { waitUntil: "commit" });
    await page.waitForFunction(() => window.__perf.marks.SHOWN !== undefined, null, {
      timeout: 30_000,
    });
    loaded = {
      at: Date.now(),
      cpu: host.cpuAsync(),
      info: await page.evaluate(() => ({
        marks: window.__perf.marks,
        origin: performance.timeOrigin,
        commits: window.__perf.commits,
        longTasks: window.__perf.longTasks.length,
      })),
    };
    if (firstKey) return keyPress(session, firstKey);
    await wait(300);
  });
  const metrics = await rec.metrics();
  const { info } = loaded;
  const toTrace = (epoch) => (epoch - rec.offset) * 1000;
  const at = (name) =>
    info.marks[name] === undefined ? undefined : toTrace(info.origin + info.marks[name]);
  const git = await gitWindow(from, loaded.at);
  const network = networkWindow(rec, from, loaded.at);
  const result = await measure({
    recs: [rec],
    from,
    to: loaded.at,
    cpu: (await loaded.cpu) - (await cpu0),
    trace,
    traceFrom: toTrace(info.origin),
    traceTo: at("SHOWN") ?? toTrace(loaded.at),
  });
  if (at("LIST"))
    result.toList = summarize(trace, toTrace(info.origin), at("LIST"), {
      git: git.spans.map(([start, end]) => [toTrace(start), toTrace(end)]),
      network: network.spans.map(([start, end]) => [toTrace(start), toTrace(end)]),
    }).breakdown;
  delete result.quietMs;
  result.ms = Object.fromEntries(
    ["LIST", "COMMIT", "VISIBLE", "SESSION", "SHOWN"].map((name) => [
      name,
      round(info.marks[name]),
    ]),
  );
  result.load = load;
  result.longTasks = info.longTasks;
  result.heapMB = round(metrics.JSHeapUsedSize / 2 ** 20);
  result.nodes = metrics.Nodes;
  if (react) result.react = { ...result.react, commits: info.commits };
  const next = raw ? await keyResult(session, raw, trace, { react }) : undefined;
  for (const error of session.errors) pageErrors.add(error);
  await session.context.close();
  return { load: result, next };
}

/** The idle cost of `sessions` over `seconds`. */
async function idle(sessions, seconds) {
  const load = loadAverage();
  const before = await Promise.all(sessions.map((session) => session.rec.metrics()));
  const longBefore = await Promise.all(
    sessions.map((session) => session.page.evaluate(() => window.__perf.longTasks.length)),
  );
  const cpu0 = host.cpu();
  const from = Date.now();
  await wait(seconds * 1000);
  const to = Date.now();
  const cpu = host.cpu() - cpu0;
  const after = await Promise.all(sessions.map((session) => session.rec.metrics()));
  const longAfter = await Promise.all(
    sessions.map((session) => session.page.evaluate(() => window.__perf.longTasks.length)),
  );
  const result = await measure({ recs: sessions.map((session) => session.rec), from, to, cpu });
  const deltas = sessions.map((session, i) => metricDelta(before[i], after[i]).browser);
  result.browser = Object.fromEntries(
    Object.keys(deltas[0]).map((key) => [
      key,
      round(deltas.reduce((sum, delta) => sum + delta[key], 0)),
    ]),
  );
  result.longTasks = longAfter.reduce((sum, count, i) => sum + count - longBefore[i], 0);
  result.seconds = round((to - from) / 1000);
  result.load = load;
  return result;
}

/** Three steps of the glossary agent, 1.5 s apart, in a thread not on screen. */
async function agentSteps(session, { react = false } = {}) {
  const { page, rec } = session;
  const load = loadAverage();
  const before = await rec.metrics();
  const commits0 = await page.evaluate(() => window.__perf.commits);
  const longBefore = await page.evaluate(() => window.__perf.longTasks.length);
  const cpu0 = host.cpu();
  const from = Date.now();
  let steps = 0;
  const { trace } = await traced(rec, async () => {
    for (let i = 0; i < 3; i++) {
      if (await fixture.world.advance()) steps++;
      await wait(1500);
    }
    await wait(2000);
  });
  const to = Date.now();
  const cpu = host.cpu() - cpu0;
  const after = await rec.metrics();
  const result = await measure({
    recs: [rec],
    from,
    to,
    cpu,
    trace,
    traceFrom: (from - rec.offset) * 1000,
    traceTo: (to - rec.offset) * 1000,
    metrics: metricDelta(before, after),
  });
  delete result.quietMs;
  result.steps = steps;
  result.seconds = round((to - from) / 1000);
  result.load = load;
  result.longTasks = (await page.evaluate(() => window.__perf.longTasks.length)) - longBefore;
  if (react)
    result.react = {
      ...result.react,
      commits: (await page.evaluate(() => window.__perf.commits)) - commits0,
    };
  return result;
}

/** Heap after a collection, DOM nodes, listeners, and workers. */
async function memory(session, slots) {
  await session.rec.cdp.send("HeapProfiler.collectGarbage");
  const metrics = await session.rec.metrics();
  const workers = await session.page.evaluate(() => window.__perf.workers);
  const workerHeaps = await workerHeapsMB(session.rec.cdp);
  return {
    heapMB: round(metrics.JSHeapUsedSize / 2 ** 20),
    nodes: metrics.Nodes,
    listeners: metrics.JSEventListeners,
    workers: workers.made - workers.ended,
    workersMade: workers.made,
    workerHeapMB: round(workerHeaps.reduce((sum, heap) => sum + heap, 0)),
    rendererMB: await rendererMB(),
    slots: slots.slots,
    heapPerSlotMB: round(metrics.JSHeapUsedSize / 2 ** 20 / Math.max(1, slots.slots)),
  };
}

/** The used JS heap of each worker of the page, after a GC in it, in MB. */
async function workerHeapsMB(cdp) {
  const sessions = [];
  const attached = (event) => {
    if (event.targetInfo.type === "worker") sessions.push(event.sessionId);
  };
  cdp.on("Target.attachedToTarget", attached);
  // Not flat: this CDP session talks to each worker through its page.
  await cdp.send("Target.setAutoAttach", {
    autoAttach: true,
    waitForDebuggerOnStart: false,
    flatten: false,
  });
  await wait(300);
  cdp.off("Target.attachedToTarget", attached);
  let next = 0;
  const answers = new Map();
  const received = (event) => {
    const message = JSON.parse(event.message);
    answers.get(message.id)?.(message.result);
  };
  cdp.on("Target.receivedMessageFromTarget", received);
  const ask = (sessionId, method) =>
    new Promise((resolve) => {
      const id = ++next;
      answers.set(id, resolve);
      setTimeout(() => resolve(undefined), 2000);
      cdp
        .send("Target.sendMessageToTarget", { sessionId, message: JSON.stringify({ id, method }) })
        .catch(() => resolve(undefined));
    });
  const heaps = [];
  for (const sessionId of sessions) {
    await ask(sessionId, "HeapProfiler.collectGarbage");
    const usage = await ask(sessionId, "Runtime.getHeapUsage");
    if (usage) heaps.push(usage.usedSize / 2 ** 20);
  }
  cdp.off("Target.receivedMessageFromTarget", received);
  for (const sessionId of sessions)
    await cdp.send("Target.detachFromTarget", { sessionId }).catch(() => {});
  await cdp.send("Target.setAutoAttach", { autoAttach: false, waitForDebuggerOnStart: false });
  return heaps;
}

/** The resident memory of the browser's renderer processes, in MB: the page
 * with its workers, which run as threads in it. */
async function rendererMB() {
  const cdp = await browser.newBrowserCDPSession();
  try {
    const { processInfo } = await cdp.send("SystemInfo.getProcessInfo");
    let kb = 0;
    for (const { type, id } of processInfo) {
      if (type !== "renderer") continue;
      try {
        kb += Number(execFileSync("ps", ["-o", "rss=", "-p", String(id)], { encoding: "utf8" }));
      } catch {
        // The process ended.
      }
    }
    return Math.round(kb / 1024);
  } finally {
    await cdp.detach().catch(() => {});
  }
}

/** One full set of actions; the React pass runs fewer. */
async function pass({ react }) {
  const runs = react ? 2 : RUNS;
  const results = {
    pageLoad: [],
    firstKey: [],
    coldOpen: [],
    coldLargeDiff: [],
    warmSwitch: [],
    warmLargeDiff: [],
    agentSteps: [],
    idle1: [],
    idle2: [],
    memory: [],
  };
  const tag = react ? "react" : "main";
  const errors = pageErrors;
  const wanted = (group) => !only || only.has(group);

  if (wanted("load")) {
    log(`[${tag}] page load and the first ⌘ ×${runs}, after one load that is not counted`);
    // The first load after the host starts fills the host's caches; it is not
    // the load that a reader sees from the running service. Each load starts
    // 2 s after the last, when the host has done the work that the last
    // page's warm pool asked for.
    await pageLoad({ react, firstKey: ids.cold });
    for (let i = 0; i < runs; i++) {
      await wait(2000);
      const { load, next } = await pageLoad({ react, firstKey: ids.cold });
      results.pageLoad.push(load);
      results.firstKey.push(next);
      log(
        `  load: list ${load.ms.LIST} ms, ready ${load.ms.SHOWN} ms, git ${load.git.count} · first ⌘: ${next.cold ? "cold" : "warm"} commit ${next.ms.COMMIT} ms, shown ${next.ms.SHOWN} ms, git ${next.git.count}`,
      );
    }
  }

  if (wanted("cold")) {
    log(`[${tag}] cold ⌘ after idle ×${runs} (the warm pool held at its first thread)`);
    for (let i = 0; i < runs; i++) {
      const session = await newPage({ react });
      // The warm pool loads the threads in the list's order; hold the first.
      const order = (await host.threads()).threads
        .filter((thread) => !thread.found)
        .map((thread) => thread.id);
      const first = order.find((id) => id !== ids.open && id !== ids.cold && id !== ids.atlas);
      const held = await hold(session.context, first);
      await session.page.goto(`${host.origin}/review/${ids.open}`);
      await session.page.waitForFunction(() => window.__perf.marks.SHOWN !== undefined, null, {
        timeout: 30_000,
      });
      await wait(3000);
      const cold = await press(session, ids.cold, { react });
      await wait(2500);
      const large = await press(session, ids.atlas, { react });
      cold.held = large.held = held.hits;
      results.coldOpen.push(cold);
      results.coldLargeDiff.push(large);
      for (const error of session.errors) errors.add(error);
      await held.release();
      await session.context.close();
      log(
        `  cold ${cold.cold ? "" : "(warm!) "}commit ${cold.ms.COMMIT} ms, shown ${cold.ms.SHOWN} ms, git ${cold.git.count} · large diff ${large.cold ? "" : "(warm!) "}commit ${large.ms.COMMIT} ms, shown ${large.ms.SHOWN} ms, git ${large.git.count}`,
      );
    }
  }

  if (!["warm", "agent", "idle"].some(wanted)) return { results };
  const session = await newPage({ react });
  await session.page.goto(`${host.origin}/review/${ids.open}`);
  await session.page.waitForFunction(() => window.__perf.marks.SHOWN !== undefined, null, {
    timeout: 30_000,
  });
  const slots = await settled(session.page);
  log(`[${tag}] ${slots.slots} workspaces loaded${slots.timedOut ? " (timed out)" : ""}`);
  if (!react) results.memory.push(await memory(session, slots));

  if (wanted("warm")) {
    log(`[${tag}] warm ⌘ switches`);
    const order = (await session.page.evaluate(sidebarOrder))
      .slice(0, 9)
      .filter((id) => switchIds.has(id));
    // A first visit to each loaded thread, then revisits: five visits to the
    // large diff in the main pass.
    const rounds = react ? 1 : 4;
    for (let round_ = 0; round_ <= rounds; round_++) {
      for (const id of [...order.slice(1), order[0]]) {
        const result = await press(session, id, { react, tail: 400 });
        result.visit = round_ === 0 ? "first" : "again";
        (id === ids.atlas ? results.warmLargeDiff : results.warmSwitch).push(result);
        await wait(600);
      }
    }
    const warm = results.warmSwitch;
    log(
      `  ${warm.length} switches: commit ${median(warm.map((r) => r.ms.COMMIT))} ms, shown ${median(warm.map((r) => r.ms.SHOWN))} ms (medians); large diff shown ${median(results.warmLargeDiff.map((r) => r.ms.SHOWN))} ms`,
    );
  }

  if (wanted("agent")) {
    log(`[${tag}] three agent steps in a thread off screen`);
    await wait(1500);
    results.agentSteps.push(await agentSteps(session, { react }));
    log(
      `  git ${results.agentSteps[0].git.count}, ws ${results.agentSteps[0].ws.messages}, script ${results.agentSteps[0].main?.script} ms, host CPU ${results.agentSteps[0].host.cpu} ms`,
    );
  }

  if (!react && wanted("idle")) {
    log(`[main] ${IDLE_S} idle seconds, one window`);
    await wait(2000);
    results.idle1.push(await idle([session], IDLE_S));
    log(
      `  host CPU ${results.idle1[0].host.cpu} ms, git ${results.idle1[0].git.count}, ws ${results.idle1[0].ws.messages}, main thread ${results.idle1[0].browser.taskMs} ms`,
    );
    log(`[main] ${IDLE_S} idle seconds, two windows`);
    const second = await newPage({ context: session.context });
    await second.page.goto(`${host.origin}/review/${ids.cold}`);
    await second.page.waitForFunction(() => window.__perf.marks.SHOWN !== undefined, null, {
      timeout: 30_000,
    });
    await settled(second.page);
    await wait(2000);
    results.idle2.push(await idle([session, second], IDLE_S));
    log(
      `  host CPU ${results.idle2[0].host.cpu} ms, git ${results.idle2[0].git.count}, ws ${results.idle2[0].ws.messages}, main thread ${results.idle2[0].browser.taskMs} ms`,
    );
  }
  for (const error of session.errors) errors.add(error);
  await session.context.close();
  return { results };
}

// ------------------------------------------------------------ summaries

/** The median of each numeric leaf over runs. In tallies (by…, components,
 * phases), a run without a key counts 0. */
function summarizeRuns(runs, tally = false) {
  if (!runs.length) return undefined;
  const out = {};
  const keys = new Set(runs.flatMap((run) => Object.keys(run ?? {})));
  for (const key of keys) {
    const values = runs.map((run) => run?.[key] ?? (tally ? 0 : undefined));
    const sample = values.find((value) => value !== undefined && value !== 0) ?? values[0];
    if (typeof sample === "number") out[key] = round(median(values));
    else if (typeof sample === "boolean") out[key] = values.filter(Boolean).length;
    else if (sample && typeof sample === "object" && !Array.isArray(sample))
      out[key] = summarizeRuns(
        values.map((value) => value ?? {}),
        tally || /^by|^components$|^phases$|^other$/.test(key),
      );
    else if (sample !== undefined) out[key] = sample;
  }
  return out;
}

/** A short record of each run, beside the medians. */
const brief = (run) =>
  run.git
    ? {
        load: run.load,
        ...(run.cold !== undefined && { cold: run.cold }),
        ...(run.visit && { visit: run.visit }),
        ...(run.ms && { ms: run.ms }),
        git: run.git.count,
        http: run.http.count,
        ws: run.ws.messages,
        wsKB: Math.round(run.ws.bytes / 1024),
        hostCpu: run.host.cpu,
        ...(run.main && { script: run.main.script }),
        ...(run.toCommit && { toCommit: run.toCommit }),
      }
    : run;

function topComponents(runs, count = 12) {
  const totals = {};
  for (const run of runs)
    for (const [name, n] of Object.entries(run.react?.components ?? {}))
      totals[name] = (totals[name] ?? 0) + n / runs.length;
  return Object.fromEntries(
    Object.entries(totals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, count)
      .map(([name, n]) => [name, round(n)]),
  );
}

// ------------------------------------------------------------ run

let output;
try {
  const main = await pass({ react: false });
  let react;
  if (reactPass) {
    log("[react] building the profiling web app …");
    const dist = join(app, ".benchmarks/perf/dist");
    await rm(dist, { recursive: true, force: true });
    await mkdir(dist, { recursive: true });
    await cp(join(app, "dist/cli.js"), join(dist, "cli.js"));
    await cp(join(app, "dist/assets"), join(dist, "assets"), { recursive: true });
    try {
      execFileSync(
        join(app, "node_modules/.bin/vite"),
        [
          "build",
          "--config",
          "scripts/perf/vite.profiling.config.ts",
          "--outDir",
          join(dist, "web"),
          "--emptyOutDir",
        ],
        { cwd: app, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" },
      );
    } catch (error) {
      console.error(error.stderr ?? error.message);
      throw new Error("The profiling build failed.");
    }
    if (!keep)
      cleanups.push(() => rm(join(app, ".benchmarks/perf/dist"), { recursive: true, force: true }));
    await host.stop();
    await serve(join(dist, "cli.js"));
    react = await pass({ react: true });
  }

  const actions = {};
  for (const [name, runs] of Object.entries(main.results)) {
    if (!runs.length) continue;
    const summary = summarizeRuns(runs);
    const reactRuns = react?.results[name] ?? [];
    if (reactRuns.length) {
      const reactSummary = summarizeRuns(
        reactRuns.map((run) => ({ ...run.react, components: undefined })),
      );
      summary.react = { ...reactSummary, top: topComponents(reactRuns), ms: reactSummary.ms };
      // React's share of main-thread script in the profiling build.
      const shares = reactRuns.map((run) =>
        run.main ? run.main.react / Math.max(1, run.main.react + run.main.script) : undefined,
      );
      summary.react.shareOfScript = round(median(shares), 2);
      // Where the time to the commit went in the profiling build, with React apart.
      for (const key of ["toList", "toCommit", "toShown"]) {
        const parts = reactRuns.map((run) => run[key]).filter(Boolean);
        if (parts.length) summary.react[key] = summarizeRuns(parts);
      }
    }
    // The fewest of each host count over the runs: periodic host work that
    // falls into a window adds to some runs, never takes away. React counts
    // differ by thread, so they keep the median.
    const fewest = (list, path) => {
      const values = list
        .map((run) => path.split(".").reduce((value, key) => value?.[key], run))
        .filter(Number.isFinite);
      return values.length ? Math.min(...values) : undefined;
    };
    const min = {};
    for (const path of ["git.count", "http.count", "http.api", "ws.messages"]) {
      const value = fewest(runs, path);
      if (value !== undefined) min[path] = value;
    }
    // Bytes differ by thread: the mean over the runs is steadier than a median.
    const mean = {};
    for (const path of ["http.bytes", "ws.bytes"]) {
      const values = runs.map((run) => run[path.split(".")[0]]?.bytes).filter(Number.isFinite);
      if (values.length)
        mean[path] = Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
    }
    actions[name] = {
      runs: runs.length,
      load: round(median(runs.map((run) => run.load)), 2),
      min,
      mean,
      median: summary,
      each: runs.map(brief),
    };
  }
  const chromiumVersion = browser.version();
  output = {
    version: 1,
    createdAt: new Date().toISOString(),
    commit: execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: app,
      encoding: "utf8",
    }).trim(),
    machine: {
      cpus: cpus().length,
      model: cpus()[0]?.model,
      memoryGB: Math.round(totalmem() / 2 ** 30),
      os: `${platform()} ${release()}`,
      node: process.version,
      chromium: chromiumVersion,
      git: execFileSync(shim.git, ["--version"], { encoding: "utf8" }).trim(),
      shim: shim.kind,
      headless: !headed,
    },
    fixture: {
      transcripts: fixture.transcripts,
      digest: fixture.digest,
      threads: inView,
      transcriptMB: fixture.long.map((thread) => round(thread.bytes / 1e6, 0)),
      largeDiffLines: fixture.atlas.lines,
    },
    options: { runs: RUNS, idleSeconds: IDLE_S, react: reactPass },
    seconds: round((Date.now() - started) / 1000, 0),
    pageErrors: [...pageErrors],
    actions,
  };
  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, `${JSON.stringify(output, null, 2)}\n`);
  log(`wrote ${relative(process.cwd(), outFile)} in ${output.seconds} s`);
  if (output.pageErrors.length) log(`page errors: ${output.pageErrors.join(" | ")}`);
} finally {
  await cleanup();
  if (hostProfile) log(`host profile in ${join(scratch, "host-profile")}`);
}

// ------------------------------------------------------------ the check

if (checkFile) {
  const baseline = JSON.parse(await readFile(checkFile, "utf8"));
  const { lines, failures, warnings } = compare(baseline, output, { tolerance: TOLERANCE });
  for (const warning of warnings) log(`warning: ${warning}`);
  log(lines.join("\n"));
  log(failures.length ? `${failures.length} budget failures` : "the budget holds");
  if (failures.length) process.exit(1);
}
