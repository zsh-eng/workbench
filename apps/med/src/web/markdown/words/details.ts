import type { Element, ElementContent, Root, RootContent } from "hast";
import { htmlOf, isHtml } from "./raw-html";

// GitHub's folds in Words' tree, built from the HTML blocks that Words leaves
// as escaped text in a <template data-html>. Other HTML stays for raw-html.ts.

type Node = Root | Element;
type Position = NonNullable<Element["position"]>;
interface Fold {
  open: boolean;
  summary?: ElementContent[];
  children: RootContent[];
  start?: Position["start"];
}
type Piece =
  | { kind: "open"; open: boolean }
  | { kind: "summary"; text: string }
  | { kind: "close" }
  | { kind: "rest"; text: string };

// <details …>, <summary …>…</summary> (or one that the HTML block ends), </details>.
const TAG =
  /<details\b([^>]*)>|<summary\b[^>]*>([\s\S]*?)(?:<\/summary\s*>|(?=<\/details)|$)|<\/details\s*>/gi;
const FOLDS = /<\/?details\b|<summary\b/i;

function pieces(html: string): Piece[] {
  const found: Piece[] = [];
  let last = 0;
  for (const match of html.matchAll(TAG)) {
    const rest = html.slice(last, match.index).trim();
    if (rest) found.push({ kind: "rest", text: rest });
    last = match.index + match[0].length;
    if (/^<details/i.test(match[0]))
      found.push({ kind: "open", open: /(?:^|\s)open(?:[\s=]|$)/i.test(match[1] ?? "") });
    else if (/^<summary/i.test(match[0])) found.push({ kind: "summary", text: match[2] ?? "" });
    else found.push({ kind: "close" });
  }
  const rest = html.slice(last).trim();
  if (rest) found.push({ kind: "rest", text: rest });
  return found;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" };
const decode = (text: string) =>
  text.replace(/&(amp|lt|gt|quot|#39);/g, (_, name: string) => ENTITIES[name]!);
const words = (html: string) =>
  decode(html.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();

/** A summary's words, with its bold, italic, and code marks as Markdown. */
const summaryMarkdown = (html: string) =>
  html
    .replace(/<\/?(?:b|strong)\b[^>]*>/gi, "**")
    .replace(/<\/?(?:i|em)\b[^>]*>/gi, "_")
    .replace(/<\/?code\b[^>]*>/gi, "`")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
/** HTML as an HTML block that Words leaves, for raw-html.ts. */
const html = (text: string, position: Element["position"]): Element => ({
  type: "element",
  tagName: "template",
  properties: { dataHtml: "" },
  children: [{ type: "text", value: text }],
  position,
});
// Blocks that hold no others.
const LEAVES = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "pre", "table"]);

/**
 * GitHub folds Markdown in <details>, and shows its <summary> while it is
 * closed. Raw HTML never renders here, so these tags become a fold of the
 * Markdown between them: the blocks between `<details>` and `</details>` in a
 * document, a list item, or a quote. A fold that does not close ends with its
 * parent, as in a browser. Words in the same HTML block as the tags, with no
 * blank line between, are plain text, as on GitHub. `summary` gives a
 * summary's Markdown as inline nodes.
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
      if (!isHtml(child) || !FOLDS.test(htmlOf(child))) {
        into().push(child);
        continue;
      }
      for (const piece of pieces(htmlOf(child))) {
        if (piece.kind === "open")
          open.push({ open: piece.open, children: [], start: child.position?.start });
        else if (piece.kind === "close") {
          const fold = open.pop();
          if (fold) into().push(build(fold, child.position?.end));
        } else if (piece.kind === "summary") {
          const fold = open.at(-1);
          if (fold && !fold.summary) fold.summary = summaryOf(piece.text);
        } else if (open.length && !/<img\b/i.test(piece.text)) {
          // Words in a fold's HTML block are text; an image is for raw-html.ts.
          const text = words(piece.text);
          if (text)
            into().push({
              type: "element",
              tagName: "p",
              properties: {},
              children: [{ type: "text", value: text }],
              position: child.position,
            });
        } else into().push(html(piece.text, child.position));
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
