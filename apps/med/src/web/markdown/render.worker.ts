import { wikiLinks } from "./wiki";
import { htmlImages } from "./html-images";
import { details } from "./details";
import { breakPieces } from "./breaks";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import type { Root, Element, ElementContent, RootContent } from "hast";
import { loadTheme, tokenLines, type SyntaxThemeData } from "../highlighting/highlighter";
import { codeHtml } from "./code-html";
import type { MarkdownBlock, MarkdownHeading } from "./model";
import { siteIcon } from "./site-icons";
const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath).use(remarkRehype);
// Replies and comments: a single dollar is text, as in $HOME or $3; $$ is math.
const replyParser = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath, { singleDollarTextMath: false })
  .use(remarkRehype);
const stringify = unified().use(rehypeStringify);
const toHtml = (children: ElementContent[]) => stringify.stringify({ type: "root", children });

// HTML that the worker makes once and keeps: a code block's highlighting, and
// a formula's KaTeX. The tree holds a slot in its place, and the block's HTML
// takes the kept HTML where the slot's tag stands. A stream renders its reply
// again for each update, and so serializes only what changed. A document can
// write no slot: its raw HTML is never kept and its text escapes `<`.
const SLOT = /<med-slot data-slot="(\d+)"><\/med-slot>/g;
const kept = <T>(limit: number) => {
  const cache = new Map<string, T>();
  return {
    get: (key: string) => cache.get(key),
    set(key: string, value: T) {
      if (cache.size >= limit) cache.delete(cache.keys().next().value!);
      cache.set(key, value);
    },
  };
};
const codeCache = kept<string>(32);
const mathCache = kept<string>(256);

// KaTeX loads with the first formula. Its options and its fallbacks for a
// formula it cannot parse are those that Med used through rehype-katex.
let katex: (typeof import("katex"))["default"] | undefined;
const KATEX = { trust: false, strict: "ignore", maxExpand: 500, maxSize: 20 } as const;
async function formula(tex: string, displayMode: boolean) {
  const key = `${displayMode ? "display" : "inline"}:${tex}`;
  let html = mathCache.get(key);
  if (html === undefined) {
    katex ??= (await import("katex")).default;
    try {
      html = katex.renderToString(tex, { ...KATEX, displayMode, throwOnError: true });
    } catch (error) {
      try {
        html = katex.renderToString(tex, { ...KATEX, displayMode, throwOnError: false });
      } catch {
        html = toHtml([
          {
            type: "element",
            tagName: "span",
            properties: {
              className: ["katex-error"],
              style: "color:#cc0000",
              title: String(error),
            },
            children: [{ type: "text", value: tex }],
          },
        ]);
      }
    }
    mathCache.set(key, html);
  }
  return html;
}
const classesOf = (node: Element) =>
  Array.isArray(node.properties.className) ? node.properties.className.map(String) : [];
/** A formula, as rehype-katex finds it: display math's `pre`, or inline math. */
function mathOf(node: RootContent) {
  if (node.type !== "element") return;
  const code = node.children[0];
  if (
    node.tagName === "pre" &&
    code?.type === "element" &&
    code.tagName === "code" &&
    classesOf(code).includes("language-math")
  )
    return { tex: textOf(node), displayMode: true };
  const classes = classesOf(node);
  if (["language-math", "math-display", "math-inline"].some((name) => classes.includes(name)))
    return { tex: textOf(node), displayMode: classes.includes("math-display") };
}
/** Text with a line break opportunity (<wbr>) at the separators of its long
 * words (breaks.ts), so that a table column's narrowest width is its longest
 * piece, not its longest word. Copied text is unchanged. */
function breakable(value: string): Element["children"] {
  return breakPieces(value).flatMap((piece, index) => [
    ...(index ? [{ type: "element" as const, tagName: "wbr", properties: {}, children: [] }] : []),
    ...(piece ? [{ type: "text" as const, value: piece }] : []),
  ]);
}
const textOf = (node: RootContent): string =>
  node.type === "text" ? node.value : "children" in node ? node.children.map(textOf).join("") : "";
