/**
 * Times "download everything" in Arctic for the web (Settings → Offline) and
 * Spaced (Images → Download all) against the lab API (worker.ts), with the
 * round trip, storage delays and bandwidth of a production colo
 * (docs/FILE_BATCH.md). Each run is a fresh browser profile; each line of
 * output is one run, as JSON.
 *
 *   node scripts/file-batch-lab/bench.ts --app arctic --url http://localhost:5502 \
 *     --label after --n 200 --profile near --runs 3 [--seed] [--fixtures DIR]
 *
 * `--seed` adds an account with n articles and texts, or n cards with one
 * image each, before timing. Synthetic texts and images take their sizes
 * from `--sizes FILE` (one byte count a line), else from a built-in spread.
 * Local only: it refuses an API that is not on localhost.
 */
import { chromium, type BrowserContext, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import xxhash from "xxhash-wasm";

const options = Object.fromEntries(
  process.argv
    .slice(2)
    .join(" ")
    .split(/\s*--/)
    .filter(Boolean)
    .map((part) => {
      const [key, ...value] = part.split(" ");
      return [key!, value.join(" ") || "true"];
    }),
) as Record<string, string>;
const api = options.api ?? "http://localhost:5501";
const app = options.app as "arctic" | "spaced";
const appUrl = options.url!;
const n = Number(options.n ?? 50);
const runs = Number(options.runs ?? 1);
const label = options.label ?? "run";
if (!["localhost", "127.0.0.1"].includes(new URL(api).hostname))
  throw new Error("The lab runs against a local API only");
if (!["arctic", "spaced"].includes(app) || !appUrl)
  throw new Error("Pass --app arctic|spaced and --url");

/** Measured from Singapore on 27 October 2026 (docs/FILE_BATCH.md). */
const PROFILES = {
  /** The SIN colo: D1 and R2 are in APAC. */
  near: { rttMs: 25, d1Ms: 30, r2Ms: 135, bytesPerSecond: 6_000_000 },
  /** A European colo (FRA, MRS, CDG), where the route often lands. */
  far: { rttMs: 320, d1Ms: 170, r2Ms: 550, bytesPerSecond: 1_200_000 },
  none: { rttMs: 0, d1Ms: 0, r2Ms: 0, bytesPerSecond: -1 },
} as const;
const profile = PROFILES[(options.profile ?? "near") as keyof typeof PROFILES];
const email = `lab-${app}-${n}@example.test`;
const password = "file-batch-lab-password";

const setLab = (value: object) =>
  fetch(`${api}/__lab`, { method: "POST", body: JSON.stringify(value) });

function sizes(fallbackMean: number) {
  const list = options.sizes
    ? readFileSync(options.sizes, "utf8").trim().split("\n").map(Number)
    : Array.from({ length: 97 }, (_, i) =>
        Math.round(fallbackMean * (0.2 + (1.6 * ((i * 37) % 97)) / 97)),
      );
  return (index: number) => list[index % list.length]!;
}

/** Signs in through the API; the context then holds the session cookie. */
async function signIn(context: BrowserContext, create = false) {
  const post = (path: string) =>
    context.request.post(`${api}/api/auth/${path}`, {
      data: { email, password, name: "Lab" },
      headers: { Origin: appUrl },
    });
  if (create && (await post("sign-up/email")).ok()) return;
  const response = await post("sign-in/email");
  if (!response.ok())
    throw new Error(`Sign-in failed (${response.status()}); seed first`);
}

async function scope(context: BrowserContext, namespace: string) {
  const response = await context.request.get(
    `${api}/api/apps/${namespace}/sync/v3/state`,
  );
  return JSON.stringify(await response.json());
}

async function upload(
  context: BrowserContext,
  namespace: string,
  bytes: Uint8Array,
  type: string,
) {
  const hash = await xxhash();
  const id = `xxh64:${hash.h64Raw(bytes).toString(16).padStart(16, "0")}`;
  const response = await context.request.put(
    `${api}/api/apps/${namespace}/files/${id}`,
    {
      headers: {
        Origin: appUrl,
        "Content-Type": type,
        "X-Sync-Scope": await scope(context, namespace),
      },
      data: Buffer.from(bytes),
    },
  );
  if (!response.ok()) throw new Error(`Upload failed (${response.status()})`);
  return id;
}

async function push(
  context: BrowserContext,
  namespace: string,
  records: { key: string; value: string }[],
) {
  for (let start = 0; start < records.length; start += 200) {
    const response = await context.request.post(
      `${api}/api/apps/${namespace}/sync/v3/push`,
      {
        headers: {
          Origin: appUrl,
          "X-Device-ID": "lab-seed",
          "X-Sync-Scope": await scope(context, namespace),
        },
        data: {
          changes: records.slice(start, start + 200).map((record) => ({
            ...record,
            isDeleted: false,
            schemaVersion: 1,
            hlc: { wallTimeMs: Date.now(), counter: 0 },
          })),
        },
      },
    );
    if (!response.ok()) throw new Error(`Push failed (${response.status()})`);
  }
}

/** Swift's sorted-key JSON, as the phone writes Arctic records. */
const sorted = (value: Record<string, unknown>) =>
  JSON.stringify(
    Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, value[k]]),
    ),
  );
