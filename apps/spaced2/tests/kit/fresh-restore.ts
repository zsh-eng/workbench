import type { BrowserContext, Page, Request } from "@playwright/test";
import { appendFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LAB_API } from "../../scripts/restore-lab";

/**
 * agent-kit `--steps` for the restore lab, after `restore-lab-device.ts`:
 * a new device opens Review. Each run clears the app's storage and keeps
 * the session. It returns the time to the first due card on screen with
 * its grade buttons, and appends every milestone, each API request and the
 * IndexedDB row counts to RESTORE_LAB_OUT as one JSON line.
 *
 *   NODE_TLS_REJECT_UNAUTHORIZED=0 RESTORE_LAB_SIZE=large bun run kit time \
 *     https://localhost:5633/ --before apps/spaced2/tests/kit/restore-lab-device.ts \
 *     --steps apps/spaced2/tests/kit/fresh-restore.ts --runs 1 --warmup 0 --timeout 900
 *
 * RESTORE_LAB_TRACE=<file> saves a Chrome trace of the run's first
 * RESTORE_LAB_TRACE_MS (30 s); use --runs 1. RESTORE_LAB_TRACE_CATEGORIES
 * (comma-separated) replaces its categories, for example `IndexedDB` alone
 * for a whole large restore. RESTORE_LAB_PROFILE=<file>
 * saves a V8 CPU profile of the main thread until the restore settles,
 * which is smaller than a trace of the same span. For `kit clip`,
 * RESTORE_LAB_SECONDS=<n> watches the new device for n seconds instead of
 * until the restore settles.
 */
export default async function freshRestore({
  page,
  context,
  baseURL,
}: {
  page: Page;
  context: BrowserContext;
  baseURL: string;
}) {
  // A new device: nothing of the app's is stored, but the session cookie is.
  await page.goto("about:blank");
  const cdp = await context.newCDPSession(page);
  await cdp.send("Storage.clearDataForOrigin", {
    origin: baseURL,
    storageTypes: "indexeddb,local_storage,cache_storage,service_workers",
  });
  await cdp.detach();

  const requests: {
    path: string;
    start: number;
    end: number;
    failure?: string;
  }[] = [];
  const onDone = (ok: boolean) => (request: Request) => {
    const url = new URL(request.url());
    if (!url.href.startsWith(LAB_API) || request.method() === "OPTIONS") return;
    const timing = request.timing();
    requests.push({
      // A priority pull is the pull stream with `prefix` parameters.
      path:
        url.pathname.replace("/api/apps/spaced", "") +
        (url.searchParams.has("prefix") ? "?prefix" : ""),
      start: timing.startTime,
      end: timing.startTime + Math.max(timing.responseEnd, 0),
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
      categories: process.env.RESTORE_LAB_TRACE_CATEGORIES?.split(",") ?? [
        "devtools.timeline",
        "disabled-by-default-devtools.timeline",
        "disabled-by-default-v8.cpu_profiler",
        "v8.execute",
        "blink.user_timing",
        "IndexedDB",
      ],
    });

  const profile = process.env.RESTORE_LAB_PROFILE;
  const profiler = profile ? await context.newCDPSession(page) : undefined;
  if (profiler) {
    await profiler.send("Profiler.enable");
    await profiler.send("Profiler.setSamplingInterval", { interval: 500 });
    await profiler.send("Profiler.start");
  }
  await page.goto(`${baseURL}/`);
  const seconds = process.env.RESTORE_LAB_SECONDS;
  if (trace) {
    await page.waitForTimeout(
      Number(process.env.RESTORE_LAB_TRACE_MS ?? 30_000),
    );
    await context.browser()!.stopTracing();
  }
  if (seconds) await page.waitForTimeout(Number(seconds) * 1000);
  else
    await page.waitForFunction(
      () =>
        (window as { __restoreLab?: Record<string, unknown> }).__restoreLab
          ?.settled !== undefined,
      undefined,
      { timeout: 600_000, polling: 250 },
    );
  if (profiler) {
    const { profile: result } = await profiler.send("Profiler.stop");
    writeFileSync(profile!, JSON.stringify(result));
    await profiler.detach();
  }
  page.off("requestfinished", finished);
  page.off("requestfailed", failed);
  const { marks, timeOrigin } = await page.evaluate(() => ({
    marks: (window as { __restoreLab?: Record<string, number> }).__restoreLab!,
    timeOrigin: performance.timeOrigin,
  }));
  // Rows in each IndexedDB store at the end, so a fast run is also a whole one.
  const counts = await page.evaluate(async () => {
    const result: Record<string, number> = {};
    for (const { name } of await indexedDB.databases()) {
      if (!name) continue;
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const open = indexedDB.open(name);
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      for (const store of db.objectStoreNames)
        result[`${name.replace(/:shared:.*/, "")}/${store}`] =
          await new Promise<number>((resolve, reject) => {
            const count = db.transaction(store).objectStore(store).count();
            count.onsuccess = () => resolve(count.result);
            count.onerror = () => reject(count.error);
          });
      db.close();
    }
    return result;
  });
  const out =
    process.env.RESTORE_LAB_OUT ??
    join(tmpdir(), "agent-kit", "spaced-restore-lab.jsonl");
  appendFileSync(
    out,
    JSON.stringify({
      app: baseURL,
      size: process.env.RESTORE_LAB_SIZE ?? "large",
      marks,
      counts,
      requests: requests
        .map((request) => ({
          ...request,
          start: Math.round(request.start - timeOrigin),
          end: Math.round(request.end - timeOrigin),
        }))
        .sort((a, b) => a.start - b.start),
    }) + "\n",
  );
  return marks.firstReview;
}
