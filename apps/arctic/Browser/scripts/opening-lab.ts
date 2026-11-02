/**
 * Opening lab: Arctic for the web opens on a bad network (../../OPENING.md).
 *
 * A production build and the shared API, each behind a gate that this
 * script controls, and a real browser profile that has opened Arctic before.
 * The gates shape what the service worker sees, which the browser's own
 * throttling does not:
 *
 * - `good`: answers at once.
 * - `slow`: 2 s before each first byte, then 40 kB/s.
 * - `flaky`: every second request hangs for 10 s and drops; the others are slow.
 * - `dead`: the connection opens and no answer comes, while `navigator.onLine`
 *   stays true.
 * - `offline`: the browser says it is offline.
 *
 * Three kinds of start, each on each network:
 *
 * - `new`: nothing is stored here, only the session cookie.
 * - `cold`: the browser restarts with this profile, so nothing is in memory.
 * - `warm`: a new page in a browser that already runs.
 *
 *   # apps/sync-server: the API, whose public address is the gate's.
 *   bun x wrangler d1 migrations apply workbench-sync-local --local --persist-to <dir>
 *   bun x wrangler dev --local --port 5689 --inspector-port 5684 --persist-to <dir> \
 *     --var BASE_URL:http://localhost:5683 --var APP_ORIGINS:http://localhost:5687
 *   # apps/arctic/Browser: the build, and the lab.
 *   VITE_SHARED_API_URL=http://localhost:5683 bun x vite build --outDir <dist>
 *   LAB_DIST=<dist> node scripts/opening-lab.ts --out results.json
 *
 * It runs on Node: Playwright's pipe to a browser is not dependable on Bun.
 *
 * It waits at most LAB_CAP_MS (30 s) for each step, and writes one row for
 * each start. Local only: its gates listen on localhost.
 */
import { chromium, type BrowserContext, type Page } from "playwright";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { parseArgs } from "node:util";
import { xxh64 } from "../src/sync/xxh64.ts";

const API_PORT = Number(process.env.LAB_API_PORT ?? 5683);
const API = `http://localhost:${API_PORT}`;
const UPSTREAM = process.env.LAB_UPSTREAM ?? "http://localhost:5689";
const PORT = Number(process.env.LAB_APP_PORT ?? 5687);
const APP = `http://localhost:${PORT}`;
const CAP_MS = Number(process.env.LAB_CAP_MS ?? 30_000);
const dist = process.env.LAB_DIST ?? "dist";

export const NETWORKS = ["good", "slow", "flaky", "dead", "offline"] as const;
export type Network = (typeof NETWORKS)[number];
export const STARTS = ["new", "cold", "warm"] as const;
export type Start = (typeof STARTS)[number];

let network: Network = "good";
let requests = 0;
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
};

/** Sends a body, at the slow network's rate there. */
async function send(response: ServerResponse, bytes: Uint8Array) {
  if (network !== "slow" && network !== "flaky") return response.end(bytes);
  for (let sent = 0; sent < bytes.length; sent += 4_000) {
    if (response.destroyed) return;
    await sleep(100);
    response.write(bytes.subarray(sent, sent + 4_000));
  }
  response.end();
}

/** What a request meets on this network. False: it drops. */
async function pass(request: IncomingMessage) {
  if (network === "dead")
    await new Promise((done) => request.socket.once("close", done));
  if (network === "flaky" && ++requests % 2 === 0) {
    await sleep(10_000);
    return false;
  }
  if (network === "slow" || network === "flaky") await sleep(2_000);
  return !request.socket.destroyed;
}

// Cloudflare's static assets: a file, else the app for a page.
const gate = createServer(async (request, response) => {
  if (!(await pass(request))) return response.destroy();
  const path = new URL(request.url ?? "/", APP).pathname;
  let file = join(dist, path);
  if (!existsSync(file) || !statSync(file).isFile()) {
    if (path.startsWith("/assets/")) return response.writeHead(404).end();
    file = join(dist, "index.html");
  }
  response.writeHead(200, {
    "Content-Type": types[extname(file)] ?? "application/octet-stream",
    "Cache-Control": path.startsWith("/assets/")
      ? "public, max-age=31536000, immutable"
      : "public, max-age=0, must-revalidate",
  });
  await send(response, readFileSync(file));
});

const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

