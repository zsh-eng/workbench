/**
 * First-sync lab: a new device signs in to an Arctic library over a
 * production-like link (docs/FIRST_SYNC.md).
 *
 * The lab API is the shared API with production's storage delays
 * (`apps/sync-server/wrangler.lab.jsonc`; `POST /__lab` sets them). This
 * script seeds one account per library size there, and serves the
 * articles' og:images and favicons, each publisher on its own host
 * (`<site>.localhost`), with a publisher CDN's wait before each image.
 *
 *   bun scripts/first-sync-lab.ts images          # 5544, LAB_IMAGE_PORT
 *   bun scripts/first-sync-lab.ts seed medium     # small | medium | large
 *
 * The kit modules `tests/kit/first-sync-device.ts` and
 * `tests/kit/first-sync.ts` sign in and time a new device. Local only: it
 * refuses an API that is not on localhost.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { xxh64 } from "../src/sync/xxh64";

export const LAB_API = process.env.LAB_API ?? "http://localhost:5541";
// The lab signs in, seeds and sets delays: never on a shared API.
if (!["localhost", "127.0.0.1"].includes(new URL(LAB_API).hostname))
  throw new Error("The first-sync lab runs against a local API only");
export const LAB_APP = process.env.LAB_APP ?? "http://localhost:5543";
export const LAB_IMAGE_PORT = Number(process.env.LAB_IMAGE_PORT ?? 5544);
const CACHE = path.resolve(
  import.meta.dirname,
  "../node_modules/.cache/first-sync-lab",
);

/**
 * Library sizes. `medium` has the shape of the real account in October
 * 2026 (734 articles, 626 texts); `small` is a new user and `large` a few
 * years of saving. Highlights and reading sessions grow with use.
 */
export const LAB_SIZES = {
  small: { articles: 120, texts: 100, highlights: 20, sessions: 60 },
  medium: { articles: 750, texts: 630, highlights: 300, sessions: 900 },
  large: { articles: 2000, texts: 1700, highlights: 2000, sessions: 4000 },
} as const;
export type LabSize = keyof typeof LAB_SIZES;

/** A local test account per size; the password is for the lab API only. */
export const labAccount = (size: LabSize) => ({
  email: `${size}@first-sync-lab.test`,
  password: "first-sync-lab-password",
  name: `First sync lab (${size})`,
});

/** Network profiles measured from Singapore (docs/FILE_BATCH.md). */
export const LAB_PROFILES = {
  /** The SIN colo: D1 and R2 are in APAC. */
  near: { rttMs: 25, d1Ms: 30, r2Ms: 135, bytesPerSecond: 6_000_000 },
  /** A European colo (FRA, MRS, CDG), where the route often lands. */
  far: { rttMs: 320, d1Ms: 170, r2Ms: 550, bytesPerSecond: 1_200_000 },
  none: { rttMs: 0, d1Ms: 0, r2Ms: 0, bytesPerSecond: -1 },
} as const;
export type LabProfile = keyof typeof LAB_PROFILES;

// A deterministic random sequence, so every seed of a size is the same.
function random(seed: number) {
  let state = seed % 2147483647 || 1;
  return () => (state = (state * 48271) % 2147483647) / 2147483647;
}

const SITES = [
  "harbourreview.com",
  "northcurrent.news",
  "thetidewater.org",
  "fieldnotes.substack.com",
  "longform-weekly.com",
  "quietmachines.dev",
  "the-meridian.co",
  "saltandsignal.com",
  "atlas-quarterly.com",
  "lowlight.blog",
  "tundraeconomics.com",
  "coastlines.press",
  "slowcode.io",
  "ledger-and-lamp.com",
  "openwater.studio",
  "glacier.engineering",
  "paperboat.substack.com",
  "riverbend.news",
  "the-observatory.net",
  "windward.journal",
  "smallbatch.design",
  "plainsight.substack.com",
  "hinterland.review",
  "deepfield.science",
  "northernlights.media",
  "archive-of-hours.com",
  "frostline.co",
  "drift.engineering",
  "thecompass.blog",
  "longshore.org",
];
/** Mostly few publishers, as a real library has (251 hosts in 400 links). */
const site = (index: number, next: () => number) =>
  next() < 0.7
    ? SITES[Math.floor(next() * next() * SITES.length)]!
    : `writer${index % 211}.example.com`;

