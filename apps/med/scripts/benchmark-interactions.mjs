// Measures everyday interactions in the production build: sidebars, zen,
// clicks, tabs, workspace switches, and palettes. Each sample records the time
// from the input event to the end of the next rendered frame, an optional
// "ready" milestone, Long Animation Frames, React commits, and (with --trace)
// main-thread work by category from a Chrome trace.
//
// node scripts/benchmark-interactions.mjs [--cli dist/cli.js] [--out file.json]
//   [--runs 9] [--trace] [--source <git checkout>] [--commit <sha>] [--headed]
//
// The fixture is a temporary local clone of --source (default: this checkout)
// at --commit, with working changes and three linked worktrees. The host runs
// with a temporary state directory and home folder; nothing outside the
// temporary directory is written.
import { chromium } from "playwright";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { cpus, loadavg, tmpdir, totalmem } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values: args } = parseArgs({
  options: {
    cli: { type: "string", default: "dist/cli.js" },
    out: { type: "string" },
    runs: { type: "string", default: "9" },
    trace: { type: "boolean", default: false },
    source: { type: "string" },
    commit: { type: "string", default: "3f99788c" },
    only: { type: "string" },
    headed: { type: "boolean", default: false },
    keep: { type: "boolean", default: false },
  },
});
const runs = Number(args.runs);
const only = args.only ? new Set(args.only.split(",")) : null;

function git(cwd, list, input) {
  return execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-C", cwd, ...list], {
    encoding: "utf8",
    input,
    maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
}

// ── Fixture ──────────────────────────────────────────────────────────────
const source = resolve(args.source ?? git(process.cwd(), ["rev-parse", "--show-toplevel"]).trim());
// Canonical: macOS reaches the temporary folder through a /var symlink.
const temp = await realpath(await mkdtemp(join(tmpdir(), "med-interactions-")));
const repo = join(temp, "repo");
git(temp, ["clone", "--quiet", "--no-checkout", source, repo]);
const commit = git(repo, ["rev-parse", args.commit]).trim();
git(repo, ["checkout", "--quiet", "-B", "bench", commit]);
// Working changes: the last ten commits of apps/med, reversed (about 45 files).
const working = git(repo, ["diff", `${commit}~10`, commit, "--", "apps/med"]);
git(repo, ["apply", "-R"], working);
const worktrees = [
  ["bench-a", 5],
  ["bench-b", 20],
  ["bench-c", 40],
];
for (const [branch, back] of worktrees) {
  const path = join(temp, branch);
  git(repo, ["worktree", "add", "--quiet", "-b", branch, path, `${commit}~${back}`]);
  const patch = git(path, ["diff", "HEAD~3", "HEAD", "--", "apps/med"]);
  if (patch) git(path, ["apply", "-R"], patch);
}
const state = join(temp, "state"),
  home = join(temp, "home");
await mkdir(state);
await mkdir(home);

// ── Host ─────────────────────────────────────────────────────────────────
const host = spawn(
  process.execPath,
  [args.cli, repo, "--port", "0", "--no-open", "--state-dir", state],
  {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, MED_HOME_DIR: home, MED_STATE_DIR: state },
  },
);
let hostErrors = "";
host.stderr.on("data", (chunk) => (hostErrors += chunk));
const url = await new Promise((resolveUrl, reject) => {
  let output = "";
  const timeout = setTimeout(
    () => reject(new Error(`Host startup timed out: ${hostErrors}`)),
    30000,
  );
  host.stdout.on("data", (chunk) => {
    output += chunk;
    const match = output.match(/http:\/\/127\.0\.0\.1:\d+[^\s]*/);
    if (match) {
      clearTimeout(timeout);
      resolveUrl(match[0]);
    }
  });
  host.once("exit", (code) => {
    clearTimeout(timeout);
    reject(new Error(`Host exited: ${code} ${hostErrors}`));
  });
});

