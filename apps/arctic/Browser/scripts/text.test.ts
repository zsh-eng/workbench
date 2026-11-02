import { afterAll, beforeAll, expect, test } from "bun:test";
import { Extractor } from "../server/extractor";
import { DownloadError, type PageResponse } from "../server/fetch";
import { ArticleText } from "./text";

const prose =
  "A well designed reading tool leaves enough space for ideas. Readers keep the useful parts of an article and return to them later, in their own time.";
const page = (title: string, paragraphs: number, head = "") =>
  `<!doctype html><html><head><title>${title}</title><meta name="author" content="Ada Reader">${head}</head><body><article><h1>${title}</h1>${`<p>${prose}</p>`.repeat(paragraphs)}<script>alert(1)</script></article></body></html>`;
const html = { "content-type": "text/html; charset=utf-8" };
// The fixture's own address is a literal, which a preview never keeps, so
// its tags name a public host.
const ogTags =
  '<meta property="og:description" content="Space for ideas &amp; notes."><meta property="og:image" content="https://cdn.example/quiet.jpg"><link rel="icon" href="https://cdn.example/icon.png">';
// The shape of a site's bot check: a small page of its own, with no article.
const browserCheck = `<!doctype html><title>Checking your browser...</title><noscript><p>Javascript required</p></noscript><script src="/__challenge/check.js"></script><script>window.HASHCASH_CONFIG={headline:"Checking your browser"};</script><body><div id="check"></div>`;
let publisher: ReturnType<typeof Bun.serve>;
let reader: ArticleText;

