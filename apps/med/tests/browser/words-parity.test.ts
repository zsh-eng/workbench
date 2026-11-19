import { expect, test } from "vitest";
import RenderWorker from "../../src/web/markdown/render.worker?worker";
import { resolveSyntaxTheme } from "../../src/web/pierre-theme";
import type { MarkdownResult } from "../../src/web/markdown/model";

// Pierre Words renders what remark does in the worker: Med's own documents and
// a sample of every feature, as a reply, a file, and a note.
const documents = import.meta.glob<string>(
  ["../fixtures/markdown/*.md", "../../docs/*.md", "../../docs/usage/*.md", "../../*.md"],
  { query: "?raw", import: "default", eager: true },
);
const MODES = {
  reply: { briefLinks: true, webLinks: true, plainDollars: true },
  file: { fileLinks: true },
  note: { vault: true },
};

const worker = new RenderWorker();
const theme = await resolveSyntaxTheme("pierre-dark");
let sequence = 0;
function render(text: string, options: Record<string, unknown>) {
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

// remark names a footnote by its label, Words by its number; each keeps its
// links and ids together. remark writes every element's lines, Words those
// that the page reads: headings, code blocks, tables, and folds.
const LINED =
  /<(h[1-6]|pre|table|details)\b[^>]*?data-source-line="(\d+)" data-source-end="(\d+)"/g;
const lined = (html: string) => [...html.matchAll(LINED)].map((match) => match.slice(1).join(" "));
const normal = (html: string) =>
  html
    .replace(/ data-source-(line|end)="\d+"/g, "")
    .replace(/user-content-fn(ref)?-[\w-]+/g, "user-content-fn$1-N");
// The footnotes' heading has no line of its own: remark takes its first
// note's, and Words the line after the last block.
const outline = (result: MarkdownResult) =>
  result.headings.map((heading) => ({
    ...heading,
    line: heading.text === "Footnotes" ? 0 : heading.line,
  }));

test("Words renders as remark does: the same blocks, lines, HTML, and outline", async () => {
  const differences: unknown[] = [];
  let blocks = 0;
  for (const [path, text] of Object.entries(documents))
    for (const [mode, options] of Object.entries(MODES)) {
      const remark = await render(text, options);
      const words = await render(text, { ...options, words: true });
      const where = `${path.split("/").pop()} as a ${mode}`;
      blocks += remark.blocks.length;
      if (words.blocks.length !== remark.blocks.length)
        differences.push([where, "blocks", remark.blocks.length, words.blocks.length]);
      remark.blocks.forEach((block, index) => {
        const other = words.blocks[index];
        if (!other) return;
        const place = (one: typeof block) => [one.start, one.end, one.diagram, one.chart];
        if (place(other).join() !== place(block).join())
          differences.push([where, index, "lines", place(block), place(other)]);
        if (normal(other.html) !== normal(block.html))
          differences.push([where, index, "html", normal(block.html), normal(other.html)]);
        if (lined(other.html).join() !== lined(block.html).join())
          differences.push([where, index, "source lines", lined(block.html), lined(other.html)]);
      });
      if (JSON.stringify(outline(words)) !== JSON.stringify(outline(remark)))
        differences.push([where, "outline", outline(remark), outline(words)]);
    }
  expect(differences).toEqual([]);
  expect(blocks).toBeGreaterThan(2000);
});