const WORDS =
  "ice floe drift season tundra light harbour current salt wind north river snow coast archive reader paragraph measure quiet signal winter".split(
    " ",
  );
/** Article-like HTML of about `size` bytes that compresses as prose does. */
function articleHtml(index: number, size: number) {
  let seed = index + 1;
  const random = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  let html = `<article><h1>Lab article ${index}</h1>`;
  while (html.length < size) {
    const words = Array.from(
      { length: 40 },
      () =>
        WORDS[Math.floor(random() * WORDS.length)]! +
        (random() < 0.1 ? "," : ""),
    );
    html += `<p>${words.join(" ")} ${Math.floor(random() * 1e6)}.</p>`;
  }
  return `${html}</article>`;
}

async function seedArctic(context: BrowserContext) {
  await signIn(context, true);
  const size = sizes(26_000);
  const library: { key: string; value: string }[] = [];
  const content: { key: string; value: string }[] = [];
  for (let i = 0; i < n; i++) {
    const url = `https://lab.example/articles/${i}`;
    const id = createHash("sha256").update(url).digest("hex");
    const savedAt = (Date.now() - i * 60_000 - 978_307_200_000) / 1000;
    library.push(
      {
        key: `article/${id}`,
        value: sorted({ url, title: `Lab article ${i}`, subtitle: "" }),
      },
      {
        key: `library/${id}`,
        value: sorted({
          url,
          saved: true,
          archived: false,
          read: false,
          savedAt,
        }),
      },
      {
        key: `tags/${id}`,
        value: sorted({
          url,
          names: [],
          manual: [],
          automatic: [],
          rejected: [],
          generation: "0F8B2E0C-6E44-4A55-9B3C-0D6D5C6B7A10",
        }),
      },
    );
    const html = articleHtml(i, size(i));
    const bytes = new TextEncoder().encode(html);
    const file = await upload(
      context,
      "arctic-content",
      bytes,
      "text/html; charset=utf-8",
    );
    content.push({
      key: `content/${id}`,
      value: sorted({
        url,
        file,
        bytes: bytes.byteLength,
        words: html.split(/\s+/).length,
        format: "html",
        source: "file",
        savedAt: Date.now(),
      }),
    });
  }
  await push(context, "arctic", library);
  await push(context, "arctic-content", content);
}

/** Screenshot-like PNGs (median 1325 × 662, as the account's images). */
async function imageFixtures(page: Page, count: number) {
  const dir = options.fixtures ?? "lab-fixtures";
  mkdirSync(dir, { recursive: true });
  const size = sizes(217_000);
  for (let start = 0; start < count; start += 10) {
    const missing = Array.from(
      { length: Math.min(10, count - start) },
      (_, k) => start + k,
    ).filter((i) => !existsSync(join(dir, `${i}.png`)));
    if (missing.length === 0) continue;
    const made = await page.evaluate(
      async (items) =>
        Promise.all(
          items.map(async ({ index, target }) => {
            const canvas = document.createElement("canvas");
            canvas.width = 1100 + ((index * 53) % 450);
            canvas.height = 560 + ((index * 31) % 200);
            const context = canvas.getContext("2d")!;
            context.fillStyle = `hsl(${(index * 47) % 360} 30% 96%)`;
            context.fillRect(0, 0, canvas.width, canvas.height);
            context.fillStyle = "#222";
            context.font = "18px sans-serif";
            for (let line = 0; line < 20; line++)
              context.fillText(
                `Figure ${index}, line ${line}: a note about sea ice.`,
                24,
                40 + line * 26,
              );
            // Noise rows bring the file to about its target size.
            const rows = Math.min(
              canvas.height,
              Math.max(1, Math.round(target / (canvas.width * 3.2))),
            );
            const noise = context.createImageData(canvas.width, rows);
            for (let p = 0; p < noise.data.length; p++)
              noise.data[p] = p % 4 === 3 ? 255 : (Math.random() * 256) | 0;
            context.putImageData(noise, 0, canvas.height - rows);
            const blob = await new Promise<Blob>((resolve) =>
              canvas.toBlob((b) => resolve(b!), "image/png"),
            );
            const bytes = new Uint8Array(await blob.arrayBuffer());
            let binary = "";
            for (let i = 0; i < bytes.length; i += 0x8000)
              binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
            return { index, data: btoa(binary) };
          }),
        ),
      missing.map((index) => ({ index, target: size(index) })),
    );
    for (const { index, data } of made)
      writeFileSync(join(dir, `${index}.png`), Buffer.from(data, "base64"));
  }
  return (index: number) =>
    new Uint8Array(readFileSync(join(dir, `${index}.png`)));
}

