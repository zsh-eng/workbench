import type { Element, ElementContent, Root, RootContent } from "hast";
import { details } from "./details";
import { parseWords, wordsRoot } from "./hast";
import { prepareMath } from "./math";
import { rawHtml } from "./raw-html";
import { escapeWiki, wikiLinks } from "./wiki";
import { renderWords } from "./words";

/** Promotes standalone single-line `$$...$$` / `\[...\]` paragraphs to display math
 * without shifting source line numbers. */
function promoteDisplayMath(nodes: RootContent[], displayLines: Set<number>) {
  if (!displayLines.size) return;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    if (node.type !== "element") continue;
    if (
      node.tagName === "p" &&
      node.position &&
      node.position.start.line === node.position.end.line &&
      displayLines.has(node.position.start.line)
    ) {
      const significant = node.children.filter(
        (child) => child.type !== "text" || child.value.trim().length > 0,
      );
      const only = significant[0];
      if (
        significant.length === 1 &&
        only?.type === "element" &&
        only.tagName === "code" &&
        Array.isArray(only.properties.className) &&
        only.properties.className.map(String).includes("language-math")
      ) {
        const displayCode: Element = {
          ...only,
          properties: { ...only.properties, className: ["language-math", "math-display"] },
        };
        nodes[i] = {
          type: "element",
          tagName: "pre",
          properties: {},
          children: [displayCode],
          position: node.position,
        };
        continue;
      }
    }
    if (node.children.length) promoteDisplayMath(node.children, displayLines);
  }
}

/**
 * A document as hast, from Pierre Words, with Med's steps: wiki links in a
 * vault, GitHub's folds, and a description's images (raw-html.ts). Words
 * places each top-level block and each heading, code block, and table in the
 * source, for the worker (render.worker.ts) to map the page to its lines.
 */
export function wordsTree(
  text: string,
  {
    vault = false,
    plainDollars = false,
    smartDollars = false,
    htmlImages = false,
  }: { vault?: boolean; plainDollars?: boolean; smartDollars?: boolean; htmlImages?: boolean },
): Root {
  const singleDollarMath = !plainDollars;
  const prepared = prepareMath(vault ? escapeWiki(text) : text, { smartDollars });
  const tree = wordsRoot(renderWords(prepared.text, { singleDollarMath }));
  promoteDisplayMath(tree.children, prepared.displayLines);
  if (vault) wikiLinks(tree);
  details(tree, (markdown) => {
    // A summary is one paragraph's words, or its Markdown as text.
    const preparedSummary = prepareMath(markdown, { smartDollars });
    const [first, ...rest] = parseWords(
      renderWords(preparedSummary.text, { singleDollarMath, sourceLines: false }),
    ).filter((node) => node.type !== "text" || node.value.trim());
    return first?.type === "element" && first.tagName === "p" && !rest.length
      ? first.children
      : ([{ type: "text", value: markdown }] satisfies ElementContent[]);
  });
  rawHtml(tree, htmlImages);
  return tree;
}
