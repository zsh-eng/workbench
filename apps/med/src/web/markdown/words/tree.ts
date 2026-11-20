import type { ElementContent, Root } from "hast";
import { details } from "./details";
import { parseWords, wordsRoot } from "./hast";
import { rawHtml } from "./raw-html";
import { escapeWiki, wikiLinks } from "./wiki";
import { renderWords } from "./words";

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
    htmlImages = false,
  }: { vault?: boolean; plainDollars?: boolean; htmlImages?: boolean },
): Root {
  const singleDollarMath = !plainDollars;
  const tree = wordsRoot(renderWords(vault ? escapeWiki(text) : text, { singleDollarMath }));
  if (vault) wikiLinks(tree);
  details(tree, (markdown) => {
    // A summary is one paragraph's words, or its Markdown as text.
    const [first, ...rest] = parseWords(
      renderWords(markdown, { singleDollarMath, sourceLines: false }),
    ).filter((node) => node.type !== "text" || node.value.trim());
    return first?.type === "element" && first.tagName === "p" && !rest.length
      ? first.children
      : ([{ type: "text", value: markdown }] satisfies ElementContent[]);
  });
  rawHtml(tree, htmlImages);
  return tree;
}
