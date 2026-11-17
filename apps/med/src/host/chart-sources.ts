import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  chartSourceFor,
  metaVariable,
  sourceChartSchema,
  type LinkChart,
  type SourceChart,
} from "../shared/charts";
import { HostError } from "./runtime/errors";
import type { Settings } from "./settings-file";

// Chart sources: a chart's link whose data a command of the user's prints.
// Settings name each by the base address of its links (`charts.sources`), so
// the user or an agent decides how Med reads a kind of link: a Grafana
// behind a sign-in, a metrics service, a script. Med runs the command as the
// user, with the link and the block's other keys in its environment, never
// in the command's text, and reads neither: the command knows its links.

export interface LinkRequest {
  link: string;
  /** When the reply was written, which the command takes as now. */
  at?: number;
  live?: boolean;
  /** The block's keys that Med does not draw with, as written. */
  meta?: Record<string, string>;
  refresh?: boolean;
}

export interface ChartSourcesOptions {
  /** Med's settings file: `charts.sources`. */
  settings: { snapshot(): Promise<{ settings: Settings }> };
  /** Where Med keeps what it read; none keeps nothing. */
  cacheDir?: string;
  /** The environment that a command runs in, as the user's shell has it. */
  env?(): NodeJS.ProcessEnv;
  /** Where a command runs. */
  cwd?: string;
  now?(): number;
  timeoutMs?: number;
}

/** What a command may print; more is cut off as a failure. */
const MOST_OUTPUT = 8 * 1024 * 1024;
const TIMEOUT_MS = 60_000;
const KEPT = 400;
const LIVE_MS = 15_000;
/** Commands that run at once: a dashboard's dozen charts take turns. */
const AT_ONCE = 4;

/** The sources in Settings, by base. */
export function sourcesOf(settings: Settings): Record<string, string> {
  const value = settings["charts.sources"];
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

/** A time in seconds since 1970 as milliseconds; milliseconds stay. */
const millis = (time: number) => (Math.abs(time) < 1e11 ? time * 1000 : time);

/** A printed chart's times, in milliseconds. */
function inMillis(chart: SourceChart): SourceChart {
  return {
    ...chart,
    ...(chart.range && { range: [millis(chart.range[0]), millis(chart.range[1])] }),
    ...(chart.series && {
      series: chart.series.map((series) => ({
        ...series,
        points: series.points.map(([time, value]) => [millis(time), value] as [number, number]),
      })),
    }),
    ...(chart.marks && { marks: chart.marks.map((mark) => ({ ...mark, at: millis(mark.at) })) }),
  };
}

/** The last line that a failing command said, for the chart to show. */
function lastWords(text: string) {
  const lines = text.trim().split("\n");
  return lines.at(-1)?.trim().slice(0, 300) ?? "";
}

/** Runs a source's command with the link in its environment, and returns
 * what it printed. */
function runCommand(
  command: string,
  env: NodeJS.ProcessEnv,
  cwd: string,
  timeoutMs: number,
  signal?: AbortSignal,
) {
  return new Promise<string>((resolve, reject) => {
    // A group of its own, so its children stop with it.
    const child = spawn("/bin/sh", ["-c", command], {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    const out: Buffer[] = [];
    let size = 0;
    let said = "";
    let failure: HostError | undefined;
    const stop = (reason: HostError) => {
      failure ??= reason;
      try {
        if (child.pid) process.kill(-child.pid, "SIGTERM");
      } catch {
        /* It has ended. */
      }
    };
    const timer = setTimeout(
      () =>
        stop(
          new HostError(
            "chart-source-failed",
            `The chart source took longer than ${Math.round(timeoutMs / 1000)} s.`,
            504,
          ),
        ),
      timeoutMs,
    );
    const aborted = () => stop(new HostError("chart-source-failed", "The chart was closed.", 499));
    signal?.addEventListener("abort", aborted, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MOST_OUTPUT)
        stop(new HostError("chart-source-failed", "The chart source printed more than 8 MB.", 502));
      else out.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      said = (said + chunk.toString("utf8")).slice(-4096);
    });
    child.on("error", (reason) =>
      stop(
        new HostError(
          "chart-source-failed",
          `Med could not run the chart source: ${reason.message}`,
          502,
        ),
      ),
    );
    child.on("close", (code, killed) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", aborted);
      if (failure) return reject(failure);
      if (code !== 0)
        return reject(
          new HostError(
            "chart-source-failed",
            `The chart source failed (${code ?? killed}): ${lastWords(said) || "it said nothing."}`,
            502,
          ),
        );
      resolve(Buffer.concat(out).toString("utf8"));
    });
  });
}

