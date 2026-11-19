import type { Element, ElementContent, Root, RootContent } from "hast";
import { FOLDS, pieces, summaryMarkdown, words } from "../details";

// details.ts for Words' tree: the same folds, built from the HTML blocks that
// Words leaves as escaped text in a <template data-html>. Raw HTML never
// renders, so every other HTML block goes.

type Node = Root | Element;
type Position = NonNullable<Element["position"]>;
interface Fold {
  open: boolean;
  summary?: ElementContent[];
  children: RootContent[];
  start?: Position["start"];
}

const isHtml = (node: RootContent): node is Element =>
  node.type === "element" && node.tagName === "template" && "dataHtml" in node.properties;
const htmlOf = (node: Element) =>
  node.children.map((child) => (child.type === "text" ? child.value : "")).join("");
// Blocks that hold no others.
const LEAVES = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "pre", "table"]);

/**
 * GitHub folds Markdown in <details> and shows its <summary> while it is
 * closed (details.ts). `summary` gives a summary's Markdown as inline nodes.
 */
export function details(tree: Root, summary: (markdown: string) => ElementContent[]) {
  const summaryOf = (html: string): ElementContent[] => {
    const markdown = summaryMarkdown(html);
    return markdown ? summary(markdown) : [{ type: "text", value: "Details" }];
  };
  const build = (fold: Fold, end?: Position["end"]): Element => {
    const last = fold.children.at(-1)?.position?.end;
    const close = end ?? last ?? fold.start;
    return {
      type: "element",
      tagName: "details",
      properties: fold.open ? { open: true } : {},
      children: [
        {
          type: "element",
          tagName: "summary",
          properties: {},
          children: fold.summary ?? [{ type: "text", value: "Details" }],
        },
        ...(fold.children as ElementContent[]),
      ],
      ...(fold.start && close && { position: { start: fold.start, end: close } }),
    };
  };
  const walk = (node: Node) => {
    if (node.type === "element" && LEAVES.has(node.tagName)) return;
    for (const child of node.children) if (child.type === "element") walk(child);
    if (!node.children.some((child) => isHtml(child))) return;
    const root: RootContent[] = [];
    const open: Fold[] = [];
    const into = () => open.at(-1)?.children ?? root;
    for (const child of node.children) {
      if (!isHtml(child)) {
        into().push(child);
        continue;
      }
      const html = htmlOf(child);
      // Other raw HTML renders nothing.
      if (!FOLDS.test(html)) continue;
      for (const piece of pieces(html)) {
        if (piece.kind === "open")
          open.push({ open: piece.open, children: [], start: child.position?.start });
        else if (piece.kind === "close") {
          const fold = open.pop();
          if (fold) into().push(build(fold, child.position?.end));
        } else if (piece.kind === "summary") {
          const fold = open.at(-1);
          if (fold && !fold.summary) fold.summary = summaryOf(piece.text);
        } else if (open.length) {
          // Words in a fold's HTML block are text; its images need a pull
          // request's description, which remark renders.
          const text = /<img\b/i.test(piece.text) ? "" : words(piece.text);
          if (text)
            into().push({
              type: "element",
              tagName: "p",
              properties: {},
              children: [{ type: "text", value: text }],
              position: child.position,
            });
        }
      }
    }
    while (open.length) {
      const fold = open.pop()!;
      into().push(build(fold));
    }
    node.children = root as typeof node.children;
  };
  walk(tree);
}
