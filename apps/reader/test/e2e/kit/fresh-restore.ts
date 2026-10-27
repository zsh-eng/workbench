import type { BrowserContext, Page, Request } from "@playwright/test";
import { appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LAB_API, LAB_APP_ORIGIN } from "../../../scripts/restore-lab";

/**
 * agent-kit `--steps` for the restore lab, after `restore-lab-device.ts`:
 * a new device opens the Library. Each run clears the app's storage and
 * keeps the session. It returns the time to the first book on screen and
 * appends every milestone, and each API request, to RESTORE_LAB_OUT as one
 * JSON line.
 *
 *   NODE_TLS_REJECT_UNAUTHORIZED=0 RESTORE_LAB_SIZE=large bun run kit time \
 *     https://localhost:5523/ --before test/e2e/kit/restore-lab-device.ts \
 *     --steps test/e2e/kit/fresh-restore.ts --runs 5 --timeout 900
 *
 * RESTORE_LAB_TRACE=<file> saves a Chrome trace of the run's first
 * RESTORE_LAB_TRACE_MS (12 s); use --runs 1. For `kit clip`,
 * RESTORE_LAB_SECONDS=<n> watches the new device for n seconds instead of
 * until the last cover, and records the milestones reached by then.
 */
export default async function freshRestore({
  page,
  context,
}: {
  page: Page;
  context: BrowserContext;
}) {
  // A new device: nothing of the app's is stored, but the session cookie is.
  await page.goto("about:blank");
  const cdp = await context.newCDPSession(page);
  await cdp.send("Storage.clearDataForOrigin", {
    origin: LAB_APP_ORIGIN,
    storageTypes: "indexeddb,local_storage,cache_storage,service_workers",
  });
  await cdp.detach();

  const requests: {
    path: string;
    start: number;
    end: number;
    bytes: number;
    failure?: string;
  }[] = [];
  const onDone = (ok: boolean) => async (request: Request) => {
    const url = new URL(request.url());
    if (!url.href.startsWith(LAB_API) || request.method() === "OPTIONS") return;
    const timing = request.timing();
    const response = await request.response().catch(() => null);
    requests.push({
      path: url.pathname.replace("/api/apps/reader", ""),
      start: timing.startTime,
      end: timing.startTime + Math.max(timing.responseEnd, 0),
      bytes: Number(response?.headers()["content-length"] ?? -1),
      // The lab's HTTP/2 proxy can end a finished stream with a reset,
      // which the browser reports as an abort.
      ...(ok ? {} : { failure: request.failure()?.errorText }),
    });
  };
  const finished = onDone(true);
  const failed = onDone(false);
  page.on("requestfinished", finished);
  page.on("requestfailed", failed);
  const trace = process.env.RESTORE_LAB_TRACE;
  if (trace)
    await context.browser()!.startTracing(page, {
      path: trace,
      screenshots: false,
      categories: [
        "devtools.timeline",
        "disabled-by-default-devtools.timeline",
        "disabled-by-default-v8.cpu_profiler",
        "v8.execute",
        "blink.user_timing",
        "IndexedDB",
      ],
    });

  await page.goto(`${LAB_APP_ORIGIN}/`);
  const seconds = process.env.RESTORE_LAB_SECONDS;
  if (trace) {
    await page.waitForTimeout(
      Number(process.env.RESTORE_LAB_TRACE_MS ?? 12_000),
    );
    await context.browser()!.stopTracing();
  }
  if (seconds) await page.waitForTimeout(Number(seconds) * 1000);
  else
    await page.waitForFunction(
      () => {
        const marks = (window as { __restoreLab?: Record<string, number> })
          .__restoreLab;
        return marks?.restored !== undefined && marks.allCovers !== undefined;
      },
      undefined,
      { timeout: 600_000, polling: 250 },
    );
  page.off("requestfinished", finished);
  page.off("requestfailed", failed);
  const { marks, timeOrigin } = await page.evaluate(() => ({
    marks: (window as { __restoreLab?: Record<string, number> }).__restoreLab!,
    timeOrigin: performance.timeOrigin,
  }));
  const out =
    process.env.RESTORE_LAB_OUT ??
    join(tmpdir(), "agent-kit", "restore-lab.jsonl");
  appendFileSync(
    out,
    JSON.stringify({
      size: process.env.RESTORE_LAB_SIZE ?? "large",
      marks,
      requests: requests
        .map((request) => ({
          ...request,
          start: Math.round(request.start - timeOrigin),
          end: Math.round(request.end - timeOrigin),
        }))
        .sort((a, b) => a.start - b.start),
    }) + "\n",
  );
  return marks.shelf;
}
