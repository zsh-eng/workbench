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

test.each([false, true])(
  "math and code render in place, and again from what the worker kept (Words: %s)",
  async (words) => {
    const options = { briefLinks: true, webLinks: true, plainDollars: true, words };
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
  },
);