// ── Page instrumentation ─────────────────────────────────────────────────
function instrument({ workspaces }) {
  try {
    localStorage.setItem("med:welcomed", "1");
    if (!localStorage.getItem("med:workspaces:v1"))
      localStorage.setItem("med:workspaces:v1", JSON.stringify(workspaces));
  } catch {
    /* Storage is available in this benchmark. */
  }
  // A DevTools hook stub: React reports each commit, so a pass can count the
  // components that rendered and the DOM nodes that changed.
  const PERFORMED = 1,
    PLACEMENT = 2,
    UPDATE = 4;
  const bench = {
    counting: false,
    commits: [],
    record(root) {
      let components = 0,
        dom = 0;
      const names = {};
      const stack = [root.current];
      while (stack.length) {
        const fiber = stack.pop();
        const previous = fiber.alternate;
        const tag = fiber.tag;
        if (tag === 0 || tag === 1 || tag === 11 || tag === 14 || tag === 15) {
          if (previous === null || (fiber.flags & PERFORMED) === PERFORMED) {
            components++;
            const type = fiber.type;
            const name =
              type?.displayName ||
              type?.name ||
              type?.render?.name ||
              type?.type?.name ||
              `tag${tag}`;
            names[name] = (names[name] ?? 0) + 1;
          }
        } else if ((tag === 5 || tag === 6) && fiber.flags & (PLACEMENT | UPDATE)) dom++;
        if (fiber.deletions) dom += fiber.deletions.length;
        // A subtree that did not render keeps its child list.
        if (previous !== null && fiber.child === previous.child) continue;
        for (let child = fiber.child; child; child = child.sibling) stack.push(child);
      }
      bench.commits.push({ at: performance.now(), components, dom, names });
    },
  };
  window.__bench = bench;
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    isDisabled: false,
    renderers: new Map(),
    checkDCE() {},
    inject(renderer) {
      const id = this.renderers.size + 1;
      this.renderers.set(id, renderer);
      return id;
    },
    onScheduleFiberRoot() {},
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    onCommitFiberRoot(_id, root) {
      if (bench.counting) bench.record(root);
    },
  };
  bench.loafs = [];
  bench.events = [];
  try {
    new PerformanceObserver((list) => bench.loafs.push(...list.getEntries())).observe({
      type: "long-animation-frame",
      buffered: false,
    });
  } catch {
    /* Older Chromium has no Long Animation Frames. */
  }
  try {
    new PerformanceObserver((list) => bench.events.push(...list.getEntries())).observe({
      type: "event",
      durationThreshold: 16,
    });
  } catch {
    /* Older Chromium has no Event Timing. */
  }

  const visible = (selector) =>
    [...document.querySelectorAll(selector)].find((node) => node.checkVisibility());
  const app = () => visible("[data-review-status]");
  const treeRows = (container) =>
    container?.shadowRoot?.querySelectorAll('[role="treeitem"]').length ?? 0;
  const inView = (node, container) => {
    if (!node || !container) return false;
    const a = node.getBoundingClientRect(),
      b = container.getBoundingClientRect();
    return a.height > 0 && a.top >= b.top - 2 && a.top < b.bottom - 20;
  };
  bench.ready = {
    leftHidden: () => !visible("aside[id$='review-sidebar']"),
    leftShown: () => {
      const aside = visible("aside[id$='review-sidebar']");
      return (
        !!aside &&
        !!aside.querySelector('[role="listbox"][aria-label="Commits"] [role="option"]') &&
        treeRows(aside.querySelector("file-tree-container")) > 0
      );
    },
    filesShown: () => treeRows(visible('[aria-label="Workspace files"] file-tree-container')) > 0,
    filesHidden: () => !visible('[aria-label="Workspace files"]'),
    zenOn: () => !!visible("[data-zen-exit]"),
    zenOff: () => !visible("[data-zen-exit]"),
    diffHeader: (path) => {
      const view = visible('main [role="tabpanel"]');
      return inView(
        [...document.querySelectorAll(`button[role="link"][aria-label="${path}"]`)].find((node) =>
          node.checkVisibility(),
        ),
        view,
      );
    },
    commitShown: (sha) => {
      const root = app();
      return (
        root?.dataset.selectedCommit === sha &&
        root.dataset.reviewStatus === "ready" &&
        !!visible('main button[role="link"][aria-label]')
      );
    },
    workingShown: () => {
      const root = app();
      return root?.dataset.selectedCommit === "" && root.dataset.reviewStatus === "ready";
    },
    fileShown: (path) =>
      app()?.dataset.activeFile === path &&
      !!visible('[data-file-pane="main"] [data-line], main .cm-content .cm-line'),
    changesShown: () =>
      app()?.dataset.activeFile === "" && !!visible('main button[role="link"][aria-label]'),
    commitTab: () => !!visible('[role="tabpanel"][aria-label="Commit"]'),
    workspace: (branch) => app()?.dataset.selectedBranch === branch,
    otherWorkspace: (branch) => {
      const shown = app()?.dataset.selectedBranch;
      return !!shown && shown !== branch;
    },
    switcher: () => !!visible('[aria-label="Recent workspaces"] [role="option"]'),
    palette: () => !!visible('[role="listbox"][aria-label="Commands"] [role="option"]'),
    filePicker: () => !!visible('[role="listbox"][aria-label="Files"] [role="option"]'),
    branchPicker: () =>
      !!visible('[role="listbox"][aria-label="Branches and worktrees"] [role="option"]'),
    noDialog: () => !visible('[role="dialog"]'),
  };

  // Arms one measurement. The input time is the trusted event's timeStamp; the
  // frame ends when a task posted from the next animation frame runs, after
  // style, layout, and paint of that frame.
  bench.arm = ({ event, code, ready, readyArg, settleFrames = 8, timeout = 8000 }) => {
    performance.mark("bench-arm");
    bench.commits = [];
    bench.loafs = [];
    bench.events = [];
    let input = null,
      frame = null;
    const afterFrame = () =>
      new Promise((done) =>
        requestAnimationFrame(() => {
          const channel = new MessageChannel();
          channel.port1.onmessage = () => done(performance.now());
          channel.port2.postMessage(0);
        }),
      );
    bench.result = new Promise((resolveResult, rejectResult) => {
      const types = event === "click" ? ["pointerdown", "click"] : [event];
      const listener = (current) => {
        if (!current.isTrusted) return;
        if (code && current.code !== code) return;
        if (current.type === types[0] && input === null) input = current.timeStamp;
        if (current.type !== types.at(-1) || input === null) return;
        for (const type of types) window.removeEventListener(type, listener, true);
        afterFrame().then(async (end) => {
          frame = end;
          const check = ready ? () => bench.ready[ready](readyArg) : () => true;
          let readyAt = check() ? end : null;
          const started = performance.now();
          while (readyAt === null) {
            if (performance.now() - started > timeout) {
              const view = visible('main [role="tabpanel"]')?.getBoundingClientRect();
              const headers = [
                ...document.querySelectorAll(`button[role="link"][aria-label="${readyArg}"]`),
              ].map((node) => [
                node.checkVisibility(),
                Math.round(node.getBoundingClientRect().top),
              ]);
              rejectResult(
                new Error(
                  `Not ready: ${ready}(${readyArg ?? ""}) ${JSON.stringify({ view: view && [view.top, view.bottom], headers, active: app()?.dataset.activeFile })}`,
                ),
              );
              return;
            }
            const next = await afterFrame();
            if (check()) readyAt = next;
          }
          // Settled: several consecutive frames without a long gap.
          let quiet = 0,
            last = performance.now(),
            settled = last;
          while (quiet < settleFrames && performance.now() - readyAt < 4000) {
            const next = await afterFrame();
            if (next - last < 24) quiet++;
            else {
              quiet = 0;
              settled = next;
            }
            last = next;
          }
          performance.mark("bench-settled");
          const loafs = bench.loafs.filter((entry) => entry.startTime + entry.duration >= input);
          const events = bench.events.filter(
            (entry) => entry.startTime >= input - 1 && entry.interactionId,
          );
          resolveResult({
            frameMs: frame - input,
            readyMs: readyAt - input,
            settledMs: Math.max(settled, readyAt) - input,
            eventTimingMs: events.length
              ? Math.max(...events.map((entry) => entry.duration))
              : null,
            loafCount: loafs.length,
            loafMaxMs: loafs.length ? Math.max(...loafs.map((entry) => entry.duration)) : 0,
            loafBlockingMs: loafs.reduce((sum, entry) => sum + entry.blockingDuration, 0),
            loafScripts: loafs
              .flatMap((entry) => entry.scripts)
              .sort((a, b) => b.duration - a.duration)
              .slice(0, 3)
              .map((script) => ({
                ms: Math.round(script.duration),
                invoker: script.invoker,
                fn: script.sourceFunctionName,
                at: `${script.sourceURL.split("/").at(-1)}:${script.sourceCharPosition}`,
              })),
            commits: bench.commits.length,
            components: bench.commits.reduce((sum, entry) => sum + entry.components, 0),
            dom: bench.commits.reduce((sum, entry) => sum + entry.dom, 0),
            names: bench.counting
              ? Object.entries(
                  bench.commits.reduce((all, entry) => {
                    for (const [name, count] of Object.entries(entry.names))
                      all[name] = (all[name] ?? 0) + count;
                    return all;
                  }, {}),
                )
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 12)
              : undefined,
          });
        }, rejectResult);
      };
      for (const type of types) window.addEventListener(type, listener, true);
    });
    bench.result.catch(() => {});
  };
}

