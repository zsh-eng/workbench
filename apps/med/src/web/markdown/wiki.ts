interface Node {
  type: string;
  value?: string;
  children?: Node[];
  url?: string;
  alt?: string;
  data?: unknown;
  position?: { start: { offset?: number }; end: { offset?: number } };
}
/** Translate wiki syntax before Markdown-to-HTML conversion. Code nodes remain untouched. */
export function wikiLinks(tree: unknown, source: string) {
  const walk = (node: Node) => {
    if (
      !node.children ||
      ["code", "inlineCode", "html", "math", "inlineMath", "link", "image"].includes(node.type)
    )
      return;
    node.children = node.children.flatMap((child) => {
      if (child.type !== "text") {
        walk(child);
        return [child];
      }
      const raw =
        child.position?.start.offset === undefined
          ? (child.value ?? "")
          : source.slice(child.position.start.offset, child.position.end.offset);
      const result: Node[] = [];
      let end = 0;
      for (const match of raw.matchAll(/!?\[\[([^\]\r\n]+)\]\]/g)) {
        let slash = match.index - 1;
        while (slash >= 0 && raw[slash] === "\\") slash--;
        if ((match.index - 1 - slash) % 2) continue;
        if (match.index > end) result.push({ type: "text", value: raw.slice(end, match.index) });
        const [target, label] = match[1]!.split("|");
        if (match[0].startsWith("!")) {
          const dimensions = /^(\d+)(?:x(\d+))?$/.exec(label ?? "");
          result.push({
            type: "image",
            url: `med-vault:wiki:${encodeURIComponent(target!)}`,
            alt: target,
            ...(dimensions
              ? {
                  data: {
                    hProperties: {
                      width: Math.min(4096, Number(dimensions[1])),
                      ...(dimensions[2] ? { height: Math.min(4096, Number(dimensions[2])) } : {}),
                    },
                  },
                }
              : {}),
          });
        } else
          result.push({
            type: "link",
            url: `med-vault:wiki:${encodeURIComponent(target!)}`,
            children: [{ type: "text", value: label ?? target }],
          });
        end = match.index + match[0].length;
      }
      if (!result.length) return [child];
      if (end < raw.length) result.push({ type: "text", value: raw.slice(end) });
      return result;
    });
  };
  walk(tree as Node);
}