const firstSourceLine = (node: RootContent): number | undefined => {
  if (node.position) return node.position.start.line;
  if ("children" in node) {
    for (const child of node.children) {
      const line = firstSourceLine(child);
      if (line !== undefined) return line;
    }
  }
};
type Task = {
  id: number;
  text: string;
  /** The theme, once for each worker; later tasks name it. */
  theme?: SyntaxThemeData;
  themeName?: string;
  vault?: boolean;
  fileLinks?: boolean;
  /** Keep every link target for the review brief to resolve against its files. */
  briefLinks?: boolean;
  /** Web links are pills with their site's icon, as in an agent's replies. */
  webLinks?: boolean;
  /** Only $$ starts math; a single dollar stays text, as in an agent's replies. */
  plainDollars?: boolean;
  /** A pull request's description: its <img> tags are images. */
  htmlImages?: boolean;
  /** Parse with Pierre Words (words/tree.ts), not remark. A description's
   * images need remark. */
  words?: boolean;
};
/** The document as hast, from remark, with Med's Markdown steps. */
async function remarkTree(task: Task) {
  const markdownParser = task.plainDollars ? replyParser : parser;
  const markdown = markdownParser.parse(task.text);
  if (task.vault) wikiLinks(markdown, task.text);
  details(markdown, (summary) => {
    const [first, ...rest] = markdownParser.parse(summary).children;
    return first?.type === "paragraph" && !rest.length
      ? first.children
      : [{ type: "text", value: summary }];
  });
  if (task.htmlImages) htmlImages(markdown);
  return (await markdownParser.run(markdown)) as Root;
}
// A preview keeps only its latest task. A batch, as of a thread's replies,
// renders each task in order and replies to each.
let latest: Task | undefined;
const queue: Task[] = [];
const themes = new Map<string, SyntaxThemeData>();
let running = false;
self.onmessage = (event: MessageEvent<Task | { batch: Task[] }>) => {
  if ("batch" in event.data) queue.push(...event.data.batch);
  else latest = event.data;
  if (!running) void drain();
};
async function drain() {
  running = true;
  while (latest || queue.length) {
    const queued = !latest;
    const task = latest ?? queue.shift()!;
    latest = undefined;
    try {
      const started = performance.now();
      if (task.text.length > 512 * 1024)
        throw new Error("Markdown preview supports up to 512 KiB. The source remains available.");
      // Words and its WebAssembly load once a task asks for them.
      const tree =
        task.words && !task.htmlImages
          ? (await import("./words/tree")).wordsTree(task.text, task)
          : await remarkTree(task);
      const headings: MarkdownHeading[] = [];
      const slugs = new Map<string, number>();
      const slots: string[] = [];
      const slot = (html: string, position: Element["position"]): Element => ({
        type: "element",
        tagName: "med-slot",
        properties: { dataSlot: slots.push(html) - 1 },
        children: [],
        position,
      });
      if (task.theme) themes.set(task.theme.name!, task.theme);
      const known = task.theme ?? themes.get(task.themeName!);
      if (!known) throw new Error("The Markdown theme is not loaded. Reload the page.");
      const theme: SyntaxThemeData = known;
      loadTheme(theme);
      async function visit(node: RootContent, sourceLine: number, cell = false): Promise<void> {
        if (node.type !== "element") return;
        if (node.position) {
          node.properties.dataSourceLine = node.position.start.line;
          node.properties.dataSourceEnd = node.position.end.line;
        }
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
            line: node.position?.start.line ?? sourceLine,
          });
        }
        if (node.tagName === "a") {
          const href = String(node.properties.href ?? "");
          if (task.briefLinks && href && !href.startsWith("#") && !/^mailto:/i.test(href))
            node.properties.dataBriefHref = href;
          // Raw HTML is never enabled. Only these explicit link schemes are active.
          if (/^(https?:|mailto:)/i.test(href)) {
            node.properties.target = "_blank";
            node.properties.rel = ["noopener", "noreferrer"];
            // A link that is one word, as a pasted address, is one line that
            // ends in an ellipsis where the column does; it names where it
            // goes on hover.
            const label = textOf(node);
            if (task.webLinks && label && !/\s/.test(label)) {
              node.properties.dataOneWord = "";
              node.properties.title = href;
            }
            // The icon is one that Med holds; it fetches none.
            const icon = task.webLinks ? siteIcon(href) : undefined;
            if (icon) {
              node.properties.className = ["med-web-link"];
              node.properties.dataSite = icon.id;
              // The icon and the first word stay on one line.
              const [first, ...rest] = node.children;
              const word = first?.type === "text" ? /^\S*\s?/.exec(first.value)![0] : "";
              node.children = [
                {
                  type: "element",
                  tagName: "span",
                  properties: { className: ["med-web-link-lead"] },
                  children: [
                    {
                      type: "element",
                      tagName: "img",
                      properties: {
                        className: ["med-web-link-icon"],
                        src: icon.src,
                        alt: "",
                        dataSiteIcon: icon.dark ? "dark" : "",
                      },
                      children: [],
                    },
                    ...(first?.type === "text"
                      ? [{ type: "text" as const, value: word }]
                      : first
                        ? [first]
                        : []),
                  ],
                },
                ...(first?.type === "text" && first.value.length > word.length
                  ? [{ type: "text" as const, value: first.value.slice(word.length) }]
                  : []),
                ...rest,
              ];
            }
          } else if (task.vault && href.startsWith("med-vault:wiki:")) {
            node.properties.dataVaultLink = decodeURIComponent(
              href.replace(/^med-vault:wiki:/, ""),
            );
            node.properties.dataVaultSyntax = "wiki";
            node.properties.href = "#";
          } else if (task.vault && href && !/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(href)) {
            node.properties.dataVaultLink = href;
            node.properties.dataVaultSyntax = "markdown";
            node.properties.href = "#";
          } else if (task.fileLinks && href && !/^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(href)) {
            node.properties.dataFileLink = href;
            node.properties.href = "#";
          } else if (href.startsWith("#"))
            node.properties.href = /^#(?:user-content-|footnote-label)/.test(href)
              ? href
              : `#md-${href.slice(1).replace(/^md-/, "")}`;
          else {
            delete node.properties.href;
            // A brief or a reply opens its own links; elsewhere the link is inert.
            if (!task.briefLinks) node.properties.title = `Relative link: ${href}`;
          }
        }
        if (node.tagName === "img" && node.properties.dataSiteIcon === undefined) {
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
            // A chart that Med draws (ChartBlock), from its keys and rows.
            if (language === "chart") {
              node.properties.dataChart = true;
              return;
            }
            if (language !== "text" && source.length < 100_000 && language !== "markdown") {
              const key = `${theme.name}:${language}:${source}`;
              let html = codeCache.get(key);
              if (html === undefined) {
                html = codeHtml(await tokenLines(source, language, theme.name!));
                codeCache.set(key, html);
              }
              code.children = [slot(html, undefined)];
              return;
            }
          }
        }
        // In a table, a long path or command can break at its separators, so
        // that its column shares the width instead of pushing the last ones out.
        const inCell = cell || node.tagName === "td" || node.tagName === "th";
        if (inCell)
          node.children = node.children.flatMap((child) =>
            child.type === "text" ? breakable(child.value) : [child],
          );
        await visitChildren(node.children, sourceLine, inCell);
      }
      /** Visits each child, and puts a formula's KaTeX in its place. At the
       * top, each block starts from its own first line. */
      async function visitChildren(children: RootContent[], sourceLine?: number, cell = false) {
        for (const [index, child] of children.entries()) {
          const math = mathOf(child);
          if (math)
            children[index] = slot(await formula(math.tex, math.displayMode), child.position);
          else await visit(child, sourceLine ?? firstSourceLine(child) ?? 1, cell);
        }
      }
      await visitChildren(tree.children);
      if (latest && !queued) continue;
      let previousEnd = 0;
      const blocks: MarkdownBlock[] = tree.children
        .filter((node) => node.type !== "text" || node.value.trim())
        .map((node) => {
          // Generated footnote sections have no source position. Keep the map ordered.
          const start = node.position?.start.line ?? previousEnd + 1;
          const end = node.position?.end.line ?? start;
          previousEnd = end;
          const html = stringify.stringify({ type: "root", children: [node] });
          return {
            html: slots.length ? html.replace(SLOT, (_, index) => slots[Number(index)]!) : html,
            start,
            end,
            ...(node.type === "element" && node.properties.dataMermaid
              ? { diagram: textOf(node) }
              : {}),
            ...(node.type === "element" && node.properties.dataChart
              ? { chart: textOf(node) }
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
