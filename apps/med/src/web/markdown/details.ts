interface Node {
  type: string;
  value?: string;
  children?: Node[];
  position?: { start: Point; end: Point };
  data?: Record<string, unknown>;
}
interface Point {
  line: number;
  column: number;
  offset?: number;
}
/** A fold that the transform builds, until its closing tag. */
interface Fold {
  open: boolean;
  summary?: Node[];
  children: Node[];
  start?: Point;
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

/**
 * GitHub folds Markdown in <details>, and shows its <summary> while it is
 * closed. Raw HTML never renders here, so these tags become a fold of the
 * Markdown between them: the blocks between `<details>` and `</details>` in a
 * document, a list item, or a quote. A fold that does not close ends with its
 * parent, as in a browser. Words in the same HTML block as the tags, with no
 * blank line between, are plain text, as on GitHub. Other HTML stays as it is.
 */
export function details(tree: unknown, inline: (markdown: string) => unknown[]) {
  const summaryOf = (html: string): Node[] => {
    const markdown = summaryMarkdown(html);
    // Its own lines are not the document's.
    const unplaced = (nodes: Node[]): Node[] =>
      nodes.map((node) => {
        const copy = { ...node, ...(node.children && { children: unplaced(node.children) }) };
        delete copy.position;
        return copy;
      });
    return markdown ? unplaced(inline(markdown) as Node[]) : [{ type: "text", value: "Details" }];
  };
  const build = (fold: Fold, end?: Point): Node => {
    const last = fold.children.at(-1)?.position?.end;
    const close = end ?? last ?? fold.start;
    return {
      type: "details",
      data: { hName: "details", hProperties: fold.open ? { open: true } : {} },
      children: [
        {
          type: "detailsSummary",
          data: { hName: "summary" },
          children: fold.summary ?? [{ type: "text", value: "Details" }],
        },
        ...fold.children,
      ],
      ...(fold.start && close && { position: { start: fold.start, end: close } }),
    };
  };
  const walk = (node: Node) => {
    if (!node.children || node.type === "paragraph" || node.type === "heading") return;
    for (const child of node.children) walk(child);
    if (!node.children.some((child) => child.type === "html" && FOLDS.test(child.value ?? "")))
      return;
    const root: Node[] = [];
    const open: Fold[] = [];
    const into = () => open.at(-1)?.children ?? root;
    for (const child of node.children) {
      if (child.type !== "html" || !FOLDS.test(child.value ?? "")) {
        into().push(child);
        continue;
      }
      for (const piece of pieces(child.value!)) {
        if (piece.kind === "open")
          open.push({ open: piece.open, children: [], start: child.position?.start });
        else if (piece.kind === "close") {
          const fold = open.pop();
          if (fold) into().push(build(fold, child.position?.end));
        } else if (piece.kind === "summary") {
          const fold = open.at(-1);
          if (fold && !fold.summary) fold.summary = summaryOf(piece.text);
        } else if (open.length) {
          // Words in a fold's HTML block: text, or an image that htmlImages shows.
          const text = words(piece.text);
          if (/<img\b/i.test(piece.text))
            into().push({ type: "html", value: piece.text, position: child.position });
          else if (text)
            into().push({
              type: "paragraph",
              children: [{ type: "text", value: text }],
              position: child.position,
            });
        } else into().push({ type: "html", value: piece.text, position: child.position });
      }
    }
    while (open.length) {
      const fold = open.pop()!;
      into().push(build(fold));
    }
    node.children = root;
  };
  walk(tree as Node);
}
