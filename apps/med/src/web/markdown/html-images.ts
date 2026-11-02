interface Node {
  type: string;
  value?: string;
  children?: Node[];
  position?: unknown;
}

const BLOCK_PARENTS = new Set(["root", "blockquote", "listItem", "footnoteDefinition"]);

const attribute = (tag: string, name: string) =>
  new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i")
    .exec(tag)
    ?.slice(1)
    .find((value) => value !== undefined)
    ?.replace(/&amp;/g, "&");

/**
 * Raw HTML never renders, but GitHub writes an image dropped into a pull
 * request's description as an <img> tag. Each one in the Markdown's HTML
 * becomes a Markdown image where it stands: in a list, a quote, or the
 * <details> that hides screenshots. Code is not HTML here, so it keeps its
 * text. GitHub does not show what is in an HTML comment, so neither does Med.
 */
export function htmlImages(node: Node) {
  if (!node.children) return;
  node.children = node.children.flatMap((child) => {
    if (child.type !== "html") {
      htmlImages(child);
      return [child];
    }
    const html = (child.value ?? "").replace(/<!--[\s\S]*?-->/g, "");
    const images = [...html.matchAll(/<img\b[^>]*>/gi)].flatMap(([tag]) => {
      const url = attribute(tag, "src");
      return url
        ? [{ type: "image", url, alt: attribute(tag, "alt") ?? "", position: child.position }]
        : [];
    });
    if (!images.length) return [child];
    return BLOCK_PARENTS.has(node.type)
      ? [{ type: "paragraph", children: images, position: child.position }]
      : images;
  });
}