const TOPICS = [
  "Engineering",
  "Design",
  "Economics",
  "Climate",
  "Cities",
  "Writing",
  "Science",
  "History",
  "Health",
  "Music",
  "Software",
  "Politics",
  "Books",
  "Food",
  "Travel",
  "Startups",
  "AI",
  "Education",
];
const SUBJECTS = [
  "sea ice",
  "small software",
  "harbour towns",
  "the night train",
  "public libraries",
  "slow rivers",
  "the first draft",
  "quiet databases",
  "winter cities",
  "deep work",
  "the lighthouse keeper",
  "paper maps",
  "local-first apps",
  "cold storage",
  "the long walk",
  "tidal power",
  "the reading room",
  "open source",
  "school lunches",
  "the city bus",
];
const TITLES = [
  (s: string) => `How ${s} keeps time`,
  (s: string) => `The quiet economics of ${s}`,
  (s: string) => `What ${s} taught me about attention`,
  (s: string) => `Notes on ${s}`,
  (s: string) => `Why ${s} matters more than ever`,
  (s: string) => `A field guide to ${s}`,
  (s: string) => `The case against ${s}`,
  (s: string) => `${s[0]!.toUpperCase()}${s.slice(1)}, revisited`,
  (s: string) => `Inside the fight over ${s}`,
  (s: string) => `Ten years of ${s}: what changed and what didn't`,
];
const WORDS =
  "ice floe drift season tundra light harbour current salt wind north river snow coast archive reader paragraph measure quiet signal winter longer careful patient small simple people city water".split(
    " ",
  );
const sentence = (next: () => number, words: number) => {
  const text = Array.from(
    { length: words },
    () => WORDS[Math.floor(next() * WORDS.length)]!,
  ).join(" ");
  return `${text[0]!.toUpperCase()}${text.slice(1)}.`;
};

/** Image kinds and how often an article has each (24% have none). */
const IMAGE_KINDS = [
  { kind: "og", share: 0.5, width: 1200, height: 630 },
  { kind: "wide", share: 0.1, width: 1280, height: 720 },
  { kind: "square", share: 0.06, width: 1080, height: 1080 },
  { kind: "tall", share: 0.03, width: 800, height: 1000 },
  /** A site icon given as og:image: Arctic shows a text card. */
  { kind: "icon", share: 0.04, width: 192, height: 192 },
  /** A broken URL: the card falls back to text. */
  { kind: "missing", share: 0.03, width: 0, height: 0 },
] as const;
const IMAGES_PER_KIND = 24;

const swiftDate = (ms: number) => (ms - 978_307_200_000) / 1000;
const sorted = (value: Record<string, unknown>) =>
  JSON.stringify(
    Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, value[key]]),
    ),
  );
const identity = (url: string) =>
  createHash("sha256").update(url).digest("hex");
const uuid = (next: () => number) =>
  "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx"
    .replace(/x/g, () => Math.floor(next() * 16).toString(16))
    .toUpperCase();

/** One article of the library, as the phone stores it. */
export type LabArticle = {
  id: string;
  url: string;
  host: string;
  title: string;
  saved: boolean;
  archived: boolean;
  savedAt: number;
};

/**
 * The library of one size: every record, and the articles, newest saved
 * first. `seed` uploads them in the order of the real account's first
 * upload from the phone: all `article/`, then `library/`, then `tags/`.
 */