// ── Trace analysis ───────────────────────────────────────────────────────
const categories = [
  "devtools.timeline",
  "disabled-by-default-devtools.timeline",
  "blink.user_timing",
  "v8.execute",
];
function categorize(name) {
  if (/^(MinorGC|MajorGC|V8\.GC|BlinkGC|GCEvent|ThreadState::)/.test(name)) return "gc";
  if (/^(UpdateLayoutTree|RecalculateStyles|ParseAuthorStyleSheet|StyleRecalc)/.test(name))
    return "style";
  if (/^(Layout|ComputeIntersections|IntersectionObserver|UpdateLayout$)/.test(name))
    return "layout";
  if (/^(Paint|PrePaint|Layerize|UpdateLayer|Commit|CompositeLayers|PaintImage|Decode)/.test(name))
    return "paint";
  if (
    /^(FunctionCall|EvaluateScript|EventDispatch|TimerFire|FireAnimationFrame|RunMicrotasks|HandlePostMessage|FireIdleCallback|v8\.|V8\.|ProfileCall|ResizeObserver|XHR|ParseHTML|CompileScript|CompileCode|CacheScript|StreamingCompile)/.test(
      name,
    )
  )
    return "script";
  return "other";
}
function analyseTrace(json, windows) {
  const events = json.traceEvents ?? json;
  const marks = events.filter(
    (event) => event.cat?.includes("blink.user_timing") && event.name?.startsWith("bench-"),
  );
  if (!marks.length) return [];
  const { pid, tid } = marks[0];
  const main = events
    .filter((event) => event.pid === pid && event.tid === tid && event.ph === "X" && event.dur)
    .sort((a, b) => a.ts - b.ts || b.dur - a.dur);
  const arms = marks.filter((mark) => mark.name === "bench-arm").map((mark) => mark.ts);
  const ends = marks.filter((mark) => mark.name === "bench-settled").map((mark) => mark.ts);
  return windows.map((label, index) => {
    const start = arms[index],
      end = ends[index];
    const totals = { script: 0, style: 0, layout: 0, paint: 0, gc: 0, other: 0 };
    let busy = 0,
      longest = 0;
    const stack = [];
    for (const event of main) {
      if (event.ts < start || event.ts > end) continue;
      while (stack.length && stack.at(-1).ts + stack.at(-1).dur <= event.ts) stack.pop();
      const parent = stack.at(-1);
      if (parent) parent.self -= event.dur;
      else {
        busy += event.dur;
        longest = Math.max(longest, event.dur);
      }
      const entry = { ts: event.ts, dur: event.dur, self: event.dur, name: event.name };
      stack.push(entry);
      event.__entry = entry;
    }
    for (const event of main) {
      if (!event.__entry) continue;
      totals[categorize(event.name)] += Math.max(0, event.__entry.self);
      delete event.__entry;
    }
    const ms = (value) => Math.round(value / 100) / 10;
    return {
      label,
      busyMs: ms(busy),
      longestTaskMs: ms(longest),
      ...Object.fromEntries(Object.entries(totals).map(([key, value]) => [`${key}Ms`, ms(value)])),
    };
  });
}

