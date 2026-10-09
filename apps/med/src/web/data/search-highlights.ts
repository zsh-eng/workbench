const MAX_MATCHES = 1000;
export interface SearchHighlightOptions {
  caseSensitive?: boolean;
  wholeWord?: boolean;
}

/** Ranges of `query` in Pierre line rows, at most `limit` of them. */
export function searchRanges(
  rows: Iterable<Element>,
  query: string,
  options: SearchHighlightOptions = {},
  limit = MAX_MATCHES,
): Range[] {
  const ranges: Range[] = [];
  if (!query.trim()) return ranges;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    options.wholeWord ? `(?<![\\p{L}\\p{N}\\p{M}_])${escaped}(?![\\p{L}\\p{N}\\p{M}_])` : escaped,
    options.caseSensitive ? "gu" : "giu",
  );
  for (const row of rows) {
    // These are only the virtualizer's mounted lines, never the whole file.
    const text = row.textContent ?? "";
    pattern.lastIndex = 0;
    const matches = text.matchAll(pattern);
    const nodes: { node: Text; start: number; end: number }[] = [];
    const walker = row.ownerDocument.createTreeWalker(row, NodeFilter.SHOW_TEXT);
    let offset = 0;
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      nodes.push({ node, start: offset, end: offset + node.length });
      offset += node.length;
    }
    let cursor = 0;
    for (const match of matches) {
      const start = match.index;
      const end = start + match[0].length;
      while (cursor < nodes.length && nodes[cursor]!.end <= start) cursor++;
      let last = cursor;
      while (last < nodes.length && nodes[last]!.end < end) last++;
      const firstNode = nodes[cursor];
      const lastNode = nodes[last];
      if (!firstNode || !lastNode) continue;
      const range = row.ownerDocument.createRange();
      range.setStart(firstNode.node, start - firstNode.start);
      range.setEnd(lastNode.node, end - lastNode.start);
      ranges.push(range);
      if (ranges.length === limit) return ranges;
    }
  }
  return ranges;
}

/** Highlight mounted text ranges without rewriting Pierre's syntax-token DOM. */
export function createSearchHighlights(name: string) {
  let host: HTMLElement | undefined;
  const clear = () => {
    if (typeof CSS !== "undefined" && CSS.highlights) CSS.highlights.delete(name);
  };
  const refresh = (query: string, options: SearchHighlightOptions = {}) => {
    clear();
    if (!host || !query.trim() || typeof Highlight === "undefined" || !CSS.highlights) return;
    const root = host.shadowRoot ?? host;
    const ranges = searchRanges(root.querySelectorAll("[data-line]"), query, options);
    if (ranges.length) CSS.highlights.set(name, new Highlight(...ranges));
  };
  return {
    refresh,
    update(node: HTMLElement, query: string, options?: SearchHighlightOptions) {
      host = node;
      refresh(query, options);
    },
    dispose() {
      host = undefined;
      clear();
    },
  };
}