export function labLibrary(size: LabSize, now = Date.UTC(2026, 9, 27)) {
  const profile = LAB_SIZES[size];
  const next = random(profile.articles * 7919);
  const day = 86_400_000;
  const records = {
    article: [] as { key: string; value: string }[],
    library: [] as { key: string; value: string }[],
    tags: [] as { key: string; value: string }[],
    content: [] as { key: string; value: string; html?: string }[],
    annotations: [] as { key: string; value: string }[],
    reading: [] as { key: string; value: string }[],
  };
  const articles: LabArticle[] = [];
  for (let index = 0; index < profile.articles; index++) {
    const host = site(index, next);
    const subject = SUBJECTS[Math.floor(next() * SUBJECTS.length)]!;
    const title = TITLES[Math.floor(next() * TITLES.length)]!(subject);
    const url = `https://${host}/${index}/${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    const id = identity(url);
    // Saved over three years.
    const savedAt =
      now - (profile.articles - index) * ((3 * 365 * day) / profile.articles);
    const roll = next();
    const historyOnly = roll < 0.05;
    const archived = !historyOnly && roll < 0.15;
    const visited = historyOnly || next() < 0.25;
    const favourite = !historyOnly && next() < 0.02;
    let image: string | undefined;
    let pick = next();
    for (const kind of IMAGE_KINDS) {
      if (pick < kind.share) {
        image = `http://${host.replace(/[^a-z0-9-]/g, "-")}.localhost:${LAB_IMAGE_PORT}/og/${kind.kind}/${index % IMAGES_PER_KIND}/${id.slice(0, 12)}.jpg`;
        break;
      }
      pick -= kind.share;
    }
    const favicon =
      next() < 0.85
        ? `http://${host.replace(/[^a-z0-9-]/g, "-")}.localhost:${LAB_IMAGE_PORT}/favicon/${index % 7}.png`
        : undefined;
    records.article.push({
      key: `article/${id}`,
      value: sorted({
        url,
        title,
        subtitle: sentence(next, 18 + Math.floor(next() * 14)),
        ...(image ? { imageURL: image } : {}),
        ...(favicon ? { faviconURL: favicon } : {}),
        // The phone keeps text for its topic model: most of a record's bytes.
        taggingText: Array.from({ length: 6 }, () => sentence(next, 22)).join(
          " ",
        ),
      }),
    });
    const visitedAt = savedAt + next() * 30 * day;
    records.library.push({
      key: `library/${id}`,
      value: sorted({
        url,
        saved: !historyOnly,
        archived,
        read: visited,
        ...(historyOnly ? {} : { savedAt: swiftDate(savedAt) }),
        ...(visited ? { lastVisitedAt: swiftDate(visitedAt) } : {}),
        ...(favourite
          ? { favourite: true, favouritedAt: swiftDate(visitedAt) }
          : {}),
      }),
    });
    const tagCount = [0, 0, 0, 1, 1, 1, 1, 2, 2, 3][Math.floor(next() * 10)]!;
    const names = Array.from(
      new Set(
        Array.from(
          { length: tagCount },
          () => TOPICS[Math.floor(next() * next() * TOPICS.length)]!,
        ),
      ),
    );
    records.tags.push({
      key: `tags/${id}`,
      value: sorted({
        url,
        names,
        manual: [],
        automatic: names,
        rejected: [],
        generation: "0F8B2E0C-6E44-4A55-9B3C-0D6D5C6B7A10",
      }),
    });
    articles.push({
      id,
      url,
      host,
      title,
      saved: !historyOnly,
      archived,
      savedAt,
    });
  }
  // Texts: the newest articles have them, as the copies script made them.
  const newest = [...articles].sort((a, b) => b.savedAt - a.savedAt);
  for (const [rank, item] of newest.slice(0, profile.texts).entries()) {
    const words = 400 + Math.floor(next() * 4600);
    // The first screens' texts exist as files; the idle prefetch reads them.
    const html =
      rank < 48
        ? `<article><h1>${item.title}</h1>${Array.from(
            { length: Math.ceil(words / 40) },
            () => `<p>${sentence(next, 40)}</p>`,
          ).join("")}</article>`
        : undefined;
    const bytes = html ? new TextEncoder().encode(html) : undefined;
    records.content.push({
      key: `content/${item.id}`,
      value: sorted({
        url: item.url,
        file: bytes
          ? xxh64(bytes)
          : `xxh64:${(0xa0000000 + rank).toString(16).padStart(16, "0")}`,
        bytes: bytes?.byteLength ?? words * 6,
        words,
        format: "html",
        source: "file",
        savedAt: item.savedAt,
      }),
      html,
    });
  }
  const read = newest.slice(0, Math.max(10, profile.articles / 3));
  for (let index = 0; index < profile.highlights; index++) {
    const item = read[Math.floor(next() * next() * read.length)]!;
    const id = uuid(next);
    const at = swiftDate(item.savedAt + day);
    const note = next() < 0.15 ? sentence(next, 12) : "";
    records.annotations.push({
      key: `annotation/${id}`,
      value: sorted({
        articleURL: item.url,
        colour: ["yellow", "sage", "rose", "blue"][index % 4],
        createdAt: at,
        id,
        isHighlighted: true,
        note,
        quote: {
          exact: sentence(next, 20),
          prefix: sentence(next, 8),
          suffix: sentence(next, 8),
          start: index * 40,
        },
        updatedAt: at,
      }),
    });
  }
  for (let index = 0; index < profile.sessions; index++) {
    const item = read[Math.floor(next() * read.length)]!;
    const id = uuid(next);
    const startedAt = item.savedAt + next() * 20 * day;
    records.reading.push({
      key: `session/${id}`,
      value: JSON.stringify({
        articleURL: item.url,
        id,
        seconds: 30 + Math.round(next() * 900),
        startedAt: swiftDate(startedAt),
        updatedAt: swiftDate(startedAt + 600_000),
      }),
    });
  }
  return { records, articles: newest };
}

