/**
 * Uploads article text copies from a folder to the account, as the web app's
 * Article text page does, with the Workbench Backup credential (`wb auth
 * login`). That credential may write Arctic article text and nothing else.
 *
 *   bun scripts/upload.ts <folder> [--dry-run] [--origin <url>]
 *
 * Files are those that `scripts/copies.ts` writes. Each must belong to a saved
 * article. A copy under 120 words, larger than 2 MiB, or with a script is
 * refused; a new copy replaces one only when it is 30% longer. WORKBENCH_TOKEN
 * replaces the Keychain credential, for a local API.
 */
import {
  syncPullResponseSchema,
  syncPushResponseSchema,
  type SyncRecord,
} from "@zsh-eng/local-sync";
import { parseHTML } from "linkedom";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Article } from "../src/articles";
import { cleanByline, tidyArticle } from "../src/content";
import {
  articleFinder,
  copyProblem,
  copyRecord,
  type Source,
} from "../src/copy";
import { xxh64 } from "../src/sync/xxh64";

const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
};
const folder = args.find(
  (arg, index) => !arg.startsWith("--") && args[index - 1] !== "--origin",
);
if (!folder) {
  console.error(
    "Usage: bun scripts/upload.ts <folder> [--dry-run] [--origin <url>]",
  );
  process.exit(2);
}
const dryRun = args.includes("--dry-run");
const origin = new URL(option("--origin") ?? "https://api.zsheng.app").origin;
const DEVICE = "wb-arctic-upload";

/** The Workbench Backup credential, as `wb` stores it. It is never printed. */
function credential() {
  if (process.env.WORKBENCH_TOKEN) return process.env.WORKBENCH_TOKEN;
  const account = createHash("sha256").update(origin).digest("hex");
  const found = Bun.spawnSync(
    [
      "/usr/bin/security",
      "find-generic-password",
      "-s",
      "workbench-backup",
      "-a",
      account,
      "-w",
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (found.exitCode !== 0)
    throw new Error(`No Workbench Backup credential for ${origin}.`);
  return found.stdout.toString().trim();
}
const token = credential();

async function send(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(origin + path, {
      ...init,
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(60_000),
    });
    if (attempt < 3 && (response.status === 429 || response.status >= 500)) {
      await response.body?.cancel();
      await Bun.sleep(1000 * 2 ** attempt);
      continue;
    }
    if (!response.ok)
      throw new Error(
        `${init.method ?? "GET"} ${path}: ${response.status} ${await response.text()}`,
      );
    return response;
  }
}

async function namespace(name: string) {
  const scope = JSON.stringify(
    await (await send(`/api/apps/${name}/sync/v3/state`)).json(),
  );
  const headers = { "X-Device-ID": DEVICE, "X-Sync-Scope": scope };
  return {
    headers,
    async records() {
      const records = new Map<string, SyncRecord>();
      for (let cursor = 0; ; ) {
        const page = syncPullResponseSchema.parse(
          await (
            await send(
              `/api/apps/${name}/sync/v3/pull?cursor=${cursor}&limit=500&excludeOwnDevice=false`,
              { headers },
            )
          ).json(),
        );
        for (const record of page.records) records.set(record.key, record);
        if (!page.hasMore) return records;
        cursor = page.cursor;
      }
    },
  };
}

const live = (record: SyncRecord | undefined) =>
  record && !record.isDeleted
    ? (JSON.parse(record.value) as Record<string, unknown>)
    : undefined;

// The library: articles whose phone records are live, with their copies.
const arctic = await (await namespace("arctic")).records();
const content = await namespace("arctic-content");
const copies = await content.records();
const articles: Article[] = [];
for (const [key, record] of arctic) {
  if (!key.startsWith("article/")) continue;
  const id = key.slice("article/".length);
  const metadata = live(record);
  if (typeof metadata?.url !== "string" || !live(arctic.get(`library/${id}`)))
    continue;
  const copy = live(copies.get(`content/${id}`));
  articles.push({
    id,
    url: metadata.url,
    copy: copy ? { words: Number(copy.words) || 0 } : undefined,
  } as Article);
}
const find = articleFinder(articles);

const tally = new Map<string, number>();
const count = (outcome: string) =>
  tally.set(outcome, (tally.get(outcome) ?? 0) + 1);
const uploads: {
  article: Article;
  html: string;
  words: number;
  byline?: string;
  source: Source;
}[] = [];
const chosen = new Set<string>();
for (const name of (await readdir(folder)).sort()) {
  if (!/\.html?$/i.test(name)) continue;
  const { document } = parseHTML(await readFile(join(folder, name), "utf8"));
  const root = document.querySelector("article[data-arctic-url]");
  const article = root && find(root.getAttribute("data-arctic-url")!);
  if (!root || !article) {
    count("no article in the library");
    continue;
  }
  if (chosen.has(article.id)) {
    count("another file has this article");
    continue;
  }
  tidyArticle(root, article.url);
  const html = root.innerHTML.trim();
  const words = (root.textContent ?? "").split(/\s+/).filter(Boolean).length;
  const problem = copyProblem(article, html, words);
  if (problem) count(problem);
  else {
    chosen.add(article.id);
    const source = root.getAttribute("data-arctic-source");
    uploads.push({
      article,
      html,
      words,
      byline: cleanByline(root.getAttribute("data-arctic-byline") ?? ""),
      source: source === "arctic" || source === "extractor" ? source : "file",
    });
  }
}

console.log(
  `${articles.length} articles in the library, ${copies.size} copy records.`,
);
for (const [outcome, number] of tally) console.log(`  ${number} ${outcome}`);
console.log(
  `${uploads.length} copies to upload (${(
    uploads.reduce((sum, item) => sum + item.html.length, 0) /
    1024 /
    1024
  ).toFixed(1)} MB).`,
);
if (dryRun || uploads.length === 0) process.exit(0);

// Files first, then the records that name them, so no record names a missing file.
const changes: {
  key: string;
  value: string;
  isDeleted: false;
  schemaVersion: 1;
  hlc: { wallTimeMs: number; counter: number };
}[] = [];
const wallTimeMs = Date.now();
let next = 0;
const worker = async () => {
  for (let index = next++; index < uploads.length; index = next++) {
    const item = uploads[index]!;
    const bytes = new TextEncoder().encode(item.html);
    const file = xxh64(bytes);
    try {
      await send(`/api/apps/arctic-content/files/${file}`, {
        method: "PUT",
        body: bytes,
        headers: {
          ...content.headers,
          "Content-Type": "text/html; charset=utf-8",
        },
      });
    } catch (error) {
      console.log(
        `  ${new URL(item.article.url).hostname}: ${error instanceof Error ? error.message.slice(0, 120) : error}`,
      );
      continue;
    }
    changes.push({
      ...copyRecord(item.article, {
        file,
        bytes: bytes.byteLength,
        words: item.words,
        byline: item.byline,
        source: item.source,
      }),
      isDeleted: false,
      schemaVersion: 1,
      hlc: { wallTimeMs, counter: index },
    });
  }
};
await Promise.all([worker(), worker(), worker(), worker()]);

for (let start = 0; start < changes.length; start += 200) {
  syncPushResponseSchema.parse(
    await (
      await send("/api/apps/arctic-content/sync/v3/push", {
        method: "POST",
        headers: { ...content.headers, "Content-Type": "application/json" },
        body: JSON.stringify({ changes: changes.slice(start, start + 200) }),
      })
    ).json(),
  );
}
console.log(`Uploaded ${changes.length} copies to ${origin}.`);
