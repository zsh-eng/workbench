import { chromium, type Page } from "@playwright/test";
import { spawn, type Subprocess } from "bun";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_URL = "http://127.0.0.1:4174";
const DEFAULT_OUTPUT_DIRECTORY = "diagnostics/highlights-performance";
const FIXTURE_VITE_CONFIG = "scripts/highlights-performance/vite.config.ts";

interface CliOptions {
  label: string;
  url: string;
  repetitions: number;
  startServer: boolean;
  outputDirectory: string;
}

interface BrowserBenchmarkState {
  firstArticleMs: number | null;
  longTasks: Array<{ startMs: number; durationMs: number }>;
}

interface BenchmarkRun {
  distribution: "multi" | "single";
  repetition: number;
  firstArticleMs: number;
  firstAnimationProgressMs: number | null;
  settledMs: number;
  animationFrameCount: number;
  articleCount: number;
  animatedTileCount: number;
  elementCount: number;
  longTaskCount: number;
  longTaskTotalMs: number;
  longestTaskMs: number;
  scrollValidation: ScrollValidation;
}

interface ScrollValidation {
  midpointArticleCount: number;
  midpointVisibleArticleCount: number;
  /** The last book's heading, after a scroll to the end. */
  endHeadingTopPx: number;
}

async function assertMountedSectionsDoNotOverlap(page: Page): Promise<void> {
  const overlap = await page.evaluate(() => {
    const sections = [
      ...document.querySelectorAll<HTMLElement>("section[data-section]"),
    ]
      .map((section) => {
        const bounds = section.getBoundingClientRect();
        return {
          id: section.dataset.section,
          top: bounds.top,
          bottom: bounds.bottom,
        };
      })
      .sort((left, right) => left.top - right.top);

    for (let index = 1; index < sections.length; index += 1) {
      const previous = sections[index - 1]!;
      const current = sections[index]!;
      if (current.top < previous.bottom - 1) {
        return {
          previousId: previous.id,
          currentId: current.id,
          overlapPx: previous.bottom - current.top,
        };
      }
    }

    return null;
  });

  if (overlap) {
    throw new Error(
      `${overlap.currentId} overlaps ${overlap.previousId} by ${overlap.overlapPx}px.`,
    );
  }
}

interface BenchmarkSummary {
  firstArticleMs: number;
  firstAnimationProgressMs: number | null;
  settledMs: number;
  animationFrameCount: number;
  articleCount: number;
  animatedTileCount: number;
  elementCount: number;
  longTaskCount: number;
  longTaskTotalMs: number;
  longestTaskMs: number;
}

function readOptionValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    label: "working-tree",
    url: DEFAULT_URL,
    repetitions: 5,
    startServer: true,
    outputDirectory: DEFAULT_OUTPUT_DIRECTORY,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    switch (argument) {
      case "--label":
        options.label = readOptionValue(args, index, argument);
        index += 1;
        break;
      case "--url":
        options.url = readOptionValue(args, index, argument).replace(/\/$/, "");
        index += 1;
        break;
      case "--repetitions": {
        const value = Number(readOptionValue(args, index, argument));
        if (!Number.isInteger(value) || value <= 0) {
          throw new Error(`${argument} must be a positive integer.`);
        }
        options.repetitions = value;
        index += 1;
        break;
      }
      case "--out":
        options.outputDirectory = readOptionValue(args, index, argument);
        index += 1;
        break;
      case "--no-start-server":
        options.startServer = false;
        break;
      default:
        throw new Error(`Unknown option: ${argument}`);
    }
  }

  return options;
}

async function waitForHttpOk(url: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Vite can refuse connections while the preview server starts.
    }
    await Bun.sleep(100);
  }
  throw new Error(`Timed out waiting for ${url}.`);
}