if (import.meta.main) {
  const [command, size] = process.argv.slice(2);
  if (command === "images") await serveImages();
  else if (command === "seed" && size && size in LAB_SIZES)
    await seed(size as LabSize);
  else {
    console.error("usage: first-sync-lab.ts images | seed small|medium|large");
    process.exit(64);
  }
}

/**
 * og:images and favicons, made once with ImageMagick: JPEGs of 60–160 kB,
 * as publishers serve them. Each answer waits LAB_IMAGE_MS (90) plus up to
 * as much again, a CDN's first byte; the browser's network emulation adds
 * the round trip and shares the bandwidth.
 */
async function serveImages() {
  mkdirSync(CACHE, { recursive: true });
  const made = await makeImages();
  const wait = Number(process.env.LAB_IMAGE_MS ?? 90);
  const sleep = (ms: number) => new Promise((go) => setTimeout(go, ms));
  Bun.serve({
    port: LAB_IMAGE_PORT,
    hostname: "127.0.0.1",
    async fetch(request) {
      const url = new URL(request.url);
      const [, family, kind, index] = url.pathname.split("/");
      const hash = createHash("sha1").update(url.pathname).digest()[0]!;
      await sleep(wait + (hash / 255) * wait);
      const headers = { "Cache-Control": "public, max-age=86400" };
      if (family === "favicon") {
        // One host in seven has no icon at that path.
        if (hash % 7 === 0) return new Response("Not found", { status: 404 });
        return new Response(Bun.file(made.favicons[parseInt(kind!) % 7]!), {
          headers: { ...headers, "Content-Type": "image/png" },
        });
      }
      const files = made.og[kind ?? ""];
      if (family !== "og" || !files)
        return new Response("Not found", { status: 404 });
      return new Response(Bun.file(files[Number(index) % files.length]!), {
        headers: { ...headers, "Content-Type": "image/jpeg" },
      });
    },
  });
  // Chromium resolves every *.localhost name to the loopback address.
  console.log(
    `First-sync lab images on http://<site>.localhost:${LAB_IMAGE_PORT} (${wait}–${2 * wait} ms each)`,
  );
}

async function makeImages() {
  const run = async (args: string[]) => {
    const child = Bun.spawn(["magick", ...args], { stderr: "pipe" });
    if ((await child.exited) !== 0)
      throw new Error(`magick: ${await new Response(child.stderr).text()}`);
  };
  const og: Record<string, string[]> = {};
  const jobs: (() => Promise<void>)[] = [];
  for (const { kind, width, height } of IMAGE_KINDS) {
    if (kind === "missing") continue;
    og[kind] = [];
    for (let index = 0; index < IMAGES_PER_KIND; index++) {
      const file = path.join(CACHE, `${kind}-${index}.jpg`);
      og[kind].push(file);
      if (existsSync(file)) continue;
      const hue = (index * 47 + kind.length * 31) % 360;
      jobs.push(() =>
        run([
          "-seed",
          String(index + kind.length * 100),
          "-size",
          `${width}x${height}`,
          `gradient:hsl(${hue},45%,62%)-hsl(${(hue + 50) % 360},40%,28%)`,
          "(",
          "-size",
          `${width}x${height}`,
          "plasma:fractal",
          "-blur",
          "0x6",
          ")",
          "-compose",
          "soft-light",
          "-composite",
          "-attenuate",
          "0.25",
          "+noise",
          "Gaussian",
          "-fill",
          "rgba(255,255,255,0.85)",
          "-pointsize",
          String(Math.round(Math.min(width, height) / 9)),
          "-gravity",
          "southwest",
          "-annotate",
          `+${Math.round(width / 16)}+${Math.round(height / 12)}`,
          `${kind === "icon" ? "" : "Story "}${index + 1}`,
          "-quality",
          "78",
          file,
        ]),
      );
    }
  }
  const favicons: string[] = [];
  for (let index = 0; index < 7; index++) {
    const file = path.join(CACHE, `favicon-${index}.png`);
    favicons.push(file);
    if (!existsSync(file))
      jobs.push(() =>
        run([
          "-size",
          "64x64",
          `xc:hsl(${index * 51},55%,45%)`,
          "-fill",
          "white",
          "-pointsize",
          "40",
          "-gravity",
          "center",
          "-annotate",
          "+0+0",
          String.fromCharCode(65 + index),
          file,
        ]),
      );
  }
  const work = async () => {
    for (let job = jobs.shift(); job; job = jobs.shift()) await job();
  };
  await Promise.all(Array.from({ length: 8 }, work));
  return { og, favicons };
}

