/** Read-only snapshot: never writes to Chrome, the backup or the native Arctic store. */
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { parseHTML } from "linkedom";
import type { Article } from "../src/model";
const native =
  process.env.ARCTIC_NATIVE_DATA ??
  join(
    homedir(),
    "Library/Containers/com.zsheng.ArcticMac/Data/Library/Application Support/ArticleReader",
  );
const chrome =
  process.argv[2] ??
  join(homedir(), "Downloads/Takeout/Chrome/Reading List.html");
const backup = join(
  process.env.ARCTIC_BACKUP_DIR ??
    join(homedir(), "Library/Application Support/Workbench Backup"),
  "mirror.sqlite",
);
const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");
// Native Arctic keeps its local profile at Library/<sha256("local")>/journal.sqlite.
const localProfile = join(native, "Library", sha256("local"), "journal.sqlite");
const output = resolve(import.meta.dirname, "../public/seed");

/** One Arctic library entry, from synced records or the old links.json. */
type NativeArticle = {
  url: string;
  title: string;
  subtitle: string;
  tags: string[];
  archived: boolean;
  favourite: boolean;
  savedAt: number;
  image?: string;
  /** Names the native offline copy in Downloads/<id>.html. */
  localID?: string;
};
// Swift dates count seconds from 1 January 2001.
const swiftDate = (seconds?: number) =>
  seconds === undefined ? 0 : (seconds + 978307200) * 1000;
const canonical = (url: string) => {
  const value = new URL(url);
  value.hash = "";
  return value.href;
};

/** Saved articles from Arctic sync records: a native profile journal or the
 * Workbench Backup mirror. Both store article/, library/ and tags/ records. */
function readRecords(path: string): NativeArticle[] {
  const db = new Database(path, { readonly: true });
  try {
    const columns = db
      .query<{ name: string }, []>("PRAGMA table_info(records)")
      .all()
      .map((column) => column.name);
    const mirror = columns.includes("namespace");
    const rows = db
      .query<{ key: string; value: string }, []>(
        mirror
          ? "SELECT key,value FROM records WHERE namespace='arctic' AND is_deleted=0"
          : "SELECT key,value FROM records WHERE deleted=0",
      )
      .all();
    const families = new Map<string, Record<string, any>>();
    for (const { key, value } of rows) {
      const [family, id] = key.split("/");
      if (!family || !id) continue;
      const entry = families.get(id) ?? {};
      entry[family] = JSON.parse(value);
      families.set(id, entry);
    }
    const local = new Map<string, { id?: string }>();
    if (!mirror)
      for (const { key, value } of db
        .query<{ key: string; value: string }, []>(
          "SELECT key,value FROM local_values",
        )
        .all())
        local.set(key, JSON.parse(value));
    return [...families].flatMap(([id, { article, library, tags }]) =>
      article && library?.saved
        ? [
            {
              url: article.url,
              title: article.title,
              subtitle: article.subtitle ?? "",
              tags: tags?.names ?? [],
              archived: !!library.archived,
              favourite: library.favourite === true,
              savedAt: swiftDate(library.savedAt),
              image: article.imageURL,
              localID: local.get(id)?.id,
            },
          ]
        : [],
    );
  } finally {
    db.close();
  }
}

async function readLinks(): Promise<any[]> {
  try {
    return JSON.parse(await readFile(join(native, "links.json"), "utf8"));
  } catch {
    return [];
  }
}

/** Native offline copies, by canonical URL. */
async function nativeIDs(): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const article of await readLinks())
    if (article.id) ids.set(canonical(article.url), article.id);
  if (existsSync(localProfile)) {
    const db = new Database(localProfile, { readonly: true });
    for (const { value } of db
      .query<{ value: string }, []>("SELECT value FROM local_values")
      .all()) {
      const state = JSON.parse(value);
      if (state.url && state.id) ids.set(canonical(state.url), state.id);
    }
    db.close();
  }
  return ids;
}

