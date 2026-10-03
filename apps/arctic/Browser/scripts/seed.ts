/** Read-only snapshot: never writes to Chrome or the native Arctic store. */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { Window } from "happy-dom";
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
const output = resolve(import.meta.dirname, "../public/seed");
const window = new Window({
  settings: {
    disableJavaScriptEvaluation: true,
    disableJavaScriptFileLoading: true,
    disableCSSFileLoading: true,
    disableIframePageLoading: true,
  },
});
const parse = (html: string) =>
  new window.DOMParser().parseFromString(html, "text/html");
const entries = [
  ...parse(await readFile(chrome, "utf8")).querySelectorAll("a[href]"),
];
let records: any[] = [];
try {
  records = JSON.parse(await readFile(join(native, "links.json"), "utf8"));
} catch {
  console.log("No native cache; importing Chrome metadata only.");
}
const byURL = new Map(records.map((a) => [a.url, a]));
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
await mkdir(join(output, "bodies"), { recursive: true });
const articles: Article[] = [];
const seen = new Set<string>();
for (const anchor of entries) {
  const url = anchor.getAttribute("href")!;
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
  const original = byURL.get(url);
  const id = createHash("sha256").update(url).digest("hex").slice(0, 20);
  const title = original?.title || anchor.textContent || parsed.hostname;
  let description = original?.subtitle || "";
  let author = "";
  let bodyPath: string | undefined;
  let image: string | undefined;
  let minutes: number | undefined;
  if (original?.id && /^[\da-f-]+$/i.test(original.id)) {
    try {
      const doc = parse(
        await readFile(
          join(native, "Downloads", `${original.id}.html`),
          "utf8",
        ),
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
      if (content?.textContent && content.textContent.length > 100) {
        image =
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
  const tags = original?.tags?.length
    ? original.tags
    : topics
        .filter(([, test]) => test.test(`${title} ${description}`))
        .map(([name]) => name)
        .slice(0, 2);
  articles.push({
    id,
    url,
    title,
    description,
    author,
    tags,
    savedAt: Number(anchor.getAttribute("add_date") || 0) * 1000,
    saved: true,
    archived: false,
    favourite: false,
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
  `Seeded ${articles.length} Chrome articles; ${articles.filter((a) => a.bodyPath).length} full cached bodies. Personal data is gitignored.`,
);
await window.happyDOM.close();
