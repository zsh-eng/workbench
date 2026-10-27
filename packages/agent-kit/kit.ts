/**
 * Screenshots, clips and timings of one page on a warm dev server. Each
 * command stops at a hard time cap and prints a short summary and its files.
 * See README.md.
 *
 *   bun run kit shot <url|/route> [--steps file]
 *   bun run kit clip <url|/route> [--steps file | --seconds 3] [--sheet 6]
 *   bun run kit time <url|/route> --steps file [--runs 10] [--throttle 4]
 *   bun run kit frames <trace.json> [--out chart.png]
 */
import {
  chromium,
  webkit,
  type BrowserContext,
  type CDPSession,
  type Page,
  type ViewportSize,
} from "@playwright/test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { loadavg, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

/** What `--before` and `--steps` modules receive. */
export interface KitContext {
  page: Page;
  context: BrowserContext;
  baseURL: string;
  /** Values that `--before` modules returned, for `{name}` in the URL. */
  vars: Record<string, string>;
}

interface KitModule {
  default: (kit: KitContext) => Promise<unknown>;
  /** `kit time` runs it, untimed, after each run. */
  reset?: (kit: KitContext) => Promise<unknown>;
}

const CAPS = { shot: 60, clip: 120, time: 180, frames: 60 } as const;
type Command = keyof typeof CAPS;

const { values: options, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: "string" },
    before: { type: "string", multiple: true, default: [] },
    steps: { type: "string" },
    storage: { type: "string", multiple: true, default: [] },
    wait: { type: "string" },
    port: { type: "string" },
    dark: { type: "boolean" },
    desktop: { type: "boolean" },
    size: { type: "string" },
    browser: { type: "string", default: "chromium" },
    trace: { type: "string" },
    full: { type: "boolean" },
    throttle: { type: "string", default: "1" },
    timeout: { type: "string" },
    seconds: { type: "string", default: "3" },
    sheet: { type: "string", default: "0" },
    runs: { type: "string", default: "10" },
    warmup: { type: "string", default: "1" },
  },
});
const [command, target] = positionals as [Command, string];
if (!(command in CAPS) || !target) {
  console.error("usage: kit shot|clip|time <url|/route> [options]");
  console.error("       kit frames <trace.json> [--out chart.png]");
  process.exit(64);
}
const cap = Number(options.timeout ?? CAPS[command]);
setTimeout(() => {
  console.error(`kit ${command}: stopped at the ${cap} s cap`);
  process.exit(124);
}, cap * 1000);
const throttle = Number(options.throttle);
if (command === "frames") {
  const { summarizeFrames } = await import("./frames");
  const out = output("png");
  console.log(
    await summarizeFrames(
      readFileSync(target, "utf8"),
      out,
      chromium,
      basename(target),
    ),
  );
  process.exit(0);
}
const sized = /^(\d+)x(\d+)$/.exec(options.size ?? "");
const viewport: ViewportSize = sized
  ? { width: Number(sized[1]), height: Number(sized[2]) }
  : options.desktop
    ? { width: 1280, height: 800 }
    : { width: 390, height: 844 };
const touch = !options.desktop;
const engine = options.browser === "webkit" ? webkit : chromium;
if (engine === webkit && (throttle > 1 || options.trace)) {
  console.error("kit: --throttle and --trace need Chromium");
  process.exit(64);
}
const origin = target.startsWith("/")
  ? `http://127.0.0.1:${options.port ?? process.env.E2E_PORT ?? 5190}`
  : new URL(target).origin;

await checkServer(origin);
await run().catch((error: Error) => {
  // Playwright's errors carry a long call log; the first lines say enough.
  const message = String(error?.message ?? error).split("\n");
  console.error(`kit ${command} failed: ${message.slice(0, 4).join("\n")}`);
  process.exit(1);
});
process.exit(0);

