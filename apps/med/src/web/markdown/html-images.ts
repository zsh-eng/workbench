interface Node {
  type: string;
  value?: string;
  url?: string;
  alt?: string;
  children?: Node[];
  position?: unknown;
}

const BLOCK_PARENTS = new Set(["root", "blockquote", "listItem", "footnoteDefinition"]);
// A comment, also one that never ends, or a tag, whose values can hold `>`.
const COMMENT_OR_TAG = /(<!--[\s\S]*?(?:-->|$)|<[a-z/](?:[^>"']|"[^"]*"|'[^']*')*>)/i;

const attribute = (tag: string, name: string) =>
  new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i")
    .exec(tag)
    ?.slice(1)
    .find((value) => value !== undefined)
    ?.replace(/&amp;/g, "&");

/** What HTML shows, in its order: its images and its words. */
function imagesAndWords({ value = "", position }: Node) {
  return value.split(COMMENT_OR_TAG).flatMap((part, at): Node[] => {
    if (at % 2 === 0) {
      const words = part.trim();
      return words ? [{ type: "text", value: words, position }] : [];
    }
    const url = /^<img\b/i.test(part) && attribute(part, "src");
    return url ? [{ type: "image", url, alt: attribute(part, "alt") ?? "", position }] : [];
  });
}

/**
 * Raw HTML never renders, but GitHub writes an image dropped into a pull
 * request's description as an <img> tag, and Markdown reads a caption on the
 * next line as part of that HTML. HTML with an image becomes the image and
 * those words, where it stands: in a list, a quote, or the <details> that
 * hides screenshots. Other HTML stays out. Code is not HTML here, so it keeps
 * its text, and GitHub does not show what is in a comment, so neither does Med.
 */
export function htmlImages(tree: unknown) {
  const walk = (node: Node) => {
    if (!node.children) return;
    node.children = node.children.flatMap((child) => {
      if (child.type !== "html") {
        walk(child);
        return [child];
      }
      const parts = imagesAndWords(child);
      if (!parts.some((part) => part.type === "image")) return [child];
      const lines = parts.flatMap((part, at) => (at ? [{ type: "break" }, part] : [part]));
      return BLOCK_PARENTS.has(node.type)
        ? [{ type: "paragraph", children: lines, position: child.position }]
        : lines;
    });
  };
  walk(tree as Node);
}
