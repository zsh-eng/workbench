import type { Element, ElementContent, Root, RootContent } from "hast";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import type { RenderedCard } from "./model";

// Cards keep `$…$` inline math: imported and existing cards use it, as
// Markdown files do in Med. Raw HTML stays off.
const parser = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  .use(remarkRehype);
const stringify = unified().use(rehypeStringify);

/** Longer sources show as plain code, so that one card cannot stall review. */
const MAX_HIGHLIGHT = 100_000;

const textOf = (node: RootContent | ElementContent): string =>
  node.type === "text"
    ? node.value
    : "children" in node
      ? node.children.map(textOf).join("")
      : "";

const classesOf = (node: Element) => {
  const value = node.properties.className;
  return Array.isArray(value) ? value.map(String) : value ? [String(value)] : [];
};

type Highlights = typeof import("./highlight");
let highlights: Promise<Highlights> | undefined;
let katex: Promise<typeof import("rehype-katex")> | undefined;

/** A failed chunk load is tried again by the next card that needs it. */
function retry<T>(loading: Promise<T>, forget: () => void) {
  return loading.catch((error) => {
    forget();
    throw error;
  });
}

/** Renders one card side. `base` resolves relative image URLs (the page's URL). */
export async function renderCardMarkdown(
  text: string,
  base: string,
): Promise<RenderedCard> {
  let tree = (await parser.run(parser.parse(text))) as Root;
  const images = new Set<string>();
  const diagrams: string[] = [];
  const code: { element: Element; language: string; source: string }[] = [];
  let math = false;

  function visit(node: Element, parent: Root | Element, index: number) {
    const classes = classesOf(node);
    if (classes.includes("math-inline") || classes.includes("math-display"))
      math = true;
    if (node.tagName === "img") {
      const raw = String(node.properties.src ?? "");
      let source: string | undefined;
      try {
        source = new URL(raw, base).href;
      } catch {
        /* Keep the source as written. */
      }
      if (source && /^https?:/.test(source)) {
        images.add(source);
        // Do not start a browser download before IndexedDB has been checked.
        node.properties.dataCacheSrc = source;
        delete node.properties.src;
        delete node.properties.srcSet;
      }
      node.properties.decoding = "async";
    }
    if (node.tagName === "a") {
      const href = String(node.properties.href ?? "");
      // A link opens beside the app, which keeps the review where it is.
      // Other schemes (javascript:, data:) and paths stay inert text.
      if (/^(https?:|mailto:)/i.test(href)) {
        node.properties.target = "_blank";
        node.properties.rel = ["noopener", "noreferrer"];
      } else if (!href.startsWith("#")) delete node.properties.href;
    }
    if (node.tagName === "table") {
      // A wide table scrolls inside the card instead of widening it.
      parent.children[index] = {
        type: "element",
        tagName: "div",
        properties: { className: ["card-table"] },
        children: [node],
      };
    }
    if (node.tagName === "pre") {
      const inner = node.children[0];
      if (inner?.type === "element" && inner.tagName === "code") {
        // A $$ block or a ```math fence: KaTeX replaces the whole <pre>.
        const kinds = classesOf(inner);
        if (kinds.includes("math-display") || kinds.includes("language-math")) {
          math = true;
          return;
        }
        const language =
          classesOf(inner)
            .find((name) => name.startsWith("language-"))
            ?.slice("language-".length)
            .toLowerCase() ?? "";
        const source = textOf(inner).replace(/\n$/, "");
        if (language) node.properties.dataLanguage = language;
        if (language === "mermaid") {
          node.properties.dataMermaid = "true";
          diagrams.push(source);
        } else if (language && source.length <= MAX_HIGHLIGHT)
          code.push({ element: inner, language, source });
        return;
      }
    }
    node.children.forEach((child, childIndex) => {
      if (child.type === "element") visit(child, node, childIndex);
    });
  }
  tree.children.forEach((child, index) => {
    if (child.type === "element") visit(child, tree, index);
  });

  if (code.length) {
    const { highlightLines } = await (highlights ??= retry(
      import("./highlight"),
      () => (highlights = undefined),
    ));
    for (const block of code) {
      const lines = highlightLines(block.source, block.language);
      if (!lines) continue;
      block.element.properties.className = [
        ...classesOf(block.element),
        "card-code",
      ];
      block.element.children = lines.flatMap((line, index) => [
        ...(index ? [{ type: "text" as const, value: "\n" }] : []),
        ...line.map(
          (token): ElementContent => ({
            type: "element",
            tagName: "span",
            properties: { style: token.style },
            children: [{ type: "text", value: token.content }],
          }),
        ),
      ]);
    }
  }
  if (math) {
    const { default: rehypeKatex } = await (katex ??= retry(
      import("rehype-katex"),
      () => (katex = undefined),
    ));
    tree = (await unified()
      .use(rehypeKatex, { strict: "ignore" })
      .run(tree)) as Root;
  }
  return {
    html: stringify.stringify(tree),
    images: [...images],
    diagrams,
    math,
  };
}