/** Seeds one account, unless it already has records, straight to the lab API. */
async function seed(size: LabSize) {
  const account = labAccount(size);
  const headers = { Origin: LAB_APP, "Content-Type": "application/json" };
  await fetch(`${LAB_API}/__lab`, {
    method: "POST",
    body: JSON.stringify({ d1Ms: 0, r2Ms: 0 }),
  });
  let auth = await fetch(`${LAB_API}/api/auth/sign-in/email`, {
    method: "POST",
    headers,
    body: JSON.stringify(account),
  });
  if (!auth.ok)
    auth = await fetch(`${LAB_API}/api/auth/sign-up/email`, {
      method: "POST",
      headers,
      body: JSON.stringify(account),
    });
  if (!auth.ok)
    throw new Error(`Sign-in failed: ${auth.status} ${await auth.text()}`);
  const cookie = auth.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const base = { Origin: LAB_APP, Cookie: cookie };
  const scope = async (namespace: string) =>
    JSON.stringify(
      await (
        await fetch(`${LAB_API}/api/apps/${namespace}/sync/v3/state`, {
          headers: base,
        })
      ).json(),
    );
  const existing = await (
    await fetch(
      `${LAB_API}/api/apps/arctic/sync/v3/pull?cursor=0&limit=1&excludeOwnDevice=false`,
      {
        headers: {
          ...base,
          "X-Sync-Scope": await scope("arctic"),
          "X-Device-ID": "lab-iphone",
        },
      },
    )
  ).json();
  if (existing.records?.length > 0) {
    console.log(`${account.email} already has records; nothing to seed.`);
    return;
  }
  const { records } = labLibrary(size);
  let wallTimeMs = Date.now() - 400 * 86_400_000;
  const push = async (
    namespace: string,
    rows: { key: string; value: string }[],
  ) => {
    const changes = rows.map((row) => ({
      key: row.key,
      value: row.value,
      isDeleted: false,
      schemaVersion: 1,
      hlc: { wallTimeMs: (wallTimeMs += 1000), counter: 0 },
    }));
    for (let start = 0; start < changes.length; start += 250) {
      const response = await fetch(
        `${LAB_API}/api/apps/${namespace}/sync/v3/push`,
        {
          method: "POST",
          headers: {
            ...headers,
            Cookie: cookie,
            "X-Device-ID": "lab-iphone",
            "X-Sync-Scope": await scope(namespace),
          },
          body: JSON.stringify({ changes: changes.slice(start, start + 250) }),
        },
      );
      if (!response.ok)
        throw new Error(
          `Push failed: ${response.status} ${await response.text()}`,
        );
    }
  };
  const contentScope = await scope("arctic-content");
  for (const row of records.content) {
    if (!row.html) continue;
    const bytes = new TextEncoder().encode(row.html);
    const file = JSON.parse(row.value).file as string;
    const response = await fetch(
      `${LAB_API}/api/apps/arctic-content/files/${file}`,
      {
        method: "PUT",
        headers: {
          ...base,
          "X-Sync-Scope": contentScope,
          "Content-Type": "text/html; charset=utf-8",
        },
        body: bytes,
      },
    );
    if (!response.ok) throw new Error(`Upload failed: ${response.status}`);
  }
  // The phone's first upload sent each family sorted by key, so the
  // newest articles' records arrive anywhere in the pull.
  const byKey = (rows: { key: string; value: string }[]) =>
    [...rows].sort((a, b) => (a.key < b.key ? -1 : 1));
  await push("arctic", [
    ...byKey(records.article),
    ...byKey(records.library),
    ...byKey(records.tags),
  ]);
  await push(
    "arctic-content",
    records.content.map(({ key, value }) => ({ key, value })),
  );
  await push("arctic-annotations", records.annotations);
  await push("arctic-reading", records.reading);
  const total = Object.values(records).reduce(
    (sum, list) => sum + list.length,
    0,
  );
  console.log(
    `Seeded ${account.email}: ${total} records (${records.article.length} articles, ` +
      `${records.content.length} texts, ${records.annotations.length} highlights, ` +
      `${records.reading.length} sessions).`,
  );
}