async function run() {
  const videoDir = join(tmpdir(), "agent-kit", `video-${process.pid}`);
  const browser = await engine.launch();
  const context = await browser.newContext({
    baseURL: origin,
    viewport,
    deviceScaleFactor: 2,
    // WebKit on a Mac has no mobile viewport; touch still works.
    isMobile: touch && engine === chromium,
    hasTouch: touch,
    colorScheme: options.dark ? "dark" : "light",
    serviceWorkers: "block",
    recordVideo:
      command === "clip" ? { dir: videoDir, size: viewport } : undefined,
  });
  const storage = options.storage.map((entry) => {
    const at = entry.indexOf("=");
    return [entry.slice(0, at), entry.slice(at + 1)];
  });
  // Once per tab, so that a reload keeps what the page itself changed.
  await context.addInitScript((entries) => {
    try {
      if (sessionStorage.getItem("agent-kit-storage")) return;
      for (const [key, value] of entries) localStorage.setItem(key!, value!);
      sessionStorage.setItem("agent-kit-storage", "set");
    } catch {
      // about:blank has no storage.
    }
  }, storage);

  const page = await context.newPage();
  const pageStarted = performance.now();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  const kit: KitContext = { page, context, baseURL: origin, vars: {} };
  for (const file of options.before) {
    const vars = await (await load(file)).default(kit);
    if (vars) Object.assign(kit.vars, vars);
  }
  const steps = options.steps ? await load(options.steps) : undefined;
  const url = new URL(
    target.replace(/\{(\w+)\}/g, (_, name: string) => {
      if (name in kit.vars) return kit.vars[name]!;
      throw new Error(`no --before module returned {${name}}`);
    }),
    origin,
  ).href;
  await page.goto(url);
  await settle(page);
  if (throttle > 1)
    await (
      await context.newCDPSession(page)
    ).send("Emulation.setCPUThrottlingRate", { rate: throttle });

  const cpu = throttle > 1 ? `, CPU ${throttle}x slower` : "";
  const size = `${viewport.width}×${viewport.height}${options.dark ? " dark" : ""}${engine === webkit ? " WebKit" : ""}`;
  const tracing = options.trace
    ? await startTrace(await context.newCDPSession(page))
    : undefined;
  // Stops the trace once the steps end, before the page closes.
  const saveTrace = async () => {
    if (!tracing) return;
    const out = resolve(options.trace!);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, await tracing());
    console.log(`trace ${out} (bun run kit frames ${options.trace})`);
  };
  if (command === "shot") {
    await steps?.default(kit);
    await saveTrace();
    const out = output("png");
    await page.screenshot({ path: out, fullPage: options.full });
    console.log(`shot ${out} (${size}, ${url})`);
  } else if (command === "clip") {
    // The video starts a little after the page; begin 0.3 s early.
    const from = Math.max(0, (performance.now() - pageStarted) / 1000 - 0.3);
    if (steps) await steps.default(kit);
    else await page.waitForTimeout(Number(options.seconds) * 1000);
    await page.waitForTimeout(300);
    await saveTrace();
    const length = (performance.now() - pageStarted) / 1000 - from;
    const video = page.video()!;
    await context.close();
    const out = output("mp4");
    const sheet = encode(await video.path(), from, length, out);
    rmSync(videoDir, { recursive: true, force: true });
    console.log(`clip ${out} (${length.toFixed(1)} s, ${size}${cpu})`);
    if (sheet) console.log(`sheet ${sheet} (${options.sheet} frames)`);
  } else {
    if (!steps) throw new Error("kit time needs --steps <file>");
    const samples: number[] = [];
    const warmup = Number(options.warmup);
    for (let run = 0; run < warmup + Number(options.runs); run++) {
      const start = performance.now();
      const result = await steps.default(kit);
      const ms =
        typeof result === "number" ? result : performance.now() - start;
      if (run >= warmup) samples.push(ms);
      await steps.reset?.(kit);
    }
    await saveTrace();
    const sorted = [...samples].sort((a, b) => a - b);
    const last = sorted.length - 1;
    const median =
      (sorted[Math.floor(last / 2)]! + sorted[Math.ceil(last / 2)]!) / 2;
    const p95 = sorted[Math.ceil(0.95 * sorted.length) - 1]!;
    const out = output("json");
    writeFileSync(out, JSON.stringify({ url, throttle, samples }));
    const ms = (value: number) => value.toFixed(1);
    console.log(
      `time ${options.steps}: median ${ms(median)} ms, p95 ${ms(p95)} ms ` +
        `(${samples.length} runs, min ${ms(sorted[0]!)}, ` +
        `max ${ms(sorted[last]!)}${cpu}, load ${loadavg()[0]!.toFixed(1)})`,
    );
    console.log(`samples ${out}`);
  }
  if (errors.length)
    console.log(
      `page errors: ${errors.length}; first: ${errors[0]!.slice(0, 200)}`,
    );
  await browser.close();
}

