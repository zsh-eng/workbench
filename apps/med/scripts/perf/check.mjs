// Compares a budget run with a baseline.
//
//   node scripts/perf/check.mjs <baseline.json> <run.json> [--tolerance 0.25]
//
// budget.mjs --check runs the same comparison after a run. The rules:
// - Git processes compare the fewest over the runs (periodic host work adds
//   to some windows, never takes away) and fail when they go up at all.
//   Requests and WebSocket messages do the same, but can go up by one: some
//   requests depend on how long ago Med read a thread.
// - React commits and renders compare medians and fail above 15% more (React
//   batches by timing).
// - Bytes compare the mean (a median would pick one thread's size) and fail
//   above 25% more: a resumed session stream sends less, by timing.
// - Memory, when all threads have loaded, fails above 10% more.
// - A time fails when its median grows by more than the tolerance and by 5 ms
//   or more (20 ms for host CPU, which `ps` gives in 10 ms steps). When the
//   load is more than 1.5 times the baseline's plus 1, a slower time is a
//   warning, not a failure.
// - Racy windows: the first key after a load races the warm pool; warm visits
//   to the large diff fetch its review (568 kB) on some visits only, by
//   timing; the windows of one run (agent steps, idle) race periodic work.
//   Their counts compare medians and allow 25% (in one-run windows, at least
//   15: one checkout-work recount starts a process for each thread). Their
//   bytes fail when they double. The one-run windows check no React counts
//   (the React pass runs other agent steps) and, of their times, only host
//   CPU, which fails when it doubles.
// Gains print too.
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

/** The budget: which values it checks, and how. */
export const BUDGET = [
  [
    "count",
    [
      "git.count",
      "http.count",
      "http.api",
      "ws.messages",
      "react.commits",
      "react.renders",
      "workers",
      "slots",
    ],
  ],
  ["bytes", ["http.bytes", "ws.bytes"]],
  ["memory", ["heapMB", "workerHeapMB", "nodes", "listeners"]],
  [
    "time",
    [
      "ms.LIST",
      "ms.COMMIT",
      "ms.PAINTED",
      "ms.SESSION",
      "ms.SHOWN",
      "ms.SETTLED",
      "host.cpu",
      "browser.taskMs",
      "react.ms",
      "main.script",
      "main.layout",
      "main.style",
      "longestTask",
    ],
  ],
];

/** Windows of one run, with periodic host work: a count can move by one period. */
const ONE_RUN = new Set(["idle1", "idle2", "agentSteps"]);
/** Windows that race the warm pool or a refresh timer, and the one-run windows. */
const RACY = new Set([...ONE_RUN, "firstKey", "warmLargeDiff"]);

const get = (object, path) => path.split(".").reduce((value, key) => value?.[key], object);

/** The value to compare: the fewest, the mean, or the median. */
function pick(entry, kind, path, racy) {
  if (!racy && kind === "count" && entry.min?.[path] !== undefined) return entry.min[path];
  if (kind === "bytes" && entry.mean?.[path] !== undefined) return entry.mean[path];
  return get(entry.median, path);
}

/** Returns { lines, failures, warnings }. */
export function compare(baseline, run, { tolerance = 0.25 } = {}) {
  const lines = [];
  const failures = [];
  const warnings = [];
  if (baseline.fixture?.digest !== run.fixture?.digest)
    warnings.push(
      `the baseline used another test bed (${baseline.fixture?.transcripts} ${baseline.fixture?.digest}, now ${run.fixture?.transcripts} ${run.fixture?.digest}); counts can differ`,
    );
  for (const [action, entry] of Object.entries(run.actions ?? {})) {
    const before = baseline.actions?.[action];
    if (!before?.median) continue;
    const racy = RACY.has(action);
    const periodic = ONE_RUN.has(action);
    // Times from a much busier machine are not comparable.
    const busy =
      typeof entry.load === "number" &&
      typeof before.load === "number" &&
      entry.load > before.load * 1.5 + 1;
    for (const [kind, paths] of BUDGET)
      for (const path of paths) {
        // A page load's memory depends on how far the warm pool has gone.
        if (kind === "memory" && action !== "memory") continue;
        const now = pick(entry, kind, path, racy);
        const was = pick(before, kind, path, racy);
        if (typeof now !== "number" || typeof was !== "number") continue;
        // The React pass makes one run of the one-run windows, with other agent steps.
        if (periodic && path.startsWith("react.")) continue;
        let slack;
        if (kind === "time") {
          if (periodic && path !== "host.cpu") continue;
          // Host CPU in one idle minute moves with the load; only a double fails.
          const allowed = periodic ? 1 : tolerance;
          slack = Math.max(was * allowed, path === "host.cpu" ? 20 : 5);
        } else if (kind === "bytes") slack = racy ? was : was * 0.25;
        else if (kind === "memory") slack = was * 0.1;
        else if (racy) slack = Math.max(periodic ? 15 : 1, was * 0.25);
        else slack = path.startsWith("react.") ? was * 0.15 : path === "git.count" ? 0 : 1;
        const bad = now > was + slack;
        const better = now < was - slack;
        const soft = bad && busy && kind === "time";
        if (bad || better)
          lines.push(`${soft ? "slow" : bad ? "FAIL" : "gain"} ${action}.${path}: ${was} → ${now}`);
        if (bad && !soft) failures.push(`${action}.${path}`);
        if (soft && !warnings.some((line) => line.startsWith(`${action}:`)))
          warnings.push(
            `${action}: the load was ${entry.load}, against ${before.load} for the baseline; slower times do not fail`,
          );
      }
  }
  lines.push(
    `load (1-minute average, median of the warm switches): baseline ${baseline.actions?.warmSwitch?.load}, now ${run.actions?.warmSwitch?.load}`,
  );
  return { lines, failures, warnings };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2);
  const index = args.indexOf("--tolerance");
  const tolerance = index >= 0 ? Number(args.splice(index, 2)[1]) : 0.25;
  const [baselineFile, runFile] = args;
  if (!baselineFile || !runFile) {
    console.error(
      "Usage: node scripts/perf/check.mjs <baseline.json> <run.json> [--tolerance 0.25]",
    );
    process.exit(2);
  }
  const [baseline, run] = await Promise.all(
    [baselineFile, runFile].map(async (file) => JSON.parse(await readFile(file, "utf8"))),
  );
  const { lines, failures, warnings } = compare(baseline, run, { tolerance });
  for (const warning of warnings) console.log(`warning: ${warning}`);
  console.log(lines.join("\n"));
  console.log(failures.length ? `${failures.length} budget failures` : "the budget holds");
  process.exit(failures.length ? 1 : 0);
}