/** The shared API, and the publishers' covers, behind the same network. */
const apiGate = createServer(async (request, response) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  if (!(await pass(request))) return response.destroy();
  const path = request.url ?? "/";
  if (path.startsWith("/__cover/")) {
    response.writeHead(200, { "Content-Type": "image/png" });
    return send(response, PIXEL);
  }
  const answer = await new Promise<IncomingMessage | undefined>((done) => {
    const forward = httpRequest(
      `${UPSTREAM}${path}`,
      { method: request.method, headers: request.headers },
      done,
    );
    forward.on("error", () => done(undefined));
    forward.end(Buffer.concat(chunks));
  });
  if (!answer) return response.destroy();
  const body: Buffer[] = [];
  for await (const chunk of answer) body.push(chunk as Buffer);
  const {
    "content-length": _,
    "transfer-encoding": __,
    ...out
  } = answer.headers;
  response.writeHead(answer.statusCode ?? 502, out);
  await send(response, Buffer.concat(body));
});

await Promise.all([
  new Promise<void>((done) => gate.listen(PORT, "localhost", done)),
  new Promise<void>((done) => apiGate.listen(API_PORT, "localhost", done)),
]);

const swiftDate = (ms: number) => (ms - 978_307_200_000) / 1000;
const sorted = (value: Record<string, unknown>) =>
  JSON.stringify(
    Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, value[key]]),
    ),
  );
const identity = async (url: string) =>
  Buffer.from(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(url)),
  ).toString("hex");

/** A fresh local account with `count` saved links, each with a text. */
async function seed(count: number) {
  const email = `opening-${crypto.randomUUID()}@opening-lab.test`;
  const signUp = await fetch(`${UPSTREAM}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { Origin: APP, "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password: crypto.randomUUID(),
      name: "Opening lab",
    }),
  });
  if (!signUp.ok) throw new Error(`Sign-up failed: ${signUp.status}`);
  const cookie = signUp.headers.getSetCookie()[0]!.split(";")[0]!;
  const [name, ...value] = cookie.split("=");
  const send = (path: string, init: RequestInit = {}) =>
    fetch(`${UPSTREAM}${path}`, {
      ...init,
      headers: { Origin: APP, Cookie: cookie, ...init.headers },
    });
  const scope = async (namespace: string) =>
    await (await send(`/api/apps/${namespace}/sync/v3/state`)).text();
  const links: { key: string; value: string }[] = [];
  const copies: { key: string; value: string }[] = [];
  for (let index = 0; index < count; index++) {
    const url = `https://sea-ice.example/notes/${index}`;
    const id = await identity(url);
    links.push(
      {
        key: `article/${id}`,
        value: sorted({
          url,
          title: `Field note ${index + 1}`,
          subtitle: "Where the ice went this season.",
          imageURL: `${API}/__cover/${index}.png`,
        }),
      },
      {
        key: `library/${id}`,
        value: sorted({
          url,
          saved: true,
          archived: false,
          read: false,
          savedAt: swiftDate(Date.now() - index * 60_000),
        }),
      },
    );
    const html = `<h2>Field note ${index + 1}</h2>${"<p>Sea ice forms, drifts and thins with the seasons, and the people who read it keep careful notes about where it goes.</p>".repeat(30)}`;
    const bytes = new TextEncoder().encode(html);
    const file = xxh64(bytes);
    const upload = await send(`/api/apps/arctic-content/files/${file}`, {
      method: "PUT",
      headers: {
        "X-Sync-Scope": await scope("arctic-content"),
        "Content-Type": "text/html; charset=utf-8",
      },
      body: bytes,
    });
    if (!upload.ok) throw new Error(`Upload failed: ${upload.status}`);
    copies.push({
      key: `content/${id}`,
      value: sorted({
        url,
        file,
        bytes: bytes.byteLength,
        words: 700,
        format: "html",
        source: "file",
        savedAt: Date.now(),
      }),
    });
  }
  const push = async (namespace: string, records: typeof links) => {
    for (let start = 0; start < records.length; start += 200) {
      const response = await send(`/api/apps/${namespace}/sync/v3/push`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Device-ID": "iphone",
          "X-Sync-Scope": await scope(namespace),
        },
        body: JSON.stringify({
          changes: records.slice(start, start + 200).map((record) => ({
            ...record,
            isDeleted: false,
            schemaVersion: 1,
            hlc: { wallTimeMs: Date.now(), counter: 0 },
          })),
        }),
      });
      if (!response.ok) throw new Error(`Push failed: ${response.status}`);
    }
  };
  await push("arctic", links);
  await push("arctic-content", copies);
  return [
    { name: name!, value: value.join("="), domain: "localhost", path: "/" },
  ];
}

