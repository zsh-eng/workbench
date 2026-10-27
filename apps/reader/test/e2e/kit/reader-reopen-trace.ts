import type { Page } from "@playwright/test";
import { appendFileSync } from "node:fs";

const TRACES = "reader-performance-traces-v1";

interface TraceSpan {
  name: string;
  startMs: number;
  endMs: number | null;
  details: Record<string, unknown>;
}

interface Trace {
  status: string;
  durationMs: number | null;
  spans: TraceSpan[];
}

/**
 * agent-kit `time` steps: reopens the Reader at its saved place (a reload,
 * so chapter artifacts are cold and the body cache is warm) and reads the
 * Reader's own trace. Needs `--storage reader-performance-tracing-enabled-v1=true`.
 *
 * Returns the milestone `KIT_METRIC` names: `first-spread` (default, the
 * first spread's frame), `settled` (visible content settled) or `full`
 * (whole-book pagination). With `KIT_RECORD`, appends one JSON line per run
 * with every milestone, the opened chapter's artifact (main-thread parse)
 * and the worker's preparation and layout time.
 */
export default async function reopen({ page }: { page: Page }) {
  await page.evaluate((key) => localStorage.removeItem(key), TRACES);
  await page.reload();
  await page.waitForFunction(
    (key) => {
      const trace = JSON.parse(localStorage.getItem(key) ?? "[]")[0];
      return trace?.status === "completed";
    },
    TRACES,
    { timeout: 170_000 },
  );
  const trace = await readTrace(page);
  const span = (name: string) => trace.spans.find((s) => s.name === name);
  const duration = (name: string) => {
    const found = span(name);
    return found?.endMs == null ? null : found.endMs - found.startMs;
  };
  const record = {
    firstSpreadMs: span("first-spread-frame-painted")?.startMs ?? null,
    settledMs: span("reader-settled-frame-painted")?.startMs ?? null,
    fullMs: trace.durationMs,
    initialArtifactMs: duration("initial-chapter-artifact"),
    allArtifactsMs: duration("chapter-artifacts-load"),
    bodyCache: span("reader-body-cache-load")?.details.loadKind ?? null,
    firstChapterWorker: pick(span("pagination-first-spread")?.details),
    allChaptersWorker: pick(span("pagination-all-chapters")?.details),
  };
  if (process.env.KIT_RECORD)
    appendFileSync(process.env.KIT_RECORD, `${JSON.stringify(record)}\n`);
  const metric = process.env.KIT_METRIC ?? "first-spread";
  const value =
    metric === "full"
      ? record.fullMs
      : metric === "settled"
        ? record.settledMs
        : record.firstSpreadMs;
  if (value === null) throw new Error(`The trace has no ${metric} milestone`);
  return value;
}

function pick(details: Record<string, unknown> | undefined) {
  return {
    prepareMs: details?.workerPrepareMs ?? null,
    layoutMs: details?.workerLayoutMs ?? null,
    activeMs: details?.workerActiveMs ?? null,
  };
}

async function readTrace(page: Page): Promise<Trace> {
  return page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? "[]")[0],
    TRACES,
  );
}
