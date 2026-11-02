/**
 * IndexedDB lab: how long synthetic Spaced rows take to store, one thing
 * changed at a time, in a new browser profile for each run.
 *
 *   bun scripts/idb-lab/run.ts --browser leveldb-156 --runs 3 --out out.jsonl \
 *     --label base --config '{"batch":500}'
 *   bun scripts/idb-lab/run.ts --plan plan.json --rounds 3 --out out.jsonl
 *
 * A plan is `[{label, browser, config, limit?}]`; each round runs every
 * entry once, so slow spells of the machine fall on all of them.
 *
 * Browsers: see BROWSERS. `otr` is an off-the-record context: what
 * `bun run kit time` and the restore lab used. The rest keep a profile on
 * disk, as a person's browser does. Firefox is the one in /Applications,
 * driven by its URL, because Playwright needs its own build.
 *
 * For a LevelDB store, `--levels` reads the MANIFEST every 100 ms and notes
 * the files of each level; `--trace <file>` records a Chrome trace of the
 * run. The port is RESTORE_IDB_PORT (5668).
 */
import {
  chromium,
  webkit,
  type Browser,
  // The kit's Playwright: its WebKit build is the one installed.
} from "../../../../packages/agent-kit/node_modules/@playwright/test/index.js";
import { spawn, spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, loadavg, tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { decodeSyncKey } from "@zsh-eng/local-sync";
import { labChanges, type LabSize } from "../restore-lab";
import type { BenchConfig, BenchResult, Row } from "./page";
import { readLevels, type LevelSample } from "./leveldb";

const { values: options } = parseArgs({
  options: {
    browser: { type: "string", default: "disk-147" },
    size: { type: "string", default: "large" },
    runs: { type: "string", default: "3" },
    rounds: { type: "string", default: "3" },
    plan: { type: "string" },
    out: { type: "string" },
    label: { type: "string", default: "" },
    config: { type: "string", default: "{}" },
    trace: { type: "string" },
    categories: { type: "string", default: "IndexedDB" },
    levels: { type: "boolean", default: false },
    keep: { type: "boolean", default: false },
    args: { type: "string", default: "" },
    base: { type: "string", default: join(tmpdir(), "idb-lab") },
  },
});

const PORT = Number(process.env.RESTORE_IDB_PORT ?? 5668);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const CACHE = join(homedir(), "Library/Caches/ms-playwright");
const TESTING =
  "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const SHELL_147 = join(
  CACHE,
  "chromium_headless_shell-1217/chrome-headless-shell-mac-arm64/chrome-headless-shell",
);
const CHROMIUM_147 = join(CACHE, "chromium-1217", TESTING);
const CHROMIUM_153 = join(CACHE, "chromium-1243", TESTING);
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const FIREFOX = "/Applications/Firefox.app/Contents/MacOS/firefox";
const SQLITE_ON_DISK =
  "--enable-features=IdbSqliteOnDiskRollout:stage/UseSqliteForNewStores";

interface Spec {
  engine: "chromium" | "webkit" | "firefox" | "simulator";
  path?: string;
  disk: boolean;
  args?: string[];
}
const BROWSERS: Record<string, Spec> = {
  // What the restore lab ran: the kit's headless shell, off the record.
  "otr-147": { engine: "chromium", path: SHELL_147, disk: false },
  "disk-147": { engine: "chromium", path: SHELL_147, disk: true },
  "full-147": { engine: "chromium", path: CHROMIUM_147, disk: true },
  "otr-153": { engine: "chromium", path: CHROMIUM_153, disk: false },
  "disk-153": { engine: "chromium", path: CHROMIUM_153, disk: true },
  // Chrome stable: LevelDB for a store it finds, SQLite for a new one once
  // the rollout reaches it.
  "otr-156": { engine: "chromium", path: CHROME, disk: false },
  "leveldb-156": { engine: "chromium", path: CHROME, disk: true },
  "sqlite-156": {
    engine: "chromium",
    path: CHROME,
    disk: true,
    args: [SQLITE_ON_DISK],
  },
  webkit: { engine: "webkit", disk: true },
  "webkit-otr": { engine: "webkit", disk: false },
  firefox: { engine: "firefox", path: FIREFOX, disk: true },
  // Mobile Safari in a booted iOS simulator: IDB_LAB_SIMULATOR is its UDID.
  "ios-simulator": {
    engine: "simulator",
    path: process.env.IDB_LAB_SIMULATOR,
    disk: true,
  },
};

