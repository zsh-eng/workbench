import type { Request } from "@playwright/test";
import { appendFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { KitContext } from "../../../../../packages/agent-kit/kit";
import {
  LAB_API,
  LAB_IMAGE_PORT,
  LAB_PROFILES,
  type LabProfile,
} from "../../scripts/first-sync-lab";

/**
 * agent-kit `--steps` for the first-sync lab, after `first-sync-device.ts`:
 * a new device opens the library. Each run clears the app's storage and
 * keeps the session, sets the colo's storage delays on the lab API and the
 * round trip and bandwidth in Chromium (FIRST_SYNC_PROFILE, near or far),
 * and waits until the first sync ends and the covers on screen show. It
 * returns the time to every saved link listed, and appends the milestones,
 * the app's performance entries and each request to FIRST_SYNC_OUT as one
 * JSON line.
 *
 *   FIRST_SYNC_SIZE=medium FIRST_SYNC_PROFILE=near bun run kit time \
 *     http://localhost:5543/ --before tests/kit/first-sync-device.ts \
 *     --steps tests/kit/first-sync.ts --runs 5 --warmup 0 --timeout 900
 *
 * FIRST_SYNC_SECONDS=<n> watches for n seconds instead, for `kit clip`.
 */
export default async function firstSync({
  page,
  context,
  baseURL,
}: KitContext) {
  const profileName = (process.env.FIRST_SYNC_PROFILE ?? "near") as LabProfile;
  const profile = LAB_PROFILES[profileName];
  const origin = new URL(baseURL).origin;
  // A new device: nothing of the app's is stored, but the session cookie is.
  await page.goto("about:blank");
  const cdp = await context.newCDPSession(page);
  await cdp.send("Storage.clearDataForOrigin", {
    origin,
    storageTypes: "indexeddb,local_storage,cache_storage,service_workers",
  });
  await fetch(`${LAB_API}/__lab`, {
    method: "POST",
    body: JSON.stringify({ d1Ms: profile.d1Ms, r2Ms: profile.r2Ms }),
  });
  await cdp.send("Network.enable");
  // A new device has no images in its cache either.
  await cdp.send("Network.clearBrowserCache");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: profile.rttMs,
    downloadThroughput: profile.bytesPerSecond,
    uploadThroughput: -1,
  });

  const requests: {
    method: string;
    path: string;
    start: number;
    end: number;
    failure?: string;
  }[] = [];
  const images = { count: 0, first: Infinity, last: 0 };
  const onDone = (ok: boolean) => (request: Request) => {
    const url = new URL(request.url());
    const timing = request.timing();
    const end = timing.startTime + Math.max(timing.responseEnd, 0);
    if (
      url.port === String(LAB_IMAGE_PORT) &&
      url.pathname.startsWith("/og/")
    ) {
      images.count++;
      images.first = Math.min(images.first, timing.startTime);
      images.last = Math.max(images.last, end);
      return;
    }
    if (!url.href.startsWith(LAB_API)) return;
    requests.push({
      method: request.method(),
      path: url.pathname.replace(/^\/api\/apps\//, "") + url.search,
      start: timing.startTime,
      end,
      ...(ok ? {} : { failure: request.failure()?.errorText }),
    });
  };
  const finished = onDone(true);
  const failed = onDone(false);
  page.on("requestfinished", finished);
  page.on("requestfailed", failed);

  try {
    await page.goto(baseURL);
    const seconds = process.env.FIRST_SYNC_SECONDS;
    if (seconds) await page.waitForTimeout(Number(seconds) * 1000);
    else
      await page.waitForFunction(
        () => {
          const lab = (
            window as { __firstSync?: { marks: Record<string, number> } }
          ).__firstSync;
          return (
            lab?.marks.synced !== undefined &&
            lab.marks.screenImages !== undefined
          );
        },
        undefined,
        { timeout: 600_000, polling: 250 },
      );
  } finally {
    page.off("requestfinished", finished);
    page.off("requestfailed", failed);
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
    await cdp.detach();
    await fetch(`${LAB_API}/__lab`, {
      method: "POST",
      body: JSON.stringify({ d1Ms: 0, r2Ms: 0 }),
    });
  }
  const { lab, timeOrigin, entries } = await page.evaluate(() => ({
    lab: (
      window as {
        __firstSync?: { marks: Record<string, number>; screen: unknown };
      }
    ).__firstSync!,
    timeOrigin: performance.timeOrigin,
    entries: performance
      .getEntries()
      .filter((entry) => entry.name.startsWith("arctic:"))
      .map((entry) => ({
        name: entry.name,
        start: Math.round(entry.startTime),
        duration: Math.round(entry.duration),
        detail: (entry as PerformanceMark).detail ?? undefined,
      })),
  }));
  const out =
    process.env.FIRST_SYNC_OUT ??
    join(tmpdir(), "agent-kit", "first-sync.jsonl");
  mkdirSync(dirname(out), { recursive: true });
  const at = (ms: number) => Math.round(ms - timeOrigin);
  appendFileSync(
    out,
    JSON.stringify({
      size: process.env.FIRST_SYNC_SIZE ?? "medium",
      profile: profileName,
      label: process.env.FIRST_SYNC_LABEL ?? "",
      viewport: page.viewportSize(),
      marks: lab.marks,
      screen: lab.screen,
      entries,
      images: {
        count: images.count,
        first: images.count ? at(images.first) : null,
        last: images.count ? at(images.last) : null,
      },
      requests: requests
        .map((request) => ({
          ...request,
          start: at(request.start),
          end: at(request.end),
        }))
        .sort((a, b) => a.start - b.start),
    }) + "\n",
  );
  return lab.marks.allListed;
}