beforeAll(() => {
  publisher = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      switch (new URL(request.url).pathname) {
        case "/essay":
          return new Response(page("A quiet reading tool", 12, ogTags), {
            headers: html,
          });
        case "/huge":
          return new Response(page("Huge", 1, ogTags + "x".repeat(5 << 20)), {
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
        case "/gated":
          // A site that compares a browser's claim with its connection.
          return /Chrome|Safari|Mozilla/.test(
            request.headers.get("user-agent") ?? "",
          )
            ? new Response(browserCheck, { status: 403, headers: html })
            : new Response(page("Behind no wall", 12, ogTags), { headers: html });
        case "/checked":
          return new Response(browserCheck, { status: 403, headers: html });
        case "/checked-ok":
          return new Response(browserCheck, { headers: html });
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

test("wb arctic reads a link's preview from the HTML it fetched, with or without text", async () => {
  const at = (path: string) => new URL(path, publisher.url).href;
  const preview = {
    title: "A quiet reading tool",
    subtitle: "Space for ideas & notes.",
    imageURL: "https://cdn.example/quiet.jpg",
    faviconURL: "https://cdn.example/icon.png",
  };
  expect((await reader.read(at("/essay"))).preview).toEqual(preview);
  // A paywalled teaser has no text worth keeping, but still a preview.
  expect((await reader.read(at("/teaser"))).preview).toEqual({
    title: "Behind the paywall",
  });
  // The preview alone: one request, no extraction.
  expect(await reader.preview(at("/essay"))).toEqual(preview);
  await expect(reader.preview(at("/paper.pdf"))).rejects.toThrow("not a web page");
  await expect(reader.preview(at("/gone"))).rejects.toThrow("HTTP 404");
  await expect(reader.preview(at("/huge"))).rejects.toThrow("too large");
});

test("a site that checks browsers answers Arctic, which claims to be none", async () => {
  const at = (path: string) => new URL(path, publisher.url).href;
  expect(await reader.read(at("/gated"))).toMatchObject({
    title: "Behind no wall",
    byline: "Ada Reader",
  });
});

test("a bot check stops the read: no text, no title, no preview, no browser", async () => {
  const at = (path: string) => new URL(path, publisher.url).href;
  for (const path of ["/checked", "/checked-ok"]) {
    const started = performance.now();
    expect(await reader.read(at(path))).toEqual({
      title: "",
      problem: "browser check",
    });
    // Chromium's wait for text would take seconds.
    expect(performance.now() - started).toBeLessThan(1000);
    await expect(reader.preview(at(path))).rejects.toThrow("browser check");
  }
});

// What x.com serves without a sign-in, in shape: the words are this test's own.
const xHead = (title: string, description: string, image: string) =>
  `<head><title>${title}</title><meta property="og:title" content="${title}"><meta property="og:description" content="${description}"><meta property="og:image" content="${image}"></head>`;
const xPages: Record<string, { url?: string; status?: number; html: string }> = {
  "https://x.com/ice_notes/status/1234567890": {
    html: `<!doctype html><html>${xHead("Ada Reader on X: &quot;How sea ice keeps time&quot; / X", "How sea ice keeps time", "https://pbs.twimg.com/media/ICE?format=webp&amp;name=large")}<body><main><h2>Article</h2><p>${prose}</p><ul><li>A reply that is not the article.</li></ul></main></body></html>`,
  },
  "https://x.com/ice_notes/article/1234567890": {
    html: `<!doctype html><html>${xHead("How sea ice keeps time", "Ice records the seasons.", "https://pbs.twimg.com/media/ICE.png")}<body><article><h1>How sea ice keeps time</h1>${`<p>${prose}</p>`.repeat(12)}</article></body></html>`,
  },
  "https://x.com/ice_notes/status/777": {
    html: `<!doctype html><html>${xHead("Ada Reader on X: &quot;Reading the floe&quot; / X", "Reading the floe", "https://pbs.twimg.com/media/ICE.png")}<body><article>${`<p>${prose}</p>`.repeat(12)}</article></body></html>`,
  },
  "https://x.com/ice_notes/article/777": {
    status: 404,
    html: "<!doctype html><html><body></body></html>",
  },
  "https://x.com/i/article/999": {
    url: "https://x.com/i/jf/onboarding/web?redirect_after_login=%2Fi%2Farticle%2F999&mode=login",
    html: `<!doctype html><html>${xHead("X - The Everything App", "Sign up.", "https://abs.twimg.com/og/default.jpg")}<body><p>Sign in to X.</p></body></html>`,
  },
  "https://x.com/ice_notes/status/404": {
    status: 404,
    html: `<!doctype html><html>${xHead("Post Not Found - X", "", "https://abs.twimg.com/og/default.jpg")}<body></body></html>`,
  },
};

test("an X Article has its own title, image and text; a link X will not show fails plainly", async () => {
  const fake = async (url: string): Promise<PageResponse> => {
    const page = xPages[url];
    if (!page) throw new DownloadError(`Unexpected request: ${url}`);
    return {
      url: page.url ?? url,
      status: page.status ?? 200,
      headers: { "content-type": "text/html; charset=utf-8" },
      body: Buffer.from(page.html),
    };
  };
  const x = new ArticleText({ extractor: new Extractor(undefined, fake) });
  try {
    const article = await x.read("https://x.com/ice_notes/status/1234567890");
    expect(article.title).toBe("How sea ice keeps time");
    expect(article.preview).toMatchObject({
      title: "How sea ice keeps time",
      subtitle: "Ice records the seasons.",
      imageURL: "https://pbs.twimg.com/media/ICE.png",
    });
    expect(article.words).toBeGreaterThan(300);
    expect(article.html).not.toContain("not the article");

    // The post answered: a failed Article page does not lose what it showed.
    const post = await x.read("https://x.com/ice_notes/status/777");
    expect(post.preview?.title).toBe("Reading the floe");
    expect(post.words).toBeGreaterThan(300);

    expect(await x.read("https://x.com/i/article/999")).toEqual({
      title: "",
      problem: "X asks to sign in",
    });
    expect(await x.read("https://x.com/ice_notes/status/404")).toEqual({
      title: "",
      problem: "HTTP 404",
    });
  } finally {
    await x.close();
  }
});
