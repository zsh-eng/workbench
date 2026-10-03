import { DefuddleClass, type DefuddleResponse } from "defuddle/node";
import { parseHTML } from "linkedom";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import {
  DownloadError,
  fetchPage,
  MAX_BYTES,
  type PageResponse,
} from "./fetch";

export type ExtractedArticle = {
  url: string;
  title: string;
  description: string;
  author: string;
  image?: string;
  html: string;
  wordCount: number;
  method: "http" | "browser";
  downloadedAt: number;
};
const bundle = readFile(
  createRequire(import.meta.url).resolve("defuddle"),
  "utf8",
);
function textLength(content: string) {
  return (
    parseHTML(
      `<html><body>${content}</body></html>`,
    ).document.body.textContent?.trim().length ?? 0
  );
}
function usable(result: DefuddleResponse) {
  return (
    textLength(result.content) >= 200 &&
    !/^(just a moment|access denied|attention required|sign in|log in|verify you are human)/i.test(
      result.title.trim(),
    )
  );
}
function fromHTML(html: string, url: string) {
  const { document } = parseHTML(html);
  Object.defineProperty(document, "URL", { value: url });
  Object.defineProperty(document, "styleSheets", { value: [] });
  // Defuddle's supported linkedom adapter uses the same non-layout fallback.
  Object.defineProperty(document.defaultView, "getComputedStyle", {
    value: () => ({ display: "" }),
    configurable: true,
  });
  return new DefuddleClass(document as unknown as Document, {
    url,
    useAsync: false,
  }).parse();
}
function article(
  result: DefuddleResponse,
  url: string,
  method: "http" | "browser",
): ExtractedArticle {
  if (result.content.length > MAX_BYTES)
    throw new DownloadError("The extracted article is too large.");
  return {
    url,
    title: result.title.slice(0, 1000),
    description: result.description.slice(0, 4000),
    author: result.author.slice(0, 500),
    image: result.image || undefined,
    html: result.content,
    wordCount: result.wordCount,
    method,
    downloadedAt: Date.now(),
  };
}

export class Extractor {
  private browser?: Promise<Browser>;
  private idle?: ReturnType<typeof setTimeout>;
  private tail: Promise<void> = Promise.resolve();
  private closed = false;
  constructor(private testOrigin?: string) {}
  async extract(url: string): Promise<ExtractedArticle> {
    let response: PageResponse | undefined;
    try {
      response = await fetchPage(
        url,
        AbortSignal.timeout(8000),
        this.testOrigin,
      );
    } catch (error) {
      if (error instanceof DownloadError) throw error;
    }
    if (response && response.status >= 200 && response.status < 300) {
      if (
        !/text\/html|application\/xhtml\+xml/i.test(
          response.headers["content-type"] ?? "",
        )
      )
        throw new DownloadError("This link does not contain an HTML article.");
      const charset =
        response.headers["content-type"]?.match(
          /charset=["']?([^;\s"']+)/i,
        )?.[1] ?? "utf-8";
      let html: string;
      try {
        html = new TextDecoder(charset).decode(response.body);
      } catch {
        html = response.body.toString("utf8");
      }
      try {
        const result = fromHTML(html, response.url);
        if (usable(result)) return article(result, response.url, "http");
      } catch {
        /* Render sites whose initial HTML cannot be extracted. */
      }
    } else if (response && [401, 404, 410, 429].includes(response.status)) {
      throw new DownloadError(
        `The publisher returned HTTP ${response.status}. Open the original article to check access.`,
      );
    }
    // Only one rendered page at a time. Concurrent callers share the warm browser.
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await this.render(response?.url ?? url, response);
    } finally {
      release();
    }
  }
  private async render(
    url: string,
    initial?: PageResponse,
  ): Promise<ExtractedArticle> {
    if (this.closed)
      throw new DownloadError("The download service is stopping.", 503);
    clearTimeout(this.idle);
    this.browser ??= chromium
      .launch({
        headless: true,
        args: ["--force-webrtc-ip-handling-policy=disable_non_proxied_udp"],
      })
      .catch((error) => {
        this.browser = undefined;
        throw error;
      });
    let context: BrowserContext | undefined;
    try {
      const browser = await this.browser;
      context = await browser.newContext({
        serviceWorkers: "block",
        acceptDownloads: false,
        bypassCSP: true,
      });
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      controller.signal.addEventListener(
        "abort",
        () => void context?.close().catch(() => {}),
        {
          once: true,
        },
      );
      try {
        let requests = 0;
        await context.routeWebSocket("**/*", (socket) => socket.close());
        await context.route("**/*", async (route) => {
          const request = route.request();
          if (
            controller.signal.aborted ||
            ++requests > 80 ||
            request.method() !== "GET" ||
            ["image", "media", "font", "stylesheet"].includes(
              request.resourceType(),
            )
          ) {
            await route.abort().catch(() => {});
            return;
          }
          try {
            const response =
              initial && request.isNavigationRequest() && request.url() === url
                ? initial
                : await fetchPage(
                    request.url(),
                    controller.signal,
                    this.testOrigin,
                  );
            initial = undefined;
            await route.fulfill({
              status: response.status,
              headers: response.headers,
              body: response.body,
            });
          } catch {
            await route.abort().catch(() => {});
          }
        });
        const page = await context.newPage();
        context.on("page", (popup) => {
          if (popup !== page) void popup.close();
        });
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 12000 });
        await page.addScriptTag({ content: await bundle });
        // Stop at article readiness, never networkidle or full image/media load.
        const deadline = Date.now() + 6000;
        do {
          const result = await page.evaluate(() => {
            const Extract = (
              window as unknown as {
                Defuddle: new (
                  document: Document,
                  options: unknown,
                ) => { parse: () => DefuddleResponse };
              }
            ).Defuddle;
            return new Extract(document.cloneNode(true) as Document, {
              url: location.href,
              useAsync: false,
            }).parse();
          });
          if (usable(result)) return article(result, page.url(), "browser");
          await new Promise((resolve) => setTimeout(resolve, 250));
        } while (Date.now() < deadline && !controller.signal.aborted);
        throw new DownloadError(
          "No readable article text was found. Open the original to check access.",
        );
      } finally {
        clearTimeout(timeout);
        controller.abort();
      }
    } catch (error) {
      if (error instanceof DownloadError) throw error;
      if (String(error).includes("Executable doesn't exist"))
        throw new DownloadError(
          "The browser helper is not installed. Run bun run browser:install in apps/arctic/Browser.",
          503,
        );
      throw new DownloadError(
        "The publisher could not be loaded. Try again or open the original.",
      );
    } finally {
      await context?.close().catch(() => {});
      this.idle = setTimeout(() => void this.closeBrowser(), 30000);
      this.idle.unref?.();
    }
  }
  private async closeBrowser() {
    const browser = this.browser;
    this.browser = undefined;
    await (await browser?.catch(() => undefined))?.close();
  }
  async close() {
    this.closed = true;
    clearTimeout(this.idle);
    await this.closeBrowser();
  }
}