type Step = number | null;
export type Row = {
  network: Network;
  start: Start;
  /** The first paint, from the start of the open. Null: not within the cap. */
  paint: Step;
  /** The first article cards on screen. */
  cards: Step;
  /** From the click on a card to its text on screen, once the cards show. */
  text: Step;
  /** What shows at the cap, when the library did not. */
  note?: string;
};

async function time(work: Promise<unknown>, started: number) {
  return work.then(
    () => Math.round(performance.now() - started),
    () => null,
  );
}

async function open(context: BrowserContext, page: Page, offline: boolean) {
  await context.setOffline(offline);
  const started = performance.now();
  const navigation = page
    .goto(APP, { waitUntil: "commit", timeout: CAP_MS })
    .catch(() => {});
  const cardTitle = page.locator(".card-title").first();
  const cards = await time(
    cardTitle.waitFor({ state: "visible", timeout: CAP_MS }),
    started,
  );
  await navigation;
  const paint = await Promise.race([
    page
      .evaluate(
        () =>
          performance.getEntriesByName("first-contentful-paint")[0]?.startTime,
      )
      .catch(() => undefined),
    sleep(500),
  ]);
  let text: Step = null;
  if (cards !== null) {
    const click = performance.now();
    await cardTitle.click({ timeout: 5_000 }).catch(() => {});
    text = await time(
      page
        .locator(".prose p")
        .first()
        .waitFor({ state: "visible", timeout: 15_000 }),
      click,
    );
  }
  return {
    paint: typeof paint === "number" ? Math.round(paint) : null,
    cards,
    text,
  };
}

async function main() {
  const { values } = parseArgs({
    options: {
      out: { type: "string" },
      links: { type: "string", default: "24" },
      networks: { type: "string" },
      starts: { type: "string" },
      runs: { type: "string", default: "3" },
      clip: { type: "string" },
    },
  });
  const networks = (values.networks?.split(",") ?? NETWORKS) as Network[];
  const starts = (values.starts?.split(",") ?? STARTS) as Start[];
  const cookies = await seed(Number(values.links));
  const rows: Row[] = [];
  const launch = (directory: string) =>
    chromium.launchPersistentContext(directory, {
      viewport: { width: 390, height: 844 },
      serviceWorkers: "allow",
      ...(values.clip
        ? {
            recordVideo: {
              dir: values.clip,
              size: { width: 390, height: 844 },
            },
          }
        : {}),
    });
  for (const kind of networks)
    for (const start of starts)
      for (let run = 0; run < Number(values.runs); run++) {
        const profile = mkdtempSync(join(tmpdir(), "arctic-opening-lab-"));
        let context = await launch(profile);
        await context.addCookies(cookies);
        if (start !== "new") {
          // Opens once on a good network: the worker, the library and every
          // text are stored, as after a day of use.
          network = "good";
          const page = context.pages()[0] ?? (await context.newPage());
          await page.goto(APP);
          await page.evaluate(() => navigator.serviceWorker.ready);
          await page.locator(".card-title").first().waitFor();
          await page.goto(`${APP}/settings`);
          await page.getByRole("button", { name: /^Download/ }).click();
          await page
            .locator(".offline-status")
            .getByText(/of \d+ texts/)
            .waitFor();
          await page
            .getByRole("button", { name: "All text is on this device" })
            .waitFor();
          // The worker keeps the shell after each page: let it finish.
          await sleep(1_000);
          await page.goto("about:blank");
          if (start === "cold") {
            await context.close();
            context = await launch(profile);
            await context.addCookies(cookies);
          }
        }
        network = kind;
        requests = 0;
        // The browser's first tab: a tab in the background is held back.
        const page = context.pages()[0] ?? (await context.newPage());
        const result = await open(context, page, kind === "offline");
        const row: Row = { network: kind, start, ...result };
        if (result.cards === null)
          row.note = await Promise.race([
            page.evaluate(() => document.body.innerText.slice(0, 60)),
            sleep(300).then(() => "a blank page"),
          ]).catch(() => "a browser error");
        rows.push(row);
        console.log(JSON.stringify(row));
        network = "good";
        await context.setOffline(false);
        await Promise.race([context.close(), sleep(5_000)]);
        rmSync(profile, { recursive: true, force: true });
      }
  if (values.out) writeFileSync(values.out, JSON.stringify(rows, null, 1));
  process.exit(0);
}

await main();