const size = options.size as LabSize;
/** Fixed, so that every run stores the same bytes. */
const LAB_NOW = Date.UTC(2026, 9, 29);
const DEFAULTS: BenchConfig = {
  api: "dexie",
  indexes: 2,
  batch: 500,
  durability: "default",
  outbox: true,
};

/** The server's order: a key written again moves to the end, once. */
function labRows(): Row[] {
  const rows = new Map<string, Row>();
  for (const change of labChanges(size, LAB_NOW)) {
    const [table] = decodeSyncKey(change.key);
    rows.delete(change.key);
    rows.set(change.key, { table, row: JSON.parse(change.value) } as Row);
  }
  return [...rows.values()];
}

let posted: ((body: string) => void) | undefined;

async function startServer() {
  const built = await Bun.build({
    entrypoints: [join(import.meta.dir, "page.ts")],
    target: "browser",
    format: "iife",
    minify: true,
  });
  if (!built.success) throw new Error("Lab page failed to build");
  const script = await built.outputs[0]!.text();
  const rows = new TextEncoder().encode(JSON.stringify(labRows()));
  return Bun.serve({
    port: PORT,
    hostname: "127.0.0.1",
    maxRequestBodySize: 1 << 28,
    idleTimeout: 0,
    async fetch(request) {
      const { pathname } = new URL(request.url);
      if (process.env.IDB_LAB_DEBUG) console.log(request.method, pathname);
      if (pathname === "/result") {
        posted?.(await request.text());
        return new Response("ok");
      }
      if (pathname === "/page.js")
        return new Response(script, {
          headers: { "Content-Type": "text/javascript" },
        });
      if (pathname === "/rows.json")
        return new Response(rows, {
          headers: { "Content-Type": "application/json" },
        });
      return new Response(
        `<!doctype html><meta charset="utf-8"><title>IDB lab</title><script src="/page.js"></script>`,
        { headers: { "Content-Type": "text/html" } },
      );
    },
  });
}

function dirBytes(dir: string): number {
  if (!existsSync(dir)) return 0;
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    try {
      total += entry.isDirectory() ? dirBytes(path) : statSync(path).size;
    } catch {
      // Gone between the listing and the stat.
    }
  }
  return total;
}

/** Each directory under `root` with this name. */
function findDirs(root: string, name: string, depth = 0): string[] {
  if (!existsSync(root) || depth > 8) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isDirectory()) return [];
    const path = join(root, entry.name);
    return entry.name === name ? [path] : findDirs(path, name, depth + 1);
  });
}

function storeBytes(profile: string) {
  const dirs = ["IndexedDB", "idb"].flatMap((name) => findDirs(profile, name));
  return dirs.reduce((sum, dir) => sum + dirBytes(dir), 0);
}

function tree(dir: string, depth = 0): string[] {
  if (!existsSync(dir) || depth > 4) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? [
          `${entry.name}/`,
          ...tree(join(dir, entry.name), depth + 1).map((line) => `  ${line}`),
        ]
      : [`${entry.name} ${statSync(join(dir, entry.name)).size}`],
  );
}