const explicit = process.env.ARCTIC_RECORDS;
let source = "";
let library: NativeArticle[] = [];
for (const [name, path] of [
  ["records", explicit],
  ["Workbench Backup", existsSync(backup) ? backup : undefined],
  ["native library", existsSync(localProfile) ? localProfile : undefined],
] as const) {
  if (!path) continue;
  library = readRecords(path);
  if (library.length || name === "records") {
    source = name === "records" ? path! : name;
    break;
  }
}
if (!library.length) {
  library = (await readLinks())
    .filter((article) => article.isSaved !== false)
    .map((article) => ({
      url: article.url,
      title: article.title,
      subtitle: article.subtitle ?? "",
      tags: article.tags ?? [],
      archived: article.isArchived === true,
      favourite: article.isFavourite === true,
      savedAt: swiftDate(article.savedAt),
      image: article.imageURL,
      localID: article.id,
    }));
  if (library.length) source = "native links.json";
}
const offline = await nativeIDs();
// The extraction service's parser. It runs no scripts and loads nothing.
const parse = (html: string) => parseHTML(html).document;
// Starter tags are local, deterministic suggestions; users can edit every tag.
const topics: [string, RegExp][] = [
  [
    "Artificial intelligence",
    /\b(ai|llm|gpt|agent|neural|machine learning|deep learning|language model|anthropic|pytorch)\b/i,
  ],
  [
    "Software",
    /\b(code|program|software|react|database|distributed|compiler|rust|javascript|typescript|engineer|linux|simd|gpu|cpu|github)\b/i,
  ],
  [
    "Design",
    /\b(design|interface|typograph|animation|figma|css|frontend|ux)\b/i,
  ],
  [
    "Culture",
    /\b(culture|art|book|fiction|writing|music|history|language|film|society|china)\b/i,
  ],
  [
    "Science",
    /\b(science|physics|space|biology|quantum|chip|lithography|asml|energy|math)\b/i,
  ],
  [
    "Life & ideas",
    /\b(life|friend|mind|think|learn|memory|philosophy|productivity|habit|happiness|forget)\b/i,
  ],
];
// Arctic's library is authoritative. Chrome seeds only a profile without one,
// so a link removed in Arctic does not come back.
if (!library.length) {
  const links = await readLinks();
  const byURL = new Map(links.map((a) => [a.url, a]));
  const anchors = [
    ...parse(await readFile(chrome, "utf8")).querySelectorAll("a[href]"),
  ];
  for (const anchor of anchors) {
    const url = anchor.getAttribute("href")!;
    const original = byURL.get(url);
    const title = original?.title || anchor.textContent || url;
    const subtitle = original?.subtitle || "";
    library.push({
      url,
      title,
      subtitle,
      tags: original?.tags?.length
        ? original.tags
        : topics
            .filter(([, test]) => test.test(`${title} ${subtitle}`))
            .map(([name]) => name)
            .slice(0, 2),
      archived: false,
      favourite: false,
      savedAt: Number(anchor.getAttribute("add_date") || 0) * 1000,
      localID: original?.id,
    });
  }
  source = "Chrome Reading List";
}
await mkdir(join(output, "bodies"), { recursive: true });
const articles: Article[] = [];
const seen = new Set<string>();
for (const entry of library) {
  const url = entry.url;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    continue;
  }
  if (
    !["https:", "http:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    seen.has(url)
  )
    continue;
  seen.add(url);
  const id = sha256(url).slice(0, 20);
  let title = entry.title;
  let description = entry.subtitle;
  let author = "";
  let bodyPath: string | undefined;
  let image = entry.image;
  let minutes: number | undefined;
  const localID = entry.localID ?? offline.get(canonical(url));
  if (localID && /^[\da-f-]+$/i.test(localID)) {
    try {
      const doc = parse(
        await readFile(join(native, "Downloads", `${localID}.html`), "utf8"),
      );
      const content = doc.querySelector("#reader-content");
      author = (doc.querySelector(".byline")?.textContent?.trim() || "")
        .replace(
          /\s*\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}.*$/i,
          "",
        )
        .replace(/\s*[·•]\s*\d+\s*min.*$/i, "")
        .trim();
      description ||= doc.querySelector(".subtitle")?.textContent?.trim() || "";
      // As a native visit does, the cached copy names an article saved with its host only.
      if (!title || title === parsed.hostname)
        title = doc.querySelector("h1")?.textContent?.trim() || title;
      if (content?.textContent && content.textContent.length > 100) {
        image ||=
          doc.querySelector("figure.hero img")?.getAttribute("src") ||
          undefined;
        // Only the extracted content is copied; native styles and scripts are excluded.
        await writeFile(
          join(output, "bodies", `${id}.html`),
          content.innerHTML,
        );
        bodyPath = `/seed/bodies/${id}.html`;
        minutes = Math.max(
          1,
          Math.ceil(content.textContent.split(/\s+/).length / 230),
        );
      }
    } catch {
      /* Not downloaded in native Arctic. */
    }
  }
  articles.push({
    id,
    url,
    title: title || parsed.hostname,
    description,
    author,
    tags: entry.tags,
    savedAt: entry.savedAt,
    saved: true,
    archived: entry.archived,
    favourite: entry.favourite,
    bodyPath,
    image,
    minutes,
  });
}
// Start the design review with complete articles; dates remain unchanged.
articles.sort(
  (a, b) =>
    Number(!!b.bodyPath) - Number(!!a.bodyPath) || b.savedAt - a.savedAt,
);
const lead = articles.findIndex(
  (a) => a.url.includes("worksinprogress.co") && a.bodyPath,
);
if (lead > 0) articles.unshift(...articles.splice(lead, 1));
await writeFile(
  join(output, "index.json"),
  JSON.stringify({ version: 1, articles, annotations: [] }),
);
console.log(
  `Seeded ${articles.length} articles from ${source || "nothing"}; ${articles.filter((a) => a.bodyPath).length} full cached bodies. Personal data is gitignored.`,
);