function startPreviewServer(options: CliOptions): Subprocess | null {
  if (!options.startServer) return null;
  const url = new URL(options.url);
  return spawn(
    [
      "bun",
      "x",
      "vite",
      "preview",
      "--config",
      FIXTURE_VITE_CONFIG,
      "--host",
      url.hostname,
      "--port",
      url.port || "4174",
      "--strictPort",
    ],
    { stdout: "inherit", stderr: "inherit" },
  );
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle]!;
  return (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function roundedMedian(values: number[]): number {
  return Math.round(median(values) * 10) / 10;
}

function summarize(runs: BenchmarkRun[]): BenchmarkSummary {
  const progressValues = runs.flatMap(({ firstAnimationProgressMs }) =>
    firstAnimationProgressMs === null ? [] : [firstAnimationProgressMs],
  );

  return {
    firstArticleMs: roundedMedian(
      runs.map(({ firstArticleMs }) => firstArticleMs),
    ),
    firstAnimationProgressMs:
      progressValues.length > 0 ? roundedMedian(progressValues) : null,
    settledMs: roundedMedian(runs.map(({ settledMs }) => settledMs)),
    animationFrameCount: roundedMedian(
      runs.map(({ animationFrameCount }) => animationFrameCount),
    ),
    articleCount: roundedMedian(runs.map(({ articleCount }) => articleCount)),
    animatedTileCount: roundedMedian(
      runs.map(({ animatedTileCount }) => animatedTileCount),
    ),
    elementCount: roundedMedian(runs.map(({ elementCount }) => elementCount)),
    longTaskCount: roundedMedian(
      runs.map(({ longTaskCount }) => longTaskCount),
    ),
    longTaskTotalMs: roundedMedian(
      runs.map(({ longTaskTotalMs }) => longTaskTotalMs),
    ),
    longestTaskMs: roundedMedian(
      runs.map(({ longestTaskMs }) => longestTaskMs),
    ),
  };
}

async function installObservers(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const state: BrowserBenchmarkState = {
      firstArticleMs: null,
      longTasks: [],
    };
    Object.assign(window, { __highlightsBenchmark: state });

    const articleObserver = new MutationObserver(() => {
      if (state.firstArticleMs !== null) return;
      if (document.querySelector("[data-row] article")) {
        state.firstArticleMs = performance.now();
        articleObserver.disconnect();
      }
    });
    articleObserver.observe(document, { childList: true, subtree: true });

    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        state.longTasks.push({
          startMs: entry.startTime,
          durationMs: entry.duration,
        });
      }
    }).observe({ type: "longtask", buffered: true });
  });
}

async function measurePage(
  page: Page,
): Promise<Omit<BenchmarkRun, "distribution" | "repetition">> {
  await page.waitForFunction(
    () => document.querySelector("[data-row] article"),
    null,
    {
      timeout: 15_000,
    },
  );

  return page.evaluate(async () => {
    const state = (
      window as typeof window & { __highlightsBenchmark: BrowserBenchmarkState }
    ).__highlightsBenchmark;
    const deadline = performance.now() + 5_000;
    let firstAnimationProgressMs: number | null = null;
    let animationFrameCount = 0;
    let previousOpacity = -1;
    let stableFrameCount = 0;
    let settledMs = performance.now();

    while (performance.now() < deadline) {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );

      const articles = [
        ...document.querySelectorAll<HTMLElement>("[data-row] article"),
      ];
      const animatedTiles = articles
        .map((article) => article.parentElement)
        .filter(
          (element): element is HTMLElement =>
            element instanceof HTMLElement &&
            (element.hasAttribute("data-highlight-entrance") ||
              element.style.opacity !== ""),
        );
      const visibleAnimatedTiles = animatedTiles.filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.top < window.innerHeight && rect.bottom > 0;
      });
      const opacities = visibleAnimatedTiles.map((element) =>
        Number.parseFloat(getComputedStyle(element).opacity),
      );
      const minimumOpacity = Math.min(...opacities);
      const maximumOpacity = Math.max(...opacities);

      if (visibleAnimatedTiles.length === 0) {
        stableFrameCount += 1;
      } else if (minimumOpacity >= 0.999) {
        stableFrameCount += 1;
      } else {
        stableFrameCount = 0;
        if (maximumOpacity > 0 && firstAnimationProgressMs === null) {
          firstAnimationProgressMs = performance.now();
        }
        if (maximumOpacity !== previousOpacity) animationFrameCount += 1;
      }
      previousOpacity = maximumOpacity;

      if (stableFrameCount >= 3) {
        settledMs = performance.now();
        break;
      }
    }

    const articles = document.querySelectorAll("[data-row] article");
    const animatedTileCount = [...articles].filter(
      (article) =>
        article.parentElement instanceof HTMLElement &&
        (article.parentElement.hasAttribute("data-highlight-entrance") ||
          article.parentElement.style.opacity !== ""),
    ).length;
    const relevantLongTasks = state.longTasks.filter(
      ({ startMs }) => startMs <= settledMs,
    );

    return {
      firstArticleMs: state.firstArticleMs ?? settledMs,
      firstAnimationProgressMs,
      settledMs,
      animationFrameCount,
      articleCount: articles.length,
      animatedTileCount,
      elementCount: document.querySelectorAll("*").length,
      longTaskCount: relevantLongTasks.length,
      longTaskTotalMs: relevantLongTasks.reduce(
        (total, { durationMs }) => total + durationMs,
        0,
      ),
      longestTaskMs: Math.max(
        0,
        ...relevantLongTasks.map(({ durationMs }) => durationMs),
      ),
    };
  });
}

