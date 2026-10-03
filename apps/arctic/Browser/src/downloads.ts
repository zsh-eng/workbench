import type { Article, DownloadedBody } from "./model";
import { readDownloadedBody, saveDownloadedBody } from "./store";
import { cleanArticle } from "./content";
const pending = new Map<string, Promise<DownloadedBody>>();

export async function downloadArticle(
  article: Pick<Article, "id" | "url">,
): Promise<DownloadedBody> {
  const cached = await readDownloadedBody(article.id);
  if (cached) return cached;
  const existing = pending.get(article.id);
  if (existing) return existing;
  const work = (async () => {
    let response: Response | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        response = await fetch("/api/extract", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Arctic-Request": "1",
          },
          body: JSON.stringify({ url: article.url }),
          signal: AbortSignal.timeout(60000),
        });
        if (response.status < 500 || attempt === 1) break;
      } catch (error) {
        if (attempt === 1)
          throw new Error(
            "The download service is unavailable. Try again shortly.",
            { cause: error },
          );
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (!response) throw new Error("The download service is unavailable.");
    const result = await response.json().catch(() => ({
      error: "The download service is unavailable. Try again shortly.",
    }));
    if (!response.ok)
      throw new Error(result.error || "The article could not be downloaded.");
    if (
      typeof result.html !== "string" ||
      result.html.length > 4 * 1024 * 1024 ||
      typeof result.url !== "string" ||
      !/^https?:\/\//.test(result.url)
    )
      throw new Error("The download service returned an invalid article.");
    const body: DownloadedBody = {
      html: cleanArticle(result.html, result.url),
      url: result.url,
      downloadedAt: Date.now(),
      title: typeof result.title === "string" ? result.title : "",
      description:
        typeof result.description === "string" ? result.description : "",
      author: typeof result.author === "string" ? result.author : "",
      image:
        typeof result.image === "string" && /^https?:\/\//.test(result.image)
          ? result.image
          : undefined,
      wordCount: Number.isFinite(result.wordCount) ? result.wordCount : 0,
    };
    await saveDownloadedBody(article.id, body);
    return body;
  })();
  pending.set(article.id, work);
  try {
    return await work;
  } finally {
    pending.delete(article.id);
  }
}
export function prepareDownload(article: Article) {
  if (!article.bodyPath)
    void downloadArticle(article).catch(() => {
      /* Opening retries and shows a recoverable error. Saving remains local. */
    });
}
export async function loadArticleBody(
  article: Pick<Article, "id" | "url" | "bodyPath">,
  signal: AbortSignal,
) {
  if (!article.bodyPath) return (await downloadArticle(article)).html;
  const response = await fetch(article.bodyPath, { signal });
  if (!response.ok) throw new Error("The saved article could not be loaded.");
  const source = await response.text();
  if (source.includes("/src/main.tsx") || source.includes('id="root"'))
    throw new Error("The saved article is missing from this computer.");
  return cleanArticle(source, article.url);
}
