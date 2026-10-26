/**
 * Collects article text that this computer already has, as files for the web
 * app's Article text page (`/copies`, "From files"). Reads every source and
 * changes none. The output holds personal article text: keep it private.
 *
 *   bun scripts/copies.ts <folder> [--native <dir>]... [--extract] [--unwall] [--limit <n>]
 *
 * --native   An Arctic data folder: the Mac app's container (the default), or
 *            a copy of the iPhone app's folder (see README). Its offline copies
 *            in Downloads/<id>.html are matched to URLs through links.json and
 *            the profile journals.
 * --extract  Also download saved articles that have no copy, with the same
 *            Defuddle extraction as the app (server/extractor.ts). Paywalled
 *            pages give previews; the web app refuses copies under 120 words.
 * --unwall   Also read saved articles on the phone's Unwall list through
 *            unwall.app in a headless browser, as the phone opens them.
 *
 * Pages that already have text in the account (in the mirror) are skipped.
 *
 * Saved articles come from the Workbench Backup mirror (ARCTIC_BACKUP_DIR).
 */
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseHTML } from "linkedom";
import { chromium } from "playwright";
import { Extractor, fromHTML } from "../server/extractor";
import { onUnwallList, readThroughUnwall, UNWALL_MIN_WORDS } from "./text";

const args = process.argv.slice(2);
const output = args.find(
  (arg, index) =>
    !arg.startsWith("--") &&
    !args[index - 1]?.startsWith("--native") &&
    !args[index - 1]?.startsWith("--limit"),
);
if (!output) {
  console.error(
    "Usage: bun scripts/copies.ts <folder> [--native <dir>]... [--extract] [--unwall] [--limit <n>]",
  );
  process.exit(2);
}
const natives = args.flatMap((arg, index) =>
  arg === "--native" ? [args[index + 1]!] : [],
);
if (natives.length === 0)
  natives.push(
    join(
      homedir(),
      "Library/Containers/com.zsheng.ArcticMac/Data/Library/Application Support/ArticleReader",
    ),
  );
const limit = Number(args[args.indexOf("--limit") + 1]) || Infinity;
const backup =
  process.env.ARCTIC_BACKUP_DIR ??
  join(homedir(), "Library/Application Support/Workbench Backup");