/**
 * Starts a Chrome performance trace with the categories DevTools records,
 * frame reports included. Returns a function that stops it and gives the
 * trace's JSON.
 */
async function startTrace(cdp: CDPSession) {
  const events: unknown[] = [];
  cdp.on("Tracing.dataCollected", ({ value }) => events.push(...value));
  await cdp.send("Tracing.start", {
    transferMode: "ReportEvents",
    traceConfig: {
      includedCategories: [
        "devtools.timeline",
        "disabled-by-default-devtools.timeline",
        "disabled-by-default-devtools.timeline.frame",
        "blink.user_timing",
        "benchmark",
        "cc",
        "viz",
        "gpu",
        "input",
        "latencyInfo",
        "loading",
        "v8.execute",
        // JavaScript samples, so a long task names its functions.
        "disabled-by-default-v8.cpu_profiler",
      ],
    },
  });
  return async () => {
    const done = new Promise((resolve) =>
      cdp.once("Tracing.tracingComplete", resolve),
    );
    await cdp.send("Tracing.end");
    await done;
    return JSON.stringify({ traceEvents: events });
  };
}

/** Refuses a server from another checkout (see the Reader's `/__e2e`). */
async function checkServer(origin: string) {
  const response = await fetch(`${origin}/__e2e`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(5000),
  }).catch(() => undefined);
  if (!response) {
    console.error(
      `kit: nothing answers at ${origin}. Start it: E2E_PORT=<port> bun run e2e:serve`,
    );
    process.exit(1);
  }
  const marker = response.ok ? await response.json().catch(() => ({})) : {};
  if (!marker.root) return;
  let top = process.cwd();
  while (!existsSync(join(top, ".git")) && dirname(top) !== top)
    top = dirname(top);
  if (!`${marker.root}/`.startsWith(`${top}/`)) {
    console.error(
      `kit: ${origin} runs from ${marker.root}, not this checkout (${top}). Use your own E2E_PORT.`,
    );
    process.exit(1);
  }
  if (marker.changed?.length) {
    console.error(
      `kit: the server on ${origin} started before ${marker.changed.join(", ")} changed. Restart it.`,
    );
    process.exit(1);
  }
}

async function load(file: string): Promise<KitModule> {
  return import(pathToFileURL(resolve(file)).href);
}

/** Waits for the network to go quiet, fonts to load and two frames. */
async function settle(page: Page) {
  await page
    .waitForLoadState("networkidle", { timeout: 10_000 })
    .catch(() => {});
  if (options.wait) await page.locator(options.wait).first().waitFor();
  await page.evaluate(async () => {
    await document.fonts.ready;
    for (let frame = 0; frame < 2; frame++)
      await new Promise(requestAnimationFrame);
  });
}

function output(extension: string): string {
  const out = resolve(
    options.out ??
      join(tmpdir(), "agent-kit", `${command}-${Date.now()}.${extension}`),
  );
  mkdirSync(dirname(out), { recursive: true });
  return out;
}

/**
 * One ffmpeg pass: the clip as H.264 and, with --sheet N, N frames side by
 * side in a PNG beside it.
 */
function encode(video: string, from: number, length: number, out: string) {
  const frames = Number(options.sheet);
  const sheet = out.replace(/\.mp4$/, "-sheet.png");
  const filter = frames
    ? `[0:v]split[clip][s];[s]fps=${(frames + 0.5) / length},scale=260:-2,tile=${frames}x1:padding=4[sheet]`
    : "[0:v]null[clip]";
  const result = spawnSync(
    "ffmpeg",
    [
      ...["-y", "-loglevel", "error", "-ss", from.toFixed(3)],
      ...["-t", length.toFixed(3), "-i", video, "-filter_complex", filter],
      ...["-map", "[clip]", "-c:v", "libx264", "-pix_fmt", "yuv420p"],
      ...["-crf", "20", "-movflags", "+faststart", out],
      ...(frames ? ["-map", "[sheet]", "-frames:v", "1", sheet] : []),
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${result.stderr}`);
  return frames ? sheet : undefined;
}