export function createChartSources(options: ChartSourcesOptions) {
  const now = options.now ?? Date.now;
  let busy = 0;
  const waiting: (() => void)[] = [];
  /** Runs `work` when fewer than AT_ONCE commands run. */
  async function inTurn<T>(work: () => Promise<T>) {
    if (busy >= AT_ONCE) await new Promise<void>((go) => waiting.push(go));
    busy++;
    try {
      return await work();
    } finally {
      busy--;
      waiting.shift()?.();
    }
  }
  const live = new Map<string, { at: number; chart: LinkChart }>();
  const running = new Map<string, Promise<LinkChart>>();

  async function keep(key: string, chart: LinkChart) {
    if (!options.cacheDir) return;
    await mkdir(options.cacheDir, { recursive: true });
    const temporary = join(options.cacheDir, `${key}.${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify(chart));
    await rename(temporary, join(options.cacheDir, `${key}.json`));
    // The newest few hundred stay.
    const names = (await readdir(options.cacheDir)).filter((name) => name.endsWith(".json"));
    if (names.length <= KEPT + 20) return;
    const dated = await Promise.all(
      names.map(async (name) => ({
        name,
        at: (await stat(join(options.cacheDir!, name)).catch(() => undefined))?.mtimeMs ?? 0,
      })),
    );
    dated.sort((a, b) => b.at - a.at);
    await Promise.all(
      dated.slice(KEPT).map(({ name }) => rm(join(options.cacheDir!, name), { force: true })),
    );
  }

  async function kept(key: string): Promise<LinkChart | undefined> {
    if (!options.cacheDir) return undefined;
    try {
      return JSON.parse(await readFile(join(options.cacheDir, `${key}.json`), "utf8"));
    } catch {
      return undefined;
    }
  }

  /** What the command printed, as rows for the page or a chart. */
  function parse(text: string): Pick<LinkChart, "rows" | "chart"> {
    const trimmed = text.trim();
    if (!trimmed)
      throw new HostError("chart-source-failed", "The chart source printed nothing.", 502);
    if (!trimmed.startsWith("{")) return { rows: trimmed };
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new HostError(
        "chart-source-failed",
        "The chart source printed JSON that does not parse.",
        502,
      );
    }
    const chart = sourceChartSchema.safeParse(parsed);
    if (!chart.success)
      throw new HostError(
        "chart-source-failed",
        `The chart source printed a chart that Med cannot draw: ${chart.error.issues[0]?.message ?? "it has no series or bars"}.`,
        502,
      );
    return { chart: inMillis(chart.data) };
  }

  return {
    /** The sources in Settings, by base. */
    async list() {
      return sourcesOf((await options.settings.snapshot()).settings);
    },
    /** A link's data from the source that covers it. */
    async read(input: LinkRequest, signal?: AbortSignal): Promise<LinkChart> {
      let url: URL;
      try {
        url = new URL(input.link);
      } catch {
        throw new HostError("invalid-chart", `${input.link} is not a link.`, 400);
      }
      const source = chartSourceFor(await this.list(), input.link);
      if (!source)
        throw new HostError(
          "chart-source-missing",
          `No chart source covers ${url.host}. Add one in Med's settings, charts.sources: the links' base and the command that prints their data.`,
          404,
        );
      const isLive = !!input.live;
      const meta = input.meta ?? {};
      // Each reply's chart is its own, read as of when it was written; a live
      // one is read again after a while.
      const key = createHash("sha256")
        .update(
          JSON.stringify([
            source.base,
            source.command,
            input.link,
            Object.entries(meta).sort(([a], [b]) => (a < b ? -1 : 1)),
            isLive ? "live" : (input.at ?? null),
          ]),
        )
        .digest("hex")
        .slice(0, 32);
      if (!input.refresh) {
        const recent = live.get(key);
        if (isLive && recent && now() - recent.at < LIVE_MS) return recent.chart;
        if (!isLive) {
          const saved = await kept(key);
          if (saved) return saved;
        }
      }
      const pending = running.get(key);
      if (pending) return pending;
      const env: NodeJS.ProcessEnv = { ...(options.env?.() ?? process.env) };
      for (const [name, value] of Object.entries(meta)) env[metaVariable(name)] = value;
      // Med's own come last, so a key named `link` or `at` cannot stand in.
      Object.assign(env, {
        MED_CHART_LINK: input.link,
        // The time that the command takes as now: a relative range in the link,
        // such as from=now-6h, reads as of the reply, unless the chart is live.
        MED_CHART_AT: String(isLive ? now() : Math.min(input.at ?? now(), now())),
        MED_CHART_LIVE: isLive ? "1" : "",
      });
      const work = inTurn(() =>
        runCommand(
          source.command,
          env,
          options.cwd ?? homedir(),
          options.timeoutMs ?? TIMEOUT_MS,
          signal,
        ),
      ).then(async (text) => {
        const chart: LinkChart = {
          source: source.base,
          ...parse(text),
          live: isLive,
          fetched: now(),
        };
        if (isLive) live.set(key, { at: now(), chart });
        else await keep(key, chart).catch(() => {});
        return chart;
      });
      running.set(key, work);
      try {
        return await work;
      } finally {
        running.delete(key);
      }
    },
  };
}