/** As the app compares pages: no fragment, lower-case host, no trailing slash. */
function pageKey(value: string) {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host.toLowerCase()}${url.pathname.replace(/\/+$/, "")}${url.search}`;
  } catch {
    return value;
  }
}

/** Saved articles from the account mirror, by page. */
function savedArticles() {
  const path = join(backup, "mirror.sqlite");
  if (!existsSync(path)) return new Map<string, string>();
  const db = new Database(path, { readonly: true });
  try {
    const rows = db
      .query<{ key: string; value: string }, []>(
        "SELECT key,value FROM records WHERE namespace='arctic' AND is_deleted=0 AND (key LIKE 'article/%' OR key LIKE 'library/%')",
      )
      .all();
    const urls = new Map<string, string>();
    const saved = new Set<string>();
    for (const { key, value } of rows) {
      const [family, id] = key.split("/");
      const record = JSON.parse(value);
      if (family === "article") urls.set(id!, record.url);
      else if (record.saved) saved.add(id!);
    }
    return new Map(
      [...saved].flatMap((id) =>
        urls.has(id) ? [[pageKey(urls.get(id)!), urls.get(id)!]] : [],
      ),
    );
  } finally {
    db.close();
  }
}

/** Pages that already have text in the account, from the mirror's arctic-content records. */
function pagesWithText() {
  const path = join(backup, "mirror.sqlite");
  if (!existsSync(path)) return new Set<string>();
  const db = new Database(path, { readonly: true });
  try {
    return new Set(
      db
        .query<{ value: string }, []>(
          "SELECT value FROM records WHERE namespace='arctic-content' AND is_deleted=0 AND key LIKE 'content/%'",
        )
        .all()
        .map(({ value }) => pageKey(JSON.parse(value).url)),
    );
  } finally {
    db.close();
  }
}

/** Offline copy IDs to URLs: links.json, then every profile journal's device state. */
async function nativeURLs(folder: string) {
  const ids = new Map<string, string>();
  try {
    for (const article of JSON.parse(
      await readFile(join(folder, "links.json"), "utf8"),
    ))
      if (article.id && article.url)
        ids.set(String(article.id).toUpperCase(), article.url);
  } catch {
    /* No legacy library. */
  }
  const profiles = join(folder, "Library");
  for (const profile of existsSync(profiles) ? await readdir(profiles) : []) {
    const journal = join(profiles, profile, "journal.sqlite");
    if (!existsSync(journal)) continue;
    const db = new Database(journal, { readonly: true });
    try {
      for (const { value } of db
        .query<{ value: string }, []>("SELECT value FROM local_values")
        .all()) {
        const state = JSON.parse(value);
        if (state.id && state.url)
          ids.set(String(state.id).toUpperCase(), state.url);
      }
    } catch {
      /* An older journal without device state. */
    } finally {
      db.close();
    }
  }
  return ids;
}

const escape = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
async function write(
  url: string,
  body: string,
  byline: string,
  source: string,
) {
  const name = createHash("sha256")
    .update(pageKey(url))
    .digest("hex")
    .slice(0, 20);
  await writeFile(
    join(output!, `${name}.html`),
    `<!doctype html><meta charset="utf-8">\n<article data-arctic-url="${escape(url)}" data-arctic-byline="${escape(byline)}" data-arctic-source="${source}">\n${body}\n</article>\n`,
    { mode: 0o600 },
  );
}

await mkdir(output, { recursive: true, mode: 0o700 });
const saved = savedArticles();
const done = pagesWithText();
const before = done.size;
let native = 0;
for (const folder of natives) {
  const ids = await nativeURLs(folder);
  const downloads = join(folder, "Downloads");
  for (const file of existsSync(downloads) ? await readdir(downloads) : []) {
    const url = ids.get(file.replace(/\.html$/i, "").toUpperCase());
    if (!url || done.has(pageKey(url))) continue;
    const { document } = parseHTML(
      await readFile(join(downloads, file), "utf8"),
    );
    const content = document.querySelector("#reader-content");
    if (!content || (content.textContent ?? "").trim().length < 400) continue;
    // The app removes the date that native bylines run into the author.
    const byline = (
      document.querySelector(".byline")?.textContent ?? ""
    ).trim();
    await write(url, content.innerHTML, byline, "arctic");
    done.add(pageKey(url));
    native++;
  }
}
console.log(
  `${native} offline copies from Arctic; ${saved.size} saved articles in the mirror, ${before} with text.`,
);

if (args.includes("--extract")) {
  const extractor = new Extractor();
  const queue = [...saved].filter(([key]) => !done.has(key)).slice(0, limit);
  let extracted = 0;
  let failed = 0;
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const [, url] = next;
      try {
        const result = await extractor.extract(url);
        if (result.wordCount < 120)
          throw new Error(`${result.wordCount} words`);
        await write(url, result.html, result.author, "extractor");
        extracted++;
      } catch (error) {
        failed++;
        console.log(
          `  ${new URL(url).hostname}: ${error instanceof Error ? error.message : error}`,
        );
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  await extractor.close();
  console.log(
    `${extracted} extracted; ${failed} could not be read without a browser session.`,
  );
}

if (args.includes("--unwall")) {
  // As the phone routes links (Sources/ArticleBrowser.swift): listed hosts open through unwall.app.
  const queue: [string, string][] = [];
  for (const [key, url] of saved)
    if (!done.has(key) && (await onUnwallList(url))) queue.push([key, url]);
  queue.splice(limit);
  const browser = await chromium.launch();
  let read = 0;
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const [key, url] = next;
      try {
        const html = await readThroughUnwall(browser, url);
        const result = fromHTML(html || "<html></html>", url);
        if (result.wordCount < UNWALL_MIN_WORDS)
          throw new Error(`${result.wordCount} words`);
        await write(url, result.content, result.author, "extractor");
        done.add(key);
        read++;
      } catch (error) {
        console.log(
          `  ${new URL(url).hostname} (Unwall): ${error instanceof Error ? error.message.split("\n")[0] : error}`,
        );
      }
    }
  };
  await Promise.all([worker(), worker()]);
  await browser.close();
  console.log(`${read} read through Unwall.`);
}
