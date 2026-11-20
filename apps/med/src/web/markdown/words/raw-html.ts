import type { Element, ElementContent, Root, RootContent } from "hast";

// Raw HTML never renders. Words leaves each piece of it, an HTML block or a
// tag among a paragraph's words, as its text in a <template data-html>
// (words.ts), and this takes each one out.

export const isHtml = (node: RootContent): node is Element =>
  node.type === "element" && node.tagName === "template" && "dataHtml" in node.properties;
export const htmlOf = (node: Element) =>
  node.children.map((child) => (child.type === "text" ? child.value : "")).join("");

// A comment, also one that never ends, or a tag, whose values can hold `>`.
const COMMENT_OR_TAG = /(<!--[\s\S]*?(?:-->|$)|<[a-z/](?:[^>"']|"[^"]*"|'[^']*')*>)/i;

const attribute = (tag: string, name: string) =>
  new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i")
    .exec(tag)
    ?.slice(1)
    .find((value) => value !== undefined)
    ?.replace(/&amp;/g, "&");

/** What HTML shows, in its order: its images and its words. */
function imagesAndWords(html: string) {
  return html.split(COMMENT_OR_TAG).flatMap((part, at): ElementContent[] => {
    if (at % 2 === 0) {
      const words = part.trim();
      return words ? [{ type: "text", value: words }] : [];
    }
    const src = /^<img\b/i.test(part) && attribute(part, "src");
    return src
      ? [
          {
            type: "element",
            tagName: "img",
            properties: { src, alt: attribute(part, "alt") ?? "" },
            children: [],
          },
        ]
      : [];
  });
}

/**
 * Takes out raw HTML. A pull request's description (`images`) keeps what its
 * images show: GitHub writes an image dropped into a description as an <img>
 * tag, and Markdown reads a caption on the next line as part of that HTML.
 * HTML with an image becomes the image and those words, where it stands: in
 * a paragraph, a list, a quote, or the fold (details.ts) that hides
 * screenshots. Code is not HTML here, so it keeps its text, and GitHub does
 * not show what is in a comment, so neither does Med.
 */
export function rawHtml(tree: Root, images: boolean) {
  const walk = (node: Root | Element) => {
    // An HTML block is a paragraph of its own, except in a tight list's item.
    const paragraphs =
      node.type === "root" ||
      node.tagName !== "li" ||
      node.children.some((child) => child.type === "element" && child.tagName === "p");
    node.children = node.children.flatMap((child): RootContent[] => {
      if (child.type !== "element") return [child];
      if (!isHtml(child)) {
        walk(child);
        return [child];
      }
      const parts = images ? imagesAndWords(htmlOf(child)) : [];
      if (!parts.some((part) => part.type === "element")) return [];
      const lines = parts.flatMap((part, at): ElementContent[] =>
        at
          ? [
              { type: "element", tagName: "br", properties: {}, children: [] },
              { type: "text", value: "\n" },
              part,
            ]
          : [part],
      );
      return child.position && paragraphs
        ? [
            {
              type: "element",
              tagName: "p",
              properties: {},
              children: lines,
              position: child.position,
            },
          ]
        : lines;
    }) as typeof node.children;
  };
  walk(tree);
}