async function seedSpaced(context: BrowserContext, page: Page) {
  await signIn(context, true);
  const image = await imageFixtures(page, n);
  const fronts: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = await upload(context, "spaced", image(i), "image/png");
    fronts.push(
      `Figure ${i}\n\n![Figure ${i}](${api}/api/apps/spaced/files/${id})`,
    );
  }
  await page.goto(appUrl);
  await page.evaluate(async (fronts) => {
    const operation = "/src/lib/sync/operation.ts",
      engine = "/src/lib/sync/engine.ts";
    const { createNewCard } = await import(operation);
    for (const front of fronts) await createNewCard(front, "Back");
    await (await import(engine)).default.syncToServer();
  }, fronts);
}

/** Network conditions as Chrome's DevTools emulates them, for this page. */
async function emulate(context: BrowserContext, page: Page) {
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: profile.rttMs,
    downloadThroughput: profile.bytesPerSecond,
    uploadThroughput: -1,
  });
}

async function timeArctic(page: Page, context: BrowserContext) {
  await page.goto(`${appUrl}/settings`);
  const start = page.getByRole("button", {
    name: `Download ${n.toLocaleString("en-US")} texts`,
  });
  await start.waitFor({ timeout: 120_000 });
  await setLab(profile);
  await emulate(context, page);
  const t0 = Date.now();
  await start.click();
  await page
    .locator(".offline-status")
    .filter({
      hasText: `${n.toLocaleString("en-US")} of ${n.toLocaleString("en-US")}`,
    })
    .waitFor({ timeout: 30 * 60_000 });
  return {
    ms: Date.now() - t0,
    status: await page.locator(".offline-status").innerText(),
  };
}

async function timeSpaced(page: Page, context: BrowserContext) {
  await page.goto(`${appUrl}/images`);
  // The cards arrive with the first sync.
  for (let tries = 0; ; tries++) {
    const cards = await page.evaluate(async () => {
      const memory = "/src/lib/db/memory.ts";
      return (await import(memory)).default.getCards().length;
    });
    if (cards === n) break;
    if (tries > 240) throw new Error(`${cards} of ${n} cards arrived`);
    await page.waitForTimeout(500);
  }
  await setLab(profile);
  await emulate(context, page);
  const t0 = Date.now();
  await page.getByRole("button", { name: "Start" }).click();
  const row = page.getByText(/Downloaded \d+ new images/);
  await row.waitFor({ timeout: 30 * 60_000 });
  return { ms: Date.now() - t0, status: await row.innerText() };
}

const browser = await chromium.launch({ headless: true });
try {
  await setLab({ ...PROFILES.none, batch: true });
  if (options.seed) {
    const context = await browser.newContext();
    const page = await context.newPage();
    if (app === "arctic") await seedArctic(context);
    else await seedSpaced(context, page);
    await context.close();
  }
  for (let run = 1; run <= runs; run++) {
    await setLab({ ...PROFILES.none, batch: options.batch !== "false" });
    const context = await browser.newContext({ serviceWorkers: "block" });
    try {
      await signIn(context);
      const page = await context.newPage();
      const result =
        app === "arctic"
          ? await timeArctic(page, context)
          : await timeSpaced(page, context);
      console.log(
        JSON.stringify({
          app,
          label,
          n,
          profile: options.profile ?? "near",
          run,
          ...result,
        }),
      );
    } finally {
      await setLab({ ...PROFILES.none, batch: true });
      await context.close();
    }
  }
} finally {
  await browser.close();
}
