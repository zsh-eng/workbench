/**
 * The text of one article, for `wb arctic save` and `wb arctic text`: the
 * same Defuddle extraction as `scripts/copies.ts --extract`
 * (server/extractor.ts), and with `unwall`, the phone's Unwall route for the
 * sites on its list, as `copies.ts --unwall` reads them. The text is cleaned
 * and counted as `scripts/upload.ts` does; the caller then applies the
 * Article text page's rules (`copyProblem`) against the account's copy.
 */
import { parseHTML } from "linkedom";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { linkTitle } from "@workbench/arctic-links";
import { Extractor, fromHTML } from "../server/extractor";
import { PDF } from "../server/fetch";
import { cleanByline, tidyArticle } from "../src/content";

/** Unwall shows the publisher's teaser when it cannot open a page: 200–250 words. */
export const UNWALL_MIN_WORDS = 400;

let domains: Promise<string[]> | undefined;

/** As the phone routes links (Sources/ArticleBrowser.swift): a host on its Unwall list. */
export async function onUnwallList(url: string) {
  domains ??= readFile(
    join(import.meta.dir, "../../Resources/unwall-domains.json"),
    "utf8",
  ).then((text) => JSON.parse(text) as string[]);
  const list = await domains;
  const host = new URL(url).hostname.toLowerCase();
  return list.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

/**
 * The page through unwall.app, as the phone opens a listed site: the HTML of
 * the frame with the most words, without its scripts, after up to 15 s.
 */
export async function readThroughUnwall(browser: Browser, url: string) {
  const page = await browser.newPage();
  try {
    await page.goto(`https://unwall.app/${url}`, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    // The article arrives in a frame; wait up to 15 s for one with text.
    let best = { words: 0, html: "" };
    for (let tries = 0; tries < 15 && best.words < UNWALL_MIN_WORDS; tries++) {
      await page.waitForTimeout(1000);
      for (const frame of page.frames().slice(1)) {
        const words = await frame
          .evaluate(
            () =>
              (document.body?.innerText ?? "").split(/\s+/).filter(Boolean)
                .length,
          )
          .catch(() => 0);
        // Unwall's frame carries its own scripts; extract from a copy without them.
        if (words > best.words)
          best = {
            words,
            html: await frame.evaluate(() => {
              const copy = document.documentElement.cloneNode(true) as Element;
              copy
                .querySelectorAll("script,style,noscript,template")
                .forEach((element) => element.remove());
              return copy.outerHTML;
            }),
          };
      }
    }
    return best.html;
  } finally {
    await page.close();
  }
}

export type Reading = {
  /** The page's title (`linkTitle`), or "" when there is no page to read. */
  title: string;
  /** Cleaned HTML, as upload.ts cleans a file, and its words. */
  html?: string;
  words?: number;
  byline?: string;
  /** Why there is no text worth keeping, such as "PDF" or "paywall preview". */
  problem?: string;
};

/** Cleans an extracted article and counts its words, as upload.ts does. */
function clean(content: string, url: string) {
  const { document } = parseHTML(
    `<!doctype html><html><body>${content}</body></html>`,
  );
  tidyArticle(document.body, url);
  return {
    html: document.body.innerHTML.trim(),
    words: (document.body.textContent ?? "").split(/\s+/).filter(Boolean)
      .length,
  };
}

/** A short reason from the extractor's message. */
function reason(error: unknown, listed: boolean) {
  const message = error instanceof Error ? error.message : String(error);
  if (message === PDF) return "PDF";
  const status = /returned HTTP (\d+)/.exec(message)?.[1];
  if (status) return listed ? `paywall (HTTP ${status})` : `HTTP ${status}`;
  if (/No readable article text/.test(message))
    return listed ? "paywall preview" : "no article text";
  if (/does not contain an HTML article/.test(message)) return "not a web page";
  if (/browser helper is not installed/.test(message))
    return "Chromium is missing: run bun run --cwd apps/arctic/Browser browser:install";
  return message.replace(/\.$/, "");
}

/**
 * Reads articles one at a time and keeps one extractor and, with `unwall`,
 * one browser for Unwall. Close it when done.
 */
export class ArticleText {
  private extractor: Extractor;
  private unwall: boolean;
  private browser?: Promise<Browser>;
  /** `extractor` may allow a local test origin. */
  constructor(options: { unwall?: boolean; extractor?: Extractor } = {}) {
    this.extractor = options.extractor ?? new Extractor();
    this.unwall = options.unwall ?? false;
  }

  async read(url: string): Promise<Reading> {
    const listed = await onUnwallList(url);
    let title = "";
    let paywalled = listed;
    let best: Omit<Reading, "title"> | undefined;
    let problem: string | undefined;
    try {
      const page = await this.extractor.extract(url);
      title = page.title;
      paywalled ||= page.paywalled;
      best = { ...clean(page.html, url), byline: cleanByline(page.author) };
    } catch (error) {
      problem = reason(error, listed);
    }
    if (this.unwall && listed && (best?.words ?? 0) < UNWALL_MIN_WORDS) {
      try {
        this.browser ??= chromium.launch();
        const page = fromHTML(
          (await readThroughUnwall(await this.browser, url)) || "<html></html>",
          url,
        );
        const copy = clean(page.content, url);
        if (copy.words >= UNWALL_MIN_WORDS) {
          best = { ...copy, byline: cleanByline(page.author) };
          title ||= page.title;
        }
      } catch {
        /* Unwall could not open the page; keep what the publisher showed. */
      }
    }
    title = linkTitle(title);
    if (!best) return { title, problem: problem ?? "no article text" };
    // A paywalled site's short text is its teaser, not the article.
    if (paywalled && best.words! < UNWALL_MIN_WORDS)
      return { title, words: best.words, problem: "paywall preview" };
    return { title, ...best };
  }

  async close() {
    await this.extractor.close();
    await (await this.browser?.catch(() => undefined))?.close();
  }
}