/** Firefox: a new profile, no first-run pages, the run in the URL. */
async function runFirefox(profile: string, config: BenchConfig) {
  writeFileSync(
    join(profile, "user.js"),
    [
      `user_pref("browser.aboutwelcome.enabled", false);`,
      `user_pref("browser.shell.checkDefaultBrowser", false);`,
      `user_pref("datareporting.policy.dataSubmissionEnabled", false);`,
      `user_pref("toolkit.telemetry.reportingpolicy.firstRun", false);`,
      `user_pref("browser.startup.homepage_override.mstone", "ignore");`,
      `user_pref("app.update.enabled", false);`,
      `user_pref("browser.tabs.warnOnClose", false);`,
    ].join("\n"),
  );
  const result = new Promise<string>((done) => (posted = done));
  const url = `${ORIGIN}/?auto=${encodeURIComponent(JSON.stringify({ config, size }))}`;
  const child = spawn(
    FIREFOX,
    ["-headless", "-no-remote", "-profile", profile, "-new-instance", url],
    {
      stdio: process.env.IDB_LAB_DEBUG ? "inherit" : "ignore",
      // Its own home, so that nothing touches the person's Firefox folders.
      env: { ...process.env, HOME: profile, CFFIXED_USER_HOME: profile },
    },
  );
  const load = loadavg()[0]!;
  const closed = new Promise((done) => child.once("exit", done));
  try {
    const body = await Promise.race([
      result,
      new Promise<string>((_, fail) =>
        setTimeout(() => fail(new Error("Firefox run timed out")), 600_000),
      ),
    ]);
    posted = undefined;
    const line = JSON.parse(body) as BenchResult & { error?: string };
    if (line.error) throw new Error(line.error);
    return { result: line, load, disk: storeBytes(profile), layout: undefined };
  } finally {
    child.kill("SIGTERM");
    await closed;
  }
}

/** Mobile Safari: the same store each time, deleted before the run. */
async function runSimulator(udid: string, config: BenchConfig) {
  const result = new Promise<string>((done) => (posted = done));
  const auto = JSON.stringify({ config: { ...config, reset: true }, size });
  const url = `${ORIGIN}/?auto=${encodeURIComponent(auto)}`;
  const load = loadavg()[0]!;
  spawnSync("xcrun", ["simctl", "openurl", udid, url], { stdio: "inherit" });
  const body = await Promise.race([
    result,
    new Promise<string>((_, fail) =>
      setTimeout(() => fail(new Error("Simulator run timed out")), 900_000),
    ),
  ]);
  posted = undefined;
  const line = JSON.parse(body) as BenchResult & { error?: string };
  spawnSync("xcrun", ["simctl", "terminate", udid, "com.apple.mobilesafari"]);
  if (line.error) throw new Error(line.error);
  return { result: line, load, disk: 0, layout: undefined };
}

interface Entry {
  label: string;
  browser: string;
  config: Partial<BenchConfig>;
}

async function chromeLike(
  profile: string,
  spec: Spec,
  config: BenchConfig,
  index: number,
  total: number,
) {
  const engine = spec.engine === "webkit" ? webkit : chromium;
  const launch = {
    headless: true,
    timeout: 45_000,
    args: [...(spec.args ?? []), ...options.args!.split(" ").filter(Boolean)],
    ...(spec.path ? { executablePath: spec.path } : {}),
  };
  let browser: Browser | undefined;
  const context = spec.disk
    ? await engine.launchPersistentContext(profile, launch)
    : await (browser = await engine.launch(launch)).newContext();
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(ORIGIN);

  const samples: LevelSample[] = [];
  const started = Date.now();
  const timer =
    options.levels && spec.disk
      ? setInterval(() => {
          for (const dir of findDirs(profile, "IndexedDB").flatMap((root) =>
            readdirSync(root).map((name) => join(root, name)),
          )) {
            if (!dir.endsWith(".leveldb")) continue;
            const sample = readLevels(dir);
            if (sample) samples.push({ ...sample, t: Date.now() - started });
          }
        }, 100)
      : undefined;

  const cdp =
    spec.engine === "chromium" && options.trace
      ? await context.newCDPSession(page)
      : undefined;
  const tracing = cdp
    ? new Promise<string>((done) =>
        cdp.on("Tracing.tracingComplete", (event) => done(event.stream!)),
      )
    : undefined;
  if (cdp)
    await cdp.send("Tracing.start", {
      transferMode: "ReturnAsStream",
      traceConfig: {
        includedCategories: options.categories!.split(","),
        excludedCategories: ["*"],
      },
    });

  const load = loadavg()[0]!;
  const result = (await page.evaluate(
    ([c, s]) =>
      (
        window as unknown as {
          labRun: (config: BenchConfig, size: string) => Promise<unknown>;
        }
      ).labRun(c, s),
    [config, size] as const,
  )) as BenchResult;
  if (timer) clearInterval(timer);

  if (cdp) {
    await cdp.send("Tracing.end");
    const stream = await tracing!;
    const path = `${options.trace}${total === 1 ? "" : `.${index}`}`;
    writeFileSync(path, "");
    for (;;) {
      const { data, eof } = await cdp.send("IO.read", {
        handle: stream,
        size: 1 << 24,
      });
      appendFileSync(path, data);
      if (eof) break;
    }
  }
  const disk = storeBytes(profile);
  const layout =
    index === 0 && spec.disk
      ? findDirs(profile, "IndexedDB")
          .flatMap((dir) => tree(dir))
          .slice(0, 8)
      : undefined;
  await context.close();
  await browser?.close();
  return { result, load, disk, layout, samples };
}

