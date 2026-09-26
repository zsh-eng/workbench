import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import type { Root, Element, RootContent } from "hast";
import type { AdapterTheme } from "../highlighting/adapter";
import { createHighlighter } from "../highlighting/runtime";
import { supportedLanguage } from "../highlighting/languages";
import type { MarkdownBlock, MarkdownHeading } from "./model";
const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath).use(remarkRehype);
const stringify = unified().use(rehypeStringify);
const highlighter = await createHighlighter();
const codeCache = new Map<string, Element["children"]>();
const textOf = (node: RootContent): string =>
  node.type === "text" ? node.value : "children" in node ? node.children.map(textOf).join("") : "";
type Task = { id: number; text: string; theme: AdapterTheme };
let latest: Task | undefined;
let running = false;
self.onmessage = (event: MessageEvent<Task>) => {
  latest = event.data;
  if (!running) void drain();
};
async function drain() {
  running = true;
  while (latest) {
    const task = latest;
    latest = undefined;
    try {
      const started = performance.now();
      if (task.text.length > 512 * 1024)
        throw new Error("Markdown preview supports up to 512 KiB. The source remains available.");
      let tree = (await parser.run(parser.parse(task.text))) as Root;
      const headings: MarkdownHeading[] = [];
      const slugs = new Map<string, number>();
      let hasMath = false;
      highlighter.loadThemeSync(task.theme);
      async function visit(node: RootContent): Promise<void> {
        if (node.type !== "element") return;
        if (node.position) {
          node.properties.dataSourceLine = node.position.start.line;
          node.properties.dataSourceEnd = node.position.end.line;
        }
        const classes = String(node.properties.className ?? "");
        if (classes.includes("math-inline") || classes.includes("math-display")) hasMath = true;
        if (/^h[1-6]$/.test(node.tagName)) {
          const text = textOf(node);
          const slug =
            text
              .toLowerCase()
              .replace(/[^\p{L}\p{N}\s-]/gu, "")
              .trim()
              .replace(/\s+/g, "-") || "section";
          const n = slugs.get(slug) ?? 0;
          slugs.set(slug, n + 1);
          const id = String(node.properties.id ?? `md-${slug}${n ? `-${n}` : ""}`);
          node.properties.id = id;
          headings.push({
            id,
            text,
            level: Number(node.tagName[1]),
            line: node.position?.start.line ?? 1,
          });
        }
        if (node.tagName === "a") {
          const href = String(node.properties.href ?? "");
          // Raw HTML is never enabled. Only these explicit link schemes are active.
          if (/^(https?:|mailto:)/i.test(href)) {
            node.properties.target = "_blank";
            node.properties.rel = ["noopener", "noreferrer"];
          } else if (href.startsWith("#"))
            node.properties.href = /^#(?:user-content-|footnote-label)/.test(href)
              ? href
              : `#md-${href.slice(1).replace(/^md-/, "")}`;
          else {
            delete node.properties.href;
            node.properties.title = `Relative link: ${href}`;
          }
        }
        if (node.tagName === "img") {
          node.properties.dataImageSource = node.properties.src;
          delete node.properties.src;
          node.properties.loading = "lazy";
          node.properties.decoding = "async";
          node.properties.referrerPolicy = "no-referrer";
        }
        if (node.tagName === "pre") {
          const code = node.children[0];
          if (code?.type === "element" && code.tagName === "code") {
            const language =
              String(code.properties.className ?? "").match(/language-([^ ,]+)/)?.[1] ?? "text";
            const source = textOf(code);
            node.properties.dataLanguage = language;
            if (language === "mermaid") {
              node.properties.dataMermaid = true;
              return;
            }
            if (supportedLanguage(language) && source.length < 100_000 && language !== "markdown") {
              const key = `${task.theme.name}:${language}:${source}`;
              let children = codeCache.get(key);
              if (!children) {
                await highlighter.prepareSource(language, source);
                children = [];
                const lines = highlighter.codeToTokens(source, {
                  lang: language,
                  theme: task.theme.name!,
                  tokenizeMaxLineLength: 20000,
                });
                lines.forEach((line, index) => {
                  if (index) children!.push({ type: "text", value: "\n" });
                  for (const token of line)
                    children!.push({
                      type: "element",
                      tagName: "span",
                      properties: {
                        style: Object.entries(token.htmlStyle ?? {})
                          .map(([k, v]) => `${k}:${v}`)
                          .join(";"),
                      },
                      children: [{ type: "text", value: token.content }],
                    });
                });
                if (codeCache.size >= 32) codeCache.delete(codeCache.keys().next().value!);
                codeCache.set(key, children);
              }
              code.children = children;
              return;
            }
          }
        }
        for (const child of node.children) await visit(child);
      }
      for (const node of tree.children) await visit(node);
      if (hasMath) {
        const { default: katex } = await import("rehype-katex");
        tree = (await unified()
          .use(katex, { trust: false, strict: "ignore", maxExpand: 500, maxSize: 20 })
          .run(tree)) as Root;
      }
      if (latest) continue;
      let previousEnd = 0;
      const blocks: MarkdownBlock[] = tree.children
        .filter((node) => node.type !== "text" || node.value.trim())
        .map((node) => {
          // Generated footnote sections have no source position. Keep the map ordered.
          const start = node.position?.start.line ?? previousEnd + 1;
          const end = node.position?.end.line ?? start;
          previousEnd = end;
          return {
            html: stringify.stringify({ type: "root", children: [node] }),
            start,
            end,
            ...(node.type === "element" && node.properties.dataMermaid
              ? { diagram: textOf(node) }
              : {}),
          };
        });
      self.postMessage({
        id: task.id,
        blocks,
        headings,
        milliseconds: performance.now() - started,
      });
    } catch (error) {
      self.postMessage({
        id: task.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  running = false;
}
