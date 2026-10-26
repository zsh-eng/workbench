import { afterAll, beforeAll, expect, test } from "bun:test";
import { Extractor } from "../server/extractor";
import { ArticleText } from "./text";

const prose =
  "A well designed reading tool leaves enough space for ideas. Readers keep the useful parts of an article and return to them later, in their own time.";
const page = (title: string, paragraphs: number, head = "") =>
  `<!doctype html><html><head><title>${title}</title><meta name="author" content="Ada Reader">${head}</head><body><article><h1>${title}</h1>${`<p>${prose}</p>`.repeat(paragraphs)}<script>alert(1)</script></article></body></html>`;
const html = { "content-type": "text/html; charset=utf-8" };
let publisher: ReturnType<typeof Bun.serve>;
let reader: ArticleText;

beforeAll(() => {
  publisher = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      switch (new URL(request.url).pathname) {
        case "/essay":
          return new Response(page("A quiet reading tool", 12), {
            headers: html,
          });
        case "/teaser":
          // A news site's preview: it says the article is not free.
          return new Response(
            page(
              "Behind the paywall",
              6,
              '<script type="application/ld+json">{"@context":"https://schema.org","@type":"NewsArticle","isAccessibleForFree":false}</script>',
            ),
            { headers: html },
          );
        case "/paper.pdf":
          return new Response("%PDF-1.7", {
            headers: { "content-type": "application/pdf" },
          });
        default:
          return new Response("Not found", { status: 404, headers: html });
      }
    },
  });
  reader = new ArticleText({ extractor: new Extractor(publisher.url.origin) });
});
afterAll(async () => {
  await reader.close();
  publisher.stop(true);
});

test("wb arctic reads an article's title and cleaned text, and says why a page has none", async () => {
  const at = (path: string) => new URL(path, publisher.url).href;
  const essay = await reader.read(at("/essay"));
  expect(essay.title).toBe("A quiet reading tool");
  expect(essay.byline).toBe("Ada Reader");
  expect(essay.words).toBeGreaterThan(300);
  expect(essay.html).toContain(prose);
  expect(essay.html).not.toContain("<script");
  expect(essay.problem).toBeUndefined();

  expect(await reader.read(at("/teaser"))).toMatchObject({
    title: "Behind the paywall",
    problem: "paywall preview",
  });
  expect(await reader.read(at("/paper.pdf"))).toEqual({
    title: "",
    problem: "PDF",
  });
  expect(await reader.read(at("/gone"))).toEqual({
    title: "",
    problem: "HTTP 404",
  });
});