async function validateVirtualizedScroll(
  page: Page,
  distribution: "multi" | "single",
): Promise<ScrollValidation> {
  await assertMountedSectionsDoNotOverlap(page);
  await page.evaluate(() => {
    const maximumScroll =
      document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo(0, maximumScroll * 0.55);
  });
  await page.waitForTimeout(80);
  await assertMountedSectionsDoNotOverlap(page);

  const midpoint = await page.evaluate(() => {
    const articles = [
      ...document.querySelectorAll<HTMLElement>("[data-row] article"),
    ];
    return {
      midpointArticleCount: articles.length,
      midpointVisibleArticleCount: articles.filter((article) => {
        const rect = article.getBoundingClientRect();
        return rect.top < window.innerHeight && rect.bottom > 0;
      }).length,
    };
  });
  if (midpoint.midpointVisibleArticleCount === 0) {
    throw new Error("Virtualized Highlights left the midpoint viewport empty.");
  }

  // Books are in order of their latest highlight, so the first book is last.
  const lastBookIndex = distribution === "single" ? 0 : 19;
  const headingId = `book-highlights-performance-book-${lastBookIndex}`;
  await page.evaluate(() =>
    window.scrollTo(0, document.documentElement.scrollHeight),
  );
  await page.waitForFunction((id) => document.getElementById(id), headingId, {
    timeout: 5_000,
  });
  await assertMountedSectionsDoNotOverlap(page);
  const endHeadingTopPx = await page
    .locator(`#${headingId}`)
    .evaluate((heading) => heading.getBoundingClientRect().top);
  if (endHeadingTopPx < 0 || endHeadingTopPx > 720) {
    throw new Error(
      `The last book's heading is at ${endHeadingTopPx}px, outside the view at the end.`,
    );
  }

  return { ...midpoint, endHeadingTopPx };
}

async function validateDebouncedSearchLayout(page: Page): Promise<void> {
  await page.keyboard.press("/");
  await page.locator('input[type="search"]').fill("stable interface");
  await page.waitForTimeout(250);
  await page.waitForFunction(() =>
    document.querySelector("[data-row] article"),
  );
  await assertMountedSectionsDoNotOverlap(page);
}

async function runBenchmark(options: CliOptions): Promise<void> {
  const server = startPreviewServer(options);
  const browser = await chromium.launch({ headless: true });

  try {
    await waitForHttpOk(options.url);
    const runs: BenchmarkRun[] = [];

    for (const distribution of ["multi", "single"] as const) {
      for (
        let repetition = 1;
        repetition <= options.repetitions;
        repetition += 1
      ) {
        const context = await browser.newContext({
          viewport: { width: 1280, height: 720 },
          serviceWorkers: "block",
        });
        const page = await context.newPage();
        await installObservers(page);
        const query = distribution === "single" ? "?distribution=single" : "";
        await page.goto(`${options.url}/${query}`, {
          waitUntil: "load",
        });
        const measurement = await measurePage(page);
        const scrollValidation = await validateVirtualizedScroll(
          page,
          distribution,
        );
        await validateDebouncedSearchLayout(page);
        runs.push({
          distribution,
          repetition,
          ...measurement,
          scrollValidation,
        });
        await context.close();
      }
    }

    const report = {
      label: options.label,
      createdAt: new Date().toISOString(),
      repetitions: options.repetitions,
      viewport: { width: 1280, height: 720 },
      summaries: {
        multi: summarize(
          runs.filter(({ distribution }) => distribution === "multi"),
        ),
        single: summarize(
          runs.filter(({ distribution }) => distribution === "single"),
        ),
      },
      runs,
    };

    await mkdir(options.outputDirectory, { recursive: true });
    const safeLabel = options.label
      .replace(/[^a-z0-9-_]+/gi, "-")
      .toLowerCase();
    const outputPath = path.join(options.outputDirectory, `${safeLabel}.json`);
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report.summaries, null, 2));
    console.log(`Wrote ${outputPath}`);
  } finally {
    await browser.close();
    server?.kill();
  }
}

await runBenchmark(parseArgs(Bun.argv.slice(2)));
