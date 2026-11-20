import { expect, test } from "vitest";
import RenderWorker from "../../src/web/markdown/render.worker?worker";
import { resolveSyntaxTheme } from "../../src/web/pierre-theme";
import type { MarkdownResult } from "../../src/web/markdown/model";

const worker = new RenderWorker();
const theme = await resolveSyntaxTheme("pierre-dark");
let sequence = 0;
function render(text: string, options: Record<string, unknown> = {}) {
  const id = ++sequence;
  return new Promise<MarkdownResult>((resolve, reject) => {
    const listen = ({ data }: MessageEvent) => {
      if (data.id !== id) return;
      worker.removeEventListener("message", listen);
      if (data.error) reject(new Error(data.error));
      else resolve(data);
    };
    worker.addEventListener("message", listen);
    worker.postMessage({
      id,
      text,
      ...(id > 1 ? { themeName: theme.name } : { theme }),
      ...options,
    });
  });
}

const DOCUMENT = [
  "Intro with $$E = mc^2$$.",
  "",
  "$$",
  "\\int_0^1 x\\,dx",
  "$$",
  "",
  "| Formula | Value |",
  "|---|---|",
  "| $$x^2$$ | b |",
  "",
  "## Area $$\\pi r^2$$",
  "",
  "Broken $$\\frac{1}{$$ here.",
  "",
  "```ts",
  "if (a < b && c) {}",
  "```",
].join("\n");

test("math and code render in place, and again from what the worker kept", async () => {
  const options = { briefLinks: true, webLinks: true, plainDollars: true };
  const first = await render(DOCUMENT, options);
  const [intro, display, table, heading, broken, code] = first.blocks;
  expect(intro!.html).toContain('<span class="katex">');
  // Display math is its block, with its own lines.
  expect([display!.start, display!.end]).toEqual([3, 5]);
  expect(display!.html).toMatch(/^<span class="katex-display">/);
  expect(table!.html).toMatch(/<td[^>]*><span class="katex">/);
  expect(heading!.html).toMatch(/^<h2[^>]*>Area <span class="katex">/);
  // KaTeX shows what it cannot parse in its error colour.
  expect(broken!.html).toContain('<span class="katex-error"');
  expect(code!.html).toContain("&#x3C;");
  expect(code!.html).toMatch(/<code class="language-ts"><span style="[^"]+">/);
  // The same text renders the same HTML from the worker's kept code and math.
  const second = await render(DOCUMENT, options);
  expect(second.blocks).toEqual(first.blocks);
});

// A description as GitHub writes one: a dropped screenshot is an <img> tag.
const DESCRIPTION = [
  "## Before and after",
  "",
  '<img width="640" alt="Before" src="https://github.com/user-attachments/assets/before">',
  "The old list",
  "",
  '- After: <img alt="After" src="https://github.com/user-attachments/assets/after">',
  "",
  "<details>",
  "<summary>More shots</summary>",
  "",
  '<img src="https://github.com/user-attachments/assets/more">',
  "",
  "</details>",
  "",
  '<div align="center">Centred</div> <!-- <img src="https://example.com/hidden"> -->',
].join("\n");

test("a description shows the images of its HTML, and a reply shows none", async () => {
  const sources = (result: MarkdownResult) =>
    result.blocks.flatMap((block) =>
      [...block.html.matchAll(/<img [^>]*data-image-source="([^"]+)"/g)].map((m) => m[1]),
    );
  const description = await render(DESCRIPTION, { htmlImages: true, plainDollars: true });
  expect(sources(description)).toEqual([
    "https://github.com/user-attachments/assets/before",
    "https://github.com/user-attachments/assets/after",
    "https://github.com/user-attachments/assets/more",
  ]);
  const [, screenshot, list, fold, rest] = description.blocks;
  // The caption on the line after the tag stays with its image.
  expect(screenshot!.html).toMatch(/^<p[^>]*><img [^>]*alt="Before"[^>]*><br>\nThe old list<\/p>$/);
  expect([screenshot!.start, screenshot!.end]).toEqual([3, 4]);
  expect(list!.html).toMatch(/<li>After: <img [^>]*alt="After"/);
  expect(fold!.html).toMatch(/^<details[^>]*><summary>More shots<\/summary><p[^>]*><img /);
  // Other HTML, and a comment's image, show nothing.
  expect(rest).toBeUndefined();
  expect(description.blocks.map((block) => block.html).join("")).not.toMatch(/template|Centred/);

  const reply = await render(DESCRIPTION, { plainDollars: true });
  expect(sources(reply)).toEqual([]);
  expect(reply.blocks.map((block) => block.html).join("")).not.toMatch(/template|<img/);
});
