/**
 * Agent kit `--steps` module: on the page that kit-sign-in.ts opened, sets
 * a colo's delays (LAB_PROFILE=near|far, as in bench.ts), starts the app's
 * "download everything" and waits until it ends. Returns its duration, so
 * it also serves `kit time`.
 */
import type { BrowserContext, Page } from "@playwright/test";
import { LAB_API } from "./kit-sign-in";

const PROFILES = {
  near: { rttMs: 25, d1Ms: 30, r2Ms: 135, bytesPerSecond: 6_000_000 },
  far: { rttMs: 320, d1Ms: 170, r2Ms: 550, bytesPerSecond: 1_200_000 },
};

export default async function download({
  page,
  context,
}: {
  page: Page;
  context: BrowserContext;
}) {
  const n = Number(process.env.LAB_N);
  const count = n.toLocaleString("en-US");
  const profile =
    PROFILES[(process.env.LAB_PROFILE ?? "near") as keyof typeof PROFILES];
  const spaced = process.env.LAB_APP === "spaced";
  const start = spaced
    ? page.getByRole("button", { name: "Start" })
    : page.getByRole("button", { name: `Download ${count} texts` });
  await start.waitFor({ timeout: 60_000 });
  if (spaced)
    // The cards arrive with the first sync.
    for (let tries = 0; ; tries++) {
      const cards = await page.evaluate(async () => {
        const memory = "/src/lib/db/memory.ts";
        return (await import(memory)).default.getCards().length;
      });
      if (cards === n) break;
      if (tries > 120) throw new Error(`${cards} of ${n} cards arrived`);
      await page.waitForTimeout(500);
    }
  await fetch(`${LAB_API}/__lab`, {
    method: "POST",
    body: JSON.stringify(profile),
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: profile.rttMs,
    downloadThroughput: profile.bytesPerSecond,
    uploadThroughput: -1,
  });
  const t0 = performance.now();
  try {
    await start.click();
    await (
      spaced
        ? page.getByText(/Downloaded \d+ new images/)
        : page.getByText(`${count} of ${count}`)
    ).waitFor({ timeout: 110_000 });
    return performance.now() - t0;
  } finally {
    await fetch(`${LAB_API}/__lab`, {
      method: "POST",
      body: JSON.stringify({ d1Ms: 0, r2Ms: 0 }),
    });
  }
}