/** A browser that dies under Playwright can leave a call pending for ever. */
function within<T>(ms: number, work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    work,
    new Promise<never>((_, fail) => {
      timer = setTimeout(() => fail(new Error(`No answer in ${ms} ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function run(entry: Entry, index: number, total: number) {
  const spec = BROWSERS[entry.browser];
  if (!spec) throw new Error(`Unknown browser ${entry.browser}`);
  const config = { ...DEFAULTS, ...entry.config };
  const profile = mkdtempSync(join(options.base!, "run-"));
  try {
    const outcome =
      spec.engine === "firefox"
        ? await runFirefox(profile, config)
        : spec.engine === "simulator"
          ? await runSimulator(spec.path!, config)
          : await within(
              180_000,
              chromeLike(profile, spec, config, index, total),
            );
    const { txs, ...rest } = outcome.result;
    const line = {
      label: entry.label,
      browser: entry.browser,
      size,
      run: index,
      config,
      load: outcome.load,
      disk: outcome.disk,
      layout: outcome.layout,
      ...rest,
      txs: txs.map((tx) => [...tx.t.map(Math.round), tx.n]),
      levels:
        "samples" in outcome && outcome.samples?.length
          ? outcome.samples
          : undefined,
    };
    if (options.out) appendFileSync(options.out, JSON.stringify(line) + "\n");
    console.log(
      `${entry.label} ${entry.browser} run ${index}: ${Math.round(line.ms)} ms, ${line.puts} puts, disk ${(line.disk / 1e6).toFixed(1)} MB, load ${line.load.toFixed(1)}`,
    );
    if (line.layout) console.log(line.layout.join("\n"));
    return line;
  } finally {
    if (!options.keep) {
      // macOS protects a Downloads folder with an ACL.
      if (spec.engine === "firefox") spawnSync("chmod", ["-RN", profile]);
      rmSync(profile, { recursive: true, force: true });
    }
  }
}

mkdirSync(options.base!, { recursive: true });
const server = await startServer();
try {
  if (options.plan) {
    const plan = JSON.parse(readFileSync(options.plan, "utf8")) as Entry[];
    const rounds = Number(options.rounds);
    for (let round = 0; round < rounds; round++)
      for (const entry of plan)
        await run(entry, round, rounds).catch((error: Error) => {
          const failed = error.message.slice(0, 200);
          console.log(`${entry.label} ${entry.browser} failed: ${failed}`);
          if (options.out)
            appendFileSync(
              options.out,
              `${JSON.stringify({ label: entry.label, browser: entry.browser, failed })}\n`,
            );
        });
  } else {
    const runs = Number(options.runs);
    const times: number[] = [];
    for (let index = 0; index < runs; index++) {
      const line = await run(
        {
          label: options.label!,
          browser: options.browser!,
          config: JSON.parse(options.config!),
        },
        index,
        runs,
      );
      times.push(line.ms);
    }
    const sorted = [...times].sort((a, b) => a - b);
    console.log(
      `median ${Math.round(sorted[Math.floor(sorted.length / 2)]!)} ms (${Math.round(sorted[0]!)}–${Math.round(sorted.at(-1)!)})`,
    );
  }
} finally {
  server.stop(true);
}
process.exit(0);
