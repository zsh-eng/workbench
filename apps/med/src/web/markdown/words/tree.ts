import type { ElementContent, Root } from "hast";
import { details } from "./details";
import { parseWords, wordsRoot } from "./hast";
import { escapeWiki, wikiLinks } from "./wiki";
import { renderWords } from "./words";

/**
 * A document as hast, from Pierre Words: the tree that remark makes in
 * render.worker.ts, with the same folds and wiki links, so that the rest of
 * the worker's work is the same for both. Words places each top-level block
 * and each heading, code block, and table in the source.
 */
export function wordsTree(
  text: string,
  { vault = false, plainDollars = false }: { vault?: boolean; plainDollars?: boolean },
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
  return tree;
}
