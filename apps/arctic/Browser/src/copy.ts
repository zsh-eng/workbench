import { cleanArticle, cleanByline, countWords } from "./content";
import type { Article, Copy } from "./articles";
import { encodeSorted } from "./sync/swift";
import type { Session } from "./sync/session";

/** A page shorter than this is usually a teaser, a login wall or an error. */
export const MIN_WORDS = 120;
/** The server refuses larger text files. */
export const MAX_COPY_BYTES = 2 * 1024 * 1024;

export type Source = "file" | "browser" | "arctic" | "extractor";

/**
 * The record `content/<id>` that names a copy's file, as every writer of
 * article text writes it: this app, scripts/upload.ts and `wb arctic`.
 */
export function copyRecord(
  article: Pick<Article, "id" | "url">,
  copy: {
    file: string;
    bytes: number;
    words: number;
    byline?: string;
    source: Source;
  },
) {
  return {
    key: `content/${article.id}`,
    value: encodeSorted({
      url: article.url,
      file: copy.file,
      bytes: copy.bytes,
      words: copy.words,
      ...(copy.byline ? { byline: copy.byline } : {}),
      format: "html",
      source: copy.source,
      savedAt: Date.now(),
    }),
  };
}

/**
 * Saves the text of an article to the account: the cleaned HTML as a file in
 * `arctic-content`, then the record `content/<id>` that names it.
 */
export async function saveCopy(
  session: Session,
  article: Article,
  body: string,
  details: { byline?: string; source: Source },
) {
  const html = cleanArticle(body, article.url);
  const words = countWords(html);
  if (words < MIN_WORDS)
    throw new Error(`Only ${words} words: this looks like a preview.`);
  const file = await session.uploadFile(html);
  await session.copies.write([
    copyRecord(article, {
      file: file.id,
      bytes: file.bytes,
      words,
      byline: cleanByline(details.byline),
      source: details.source,
    }),
  ]);
  session.syncSoon(400);
  return words;
}

/** A new copy replaces one only when it is clearly longer, such as a full text after a preview. */
export const better = (
  article: { copy?: Pick<Copy, "words"> },
  words: number,
) => !article.copy || words > article.copy.words * 1.3;

/**
 * Why a cleaned copy is not uploaded, by the rules of the Article text page,
 * or undefined when it is: too short, not longer than the copy that the
 * account has, too large, or with a script.
 */
export function copyProblem(
  article: { copy?: Pick<Copy, "words"> },
  html: string,
  words: number,
) {
  if (words < MIN_WORDS) return `under ${MIN_WORDS} words`;
  if (!better(article, words)) return "has a longer copy";
  if (new TextEncoder().encode(html).byteLength > MAX_COPY_BYTES)
    return "larger than 2 MiB";
  if (/<script\b/i.test(html)) return "contains a script";
  return undefined;
}

/** Same page: scheme and host in lower case, no fragment, no default port, no trailing slash. */
function pageKey(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    return `${url.protocol}//${url.host.toLowerCase()}${url.pathname.replace(/\/+$/, "")}${url.search}`;
  } catch {
    return value;
  }
}

/**
 * Finds the article for a page. Pages match exactly first. Then the host
 * without "www." and the path match, when one article alone has that path:
 * copies often carry tracking queries that the saved link does not.
 */
export function articleFinder(articles: Article[]) {
  const exact = new Map(
    articles.map((article) => [pageKey(article.url), article]),
  );
  const loose = new Map<string, Article | null>();
  for (const article of articles) {
    const key = looseKey(article.url);
    if (key) loose.set(key, loose.has(key) ? null : article);
  }
  return (url: string) => {
    const key = looseKey(url);
    return (
      exact.get(pageKey(url)) ?? (key ? loose.get(key) : undefined) ?? undefined
    );
  };
}

function looseKey(value: string) {
  try {
    const url = new URL(value);
    const path = url.pathname.replace(/\/+$/, "");
    return path.length > 1
      ? `${url.hostname.toLowerCase().replace(/^www\./, "")}${path}`
      : "";
  } catch {
    return "";
  }
}
