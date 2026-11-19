import type { Element, ElementContent, Root } from "hast";

// wiki.ts for Words' tree. Words has already turned `\[` into `[`, so
// `escapeWiki` marks an escaped `[[` in the source first, and `wikiLinks`
// takes the mark out again.

/** A private-use character that no note holds: it keeps an escaped `[[` apart. */
const MARK = "";
const MARKS = //g;

/** Mark each `[[` that an odd number of backslashes escapes, as `[`, the mark, `[`. */
export const escapeWiki = (source: string) =>
  source.includes("[[")
    ? source.replace(/(\\+)\[\[/g, (whole, slashes: string) =>
        slashes.length % 2 ? `${slashes}[${MARK}[` : whole,
      )
    : source;

const SKIP = new Set(["a", "code", "pre", "template"]);

/** `[[note]]`, `[[note|label]]`, and `![[image|200x100]]` in text, as links and images. */
export function wikiLinks(tree: Root) {
  const walk = (node: Root | Element) => {
    node.children = node.children.flatMap((child) => {
      if (child.type === "element") {
        if (SKIP.has(child.tagName)) unmark(child);
        else walk(child);
        return [child];
      }
      if (child.type !== "text") return [child];
      const raw = child.value;
      const result: ElementContent[] = [];
      let end = 0;
      for (const match of raw.matchAll(/!?\[\[([^\]\r\n]+)\]\]/g)) {
        if (match.index > end) result.push({ type: "text", value: raw.slice(end, match.index) });
        const [target, label] = match[1]!.split("|");
        const url = `med-vault:wiki:${encodeURIComponent(target!)}`;
        if (match[0].startsWith("!")) {
          const dimensions = /^(\d+)(?:x(\d+))?$/.exec(label ?? "");
          result.push({
            type: "element",
            tagName: "img",
            properties: {
              src: url,
              alt: target,
              ...(dimensions && {
                width: Math.min(4096, Number(dimensions[1])),
                ...(dimensions[2] && { height: Math.min(4096, Number(dimensions[2])) }),
              }),
            },
            children: [],
          });
        } else
          result.push({
            type: "element",
            tagName: "a",
            properties: { href: url },
            children: [{ type: "text", value: label ?? target! }],
          });
        end = match.index + match[0].length;
      }
      if (end < raw.length) result.push({ type: "text", value: raw.slice(end) });
      return result.map((node) =>
        node.type === "text" ? { ...node, value: node.value.replace(MARKS, "") } : node,
      ) as typeof node.children;
    }) as typeof node.children;
  };
  walk(tree);
}

/** The mark out of the text of an element that the walk skips, as code. */
function unmark(element: Element) {
  for (const child of element.children) {
    if (child.type === "text") child.value = child.value.replace(MARKS, "");
    else if (child.type === "element") unmark(child);
  }
}