// ── Interactions ─────────────────────────────────────────────────────────
const browser = await chromium.launch({ headless: !args.headed });
const results = {};
const errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  if (process.env.BENCH_DEBUG)
    page.on("response", (response) => {
      if (response.url().includes("/api/"))
        console.error(response.status(), response.url().replace(/^https?:\/\/[^/]+/, ""));
    });
  const ids = ["w_home", "w_a", "w_b", "w_c"];
  const workspaces = {
    workspaces: [
      { id: "w_home", kind: "repository", home: true, path: repo, branch: "bench" },
      ...worktrees.map(([branch], index) => ({
        id: ids[index + 1],
        kind: "repository",
        path: join(temp, branch),
        branch,
      })),
    ],
    active: "w_home",
    recent: ids,
  };
  await page.addInitScript(instrument, { workspaces });
  await page.goto(url);
  const visibleApp = page.locator('[data-review-status="ready"]:visible');
  await visibleApp.waitFor();
  // The pool mounts the other workspaces while idle.
  await page.waitForFunction(
    () => document.querySelectorAll("[data-review-status]").length >= 4,
    null,
    {
      timeout: 60000,
    },
  );
  const hiddenStatus = await page.evaluate(() =>
    [...document.querySelectorAll("[data-review-status]")].map((node) => node.dataset.reviewStatus),
  );
  console.error("Workspace roots before measuring:", hiddenStatus.join(", "));
  await page.waitForTimeout(1500);

  // The trees keep their own scroll offsets; the measured clicks start from the top.
  const scrollTreeTop = (label) =>
    page.evaluate(async (label) => {
      const tree = [...document.querySelectorAll(`${label} file-tree-container`)].find((node) =>
        node.checkVisibility(),
      );
      for (const node of tree.shadowRoot.querySelectorAll("*"))
        if (
          node.scrollHeight > node.clientHeight &&
          /auto|scroll/.test(getComputedStyle(node).overflowY)
        )
          node.scrollTop = 0;
      await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    }, label);
  await scrollTreeTop('aside [aria-label="Changed files"]');
  // Rows inside the tree's visible area; the tree mounts a few more below it.
  const changedFiles = await page.evaluate(() => {
    const tree = document.querySelector('aside [aria-label="Changed files"] file-tree-container');
    const bounds = tree.getBoundingClientRect();
    return [...tree.shadowRoot.querySelectorAll('[data-item-type="file"]')]
      .filter((row) => {
        const rect = row.getBoundingClientRect();
        return (
          row.dataset.itemGitStatus !== "deleted" &&
          rect.top >= bounds.top &&
          rect.bottom <= bounds.bottom
        );
      })
      .map((row) => row.dataset.itemPath);
  });
  if (changedFiles.length < 2) throw new Error(`Too few changed-file rows: ${changedFiles}`);
  const commitIds = await page.evaluate(() =>
    [
      ...document.querySelectorAll(
        '[role="listbox"][aria-label="Commits"] [role="option"][id^="commit-"]',
      ),
    ]
      .filter((node) => node.checkVisibility())
      .map((node) => node.id.slice("commit-".length)),
  );

  const blur = () => page.evaluate(() => document.activeElement?.blur?.());
  const key = (combo, code) => ({
    event: "keydown",
    code,
    perform: () => page.keyboard.press(combo),
  });
  // Playwright's hit check does not see a row that its tree has scrolled out of
  // view, so the row is scrolled into view before the measurement starts.
  const clickTree = (label, path, ready, prepare) => {
    const target = () => (typeof path === "function" ? path() : path);
    const row = () =>
      page
        .locator(`${label} file-tree-container`)
        .filter({ visible: true })
        .locator(`[data-item-type="file"][data-item-path="${target()}"]`);
    return {
      event: "click",
      ready,
      get readyArg() {
        return target();
      },
      before: async () => {
        await prepare?.();
        await row().evaluate((node) => node.scrollIntoView({ block: "nearest" }));
        await page.waitForTimeout(100);
      },
      perform: () => row().click(),
    };
  };
  // Two unselected files that the files tree shows when it first opens; which
  // folders are open depends on the selected file.
  const treeFiles = [];
  const chooseTreeFiles = async () => {
    if (treeFiles.length) return;
    treeFiles.push(
      ...(await page.evaluate(() => {
        const tree = [
          ...document.querySelectorAll('[aria-label="Workspace files"] file-tree-container'),
        ].find((node) => node.checkVisibility());
        const bounds = tree.getBoundingClientRect();
        return [...tree.shadowRoot.querySelectorAll('[data-item-type="file"]')]
          .filter((row) => {
            const rect = row.getBoundingClientRect();
            return (
              row.getAttribute("aria-selected") !== "true" &&
              rect.top >= bounds.top &&
              rect.bottom <= bounds.bottom
            );
          })
          .slice(0, 2)
          .map((row) => row.dataset.itemPath);
      })),
    );
    if (treeFiles.length < 2) throw new Error("The files tree shows fewer than two files.");
  };

  async function sample(name, spec, mode) {
    await page.evaluate(
      ({ spec, counting }) => {
        window.__bench.counting = counting;
        window.__bench.arm(spec);
      },
      {
        spec: {
          event: spec.event,
          code: spec.code,
          ready: spec.ready,
          readyArg: spec.readyArg,
          timeout: spec.timeout,
        },
        counting: mode === "count",
      },
    );
    await spec.perform();
    const result = await page.evaluate(() => window.__bench.result);
    await page.evaluate(() => (window.__bench.counting = false));
    (results[name] ??= { samples: [], counts: [], trace: [] })[
      mode === "count" ? "counts" : "samples"
    ].push(result);
    await page.waitForTimeout(120);
  }

  /** Each group returns pairs [name, spec] that leave the page as it began. */
  // Near the top of the tree, so a remounted tree has them too; five files apart
  // in the diff stream.
  const fileA = changedFiles[0],
    fileB = changedFiles[Math.min(5, changedFiles.length - 1)];
  const groups = [
    [
      ["left-sidebar-hide", { ...key("Meta+b", "KeyB"), ready: "leftHidden" }],
      ["left-sidebar-show", { ...key("Meta+b", "KeyB"), ready: "leftShown" }],
    ],
    [
      ["files-sidebar-show", { ...key("Meta+Shift+b", "KeyB"), ready: "filesShown" }],
      ["files-sidebar-hide", { ...key("Meta+Shift+b", "KeyB"), ready: "filesHidden" }],
    ],
    [
      ["zen-on", { ...key("Alt+z", "KeyZ"), ready: "zenOn", before: blur }],
      ["zen-off", { ...key("Alt+z", "KeyZ"), ready: "zenOff", before: blur }],
    ],
    [
      [
        "changed-file-click",
        clickTree('aside [aria-label="Changed files"]', fileB, "diffHeader", () =>
          scrollTreeTop('aside [aria-label="Changed files"]'),
        ),
      ],
      [
        "changed-file-click-back",
        clickTree('aside [aria-label="Changed files"]', fileA, "diffHeader", () =>
          scrollTreeTop('aside [aria-label="Changed files"]'),
        ),
      ],
    ],
    [
      ["palette-open", { ...key("Meta+k", "KeyK"), ready: "palette" }],
      ["palette-close", { ...key("Escape", "Escape"), ready: "noDialog" }],
    ],
    [
      ["file-picker-open", { ...key("Meta+Shift+k", "KeyK"), ready: "filePicker" }],
      ["file-picker-close", { ...key("Escape", "Escape"), ready: "noDialog" }],
    ],
    [
      ["branch-picker-open", { ...key("Meta+Shift+g", "KeyG"), ready: "branchPicker" }],
      ["branch-picker-close", { ...key("Escape", "Escape"), ready: "noDialog" }],
    ],
    [
      ["commit-tab-open", { ...key("q", "KeyQ"), ready: "commitTab", before: blur }],
      ["commit-tab-close", { ...key("q", "KeyQ"), ready: "changesShown", before: blur }],
    ],
    [
      ["workspace-key-2", { ...key("Meta+2", "Digit2"), ready: "workspace", readyArg: "bench-a" }],
      ["workspace-key-1", { ...key("Meta+1", "Digit1"), ready: "workspace", readyArg: "bench" }],
    ],
    [
      [
        "workspace-row-click",
        {
          event: "click",
          perform: () =>
            page
              .locator('nav[aria-label="Workspaces"] button[aria-keyshortcuts^="Meta+3"]')
              .filter({ visible: true })
              .click(),
          ready: "workspace",
          readyArg: "bench-b",
        },
      ],
      ["workspace-row-back", { ...key("Meta+1", "Digit1"), ready: "workspace", readyArg: "bench" }],
    ],
    [
      [
        "ctrl-tab-open",
        {
          event: "keydown",
          code: "Tab",
          perform: async () => {
            await page.keyboard.down("Control");
            await page.keyboard.press("Tab");
          },
          ready: "switcher",
        },
      ],
      [
        "ctrl-tab-release",
        {
          event: "keyup",
          code: "ControlLeft",
          perform: () => page.keyboard.up("Control"),
          ready: "otherWorkspace",
          readyArg: "bench",
        },
      ],
      ["ctrl-tab-back", { ...key("Meta+1", "Digit1"), ready: "workspace", readyArg: "bench" }],
    ],
    [
      ["files-sidebar-open-for-tree", { ...key("Meta+Shift+b", "KeyB"), ready: "filesShown" }],
      [
        "tree-row-click",
        clickTree(
          '[aria-label="Workspace files"]',
          () => treeFiles[0],
          "fileShown",
          async () => {
            await scrollTreeTop('[aria-label="Workspace files"]');
            await chooseTreeFiles();
          },
        ),
      ],
      [
        "tree-row-click-other",
        clickTree(
          '[aria-label="Workspace files"]',
          () => treeFiles[1],
          "fileShown",
          () => scrollTreeTop('[aria-label="Workspace files"]'),
        ),
      ],
      [
        "tab-changes",
        {
          event: "click",
          perform: () =>
            page
              .getByRole("tab", { name: "Changes", exact: true })
              .filter({ visible: true })
              .click(),
          ready: "changesShown",
        },
      ],
      [
        "tab-file",
        {
          event: "click",
          perform: () =>
            page
              .locator(`[role="tab"][title^="${treeFiles[1]}"]`)
              .filter({ visible: true })
              .click(),
          ready: "fileShown",
          get readyArg() {
            return treeFiles[1];
          },
        },
      ],
      [
        "tab-changes-again",
        {
          event: "click",
          perform: () =>
            page
              .getByRole("tab", { name: "Changes", exact: true })
              .filter({ visible: true })
              .click(),
          ready: "changesShown",
        },
      ],
      ["files-sidebar-close-for-tree", { ...key("Meta+Shift+b", "KeyB"), ready: "filesHidden" }],
    ],
    [
      [
        "history-commit-click",
        {
          event: "click",
          perform: () =>
            page.locator(`[id="commit-${commitIds[1]}"]`).filter({ visible: true }).click(),
          ready: "commitShown",
          readyArg: commitIds[1],
          timeout: 15000,
        },
      ],
      [
        "history-commit-click-other",
        {
          event: "click",
          perform: () =>
            page.locator(`[id="commit-${commitIds[2]}"]`).filter({ visible: true }).click(),
          ready: "commitShown",
          readyArg: commitIds[2],
          timeout: 15000,
        },
      ],
      [
        "history-working-click",
        {
          event: "click",
          perform: () =>
            page
              .getByRole("button", { name: "Working changes", exact: true })
              .filter({ visible: true })
              .click(),
          ready: "workingShown",
          timeout: 15000,
        },
      ],
    ],
  ];

  async function pass(mode, repeat) {
    for (const group of groups) {
      if (only && !group.some(([name]) => only.has(name))) continue;
      // One unmeasured round warms caches, lazy chunks, and first mounts.
      for (let round = mode === "warm" ? 0 : 1; round <= (mode === "warm" ? 0 : repeat); round++)
        for (const [name, spec] of group) {
          await spec.before?.();
          if (mode === "warm") {
            await sample(`warm:${name}`, spec, "time");
            continue;
          }
          await sample(name, spec, mode);
        }
    }
  }
  await pass("warm");
  for (const name of Object.keys(results)) if (name.startsWith("warm:")) delete results[name];
  await pass("time", runs);
  await pass("count", 1);
  if (args.trace) {
    const order = [];
    for (const group of groups) {
      if (only && !group.some(([name]) => only.has(name))) continue;
      for (let round = 0; round < 3; round++) for (const [name] of group) order.push(name);
    }
    await browser.startTracing(page, { categories });
    for (const group of groups) {
      if (only && !group.some(([name]) => only.has(name))) continue;
      for (let round = 0; round < 3; round++)
        for (const [name, spec] of group) {
          await spec.before?.();
          await sample(`trace:${name}`, spec, "time");
        }
    }
    const buffer = await browser.stopTracing();
    for (const entry of analyseTrace(JSON.parse(buffer.toString()), order))
      (results[entry.label] ??= { samples: [], counts: [], trace: [] }).trace.push(entry);
    for (const name of Object.keys(results)) if (name.startsWith("trace:")) delete results[name];
  }
} finally {
  await browser.close();
  host.kill();
  if (!args.keep) await rm(temp, { recursive: true, force: true });
}

// ── Report ───────────────────────────────────────────────────────────────
const median = (list) => {
  const sorted = list.filter((value) => value !== null).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = sorted.length / 2;
  return sorted.length % 2 ? sorted[Math.floor(middle)] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const round = (value) => (value === null ? null : Math.round(value * 10) / 10);
const summary = Object.fromEntries(
  Object.entries(results).map(([name, { samples, counts, trace }]) => [
    name,
    {
      frameMs: round(median(samples.map((sample) => sample.frameMs))),
      frameMaxMs: round(Math.max(...samples.map((sample) => sample.frameMs))),
      readyMs: round(median(samples.map((sample) => sample.readyMs))),
      settledMs: round(median(samples.map((sample) => sample.settledMs))),
      eventTimingMs: round(median(samples.map((sample) => sample.eventTimingMs))),
      loafMaxMs: round(median(samples.map((sample) => sample.loafMaxMs))),
      components: counts[0]?.components,
      commits: counts[0]?.commits,
      dom: counts[0]?.dom,
      topComponents: counts[0]?.names,
      ...(trace.length
        ? Object.fromEntries(
            Object.keys(trace[0])
              .filter((key) => key !== "label")
              .map((key) => [key, round(median(trace.map((entry) => entry[key])))]),
          )
        : {}),
    },
  ]),
);
const report = {
  date: new Date().toISOString(),
  cli: args.cli,
  commit,
  runs,
  machine: {
    cpu: cpus()[0]?.model,
    cores: cpus().length,
    memoryGiB: Math.round(totalmem() / 2 ** 30),
    loadAverage: loadavg().map((value) => Math.round(value * 100) / 100),
    node: process.version,
    chromium: browser.version(),
  },
  method:
    "Headless Chromium 1440x1000, production build. frameMs: trusted input event timeStamp to a task posted from the next animation frame. readyMs: to the frame in which the visible result is present. settledMs: to the start of eight consecutive frames under 24 ms. Medians of the timed runs; components/dom from one counting run (React DevTools hook); trace columns are medians of three traced runs (self time on the renderer main thread between arming and settling).",
  summary,
  errors,
  results,
};
const text = JSON.stringify(report, null, 2) + "\n";
if (args.out) await writeFile(args.out, text);
const table = Object.entries(summary).map(([name, value]) => ({
  name,
  frame: value.frameMs,
  ready: value.readyMs,
  settled: value.settledMs,
  loaf: value.loafMaxMs,
  comps: value.components,
  dom: value.dom,
  ...(value.busyMs !== undefined
    ? {
        busy: value.busyMs,
        script: value.scriptMs,
        style: value.styleMs,
        layout: value.layoutMs,
        paint: value.paintMs,
      }
    : {}),
}));
console.table(table);
if (errors.length) console.log("Errors:", errors);
