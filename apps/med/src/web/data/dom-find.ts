import { useEffect } from "react";
import { highlightRules } from "../code-colors";
import { useTheme } from "../themes";

const MAX_MATCHES = 1000;
const BLOCK_SELECTOR =
  "p, li, div, h1, h2, h3, h4, h5, h6, td, th, pre, blockquote, dt, dd, figcaption, summary, article, section";
const DEFAULT_SKIP =
  ".katex-mathml, script, style, noscript, svg, .med-md-copy, .med-md-copy-note, [data-find-ignore]";

interface TextSpan {
  node: Text;
  start: number;
  end: number;
}

/** Collects DOM `Range` matches inside one or more root containers, respecting block boundaries
 * and skipping non-visible or non-prose subtrees (e.g. KaTeX's hidden MathML). */
export function textRangesIn(
  containers: Iterable<Element>,
  pattern: RegExp,
  options: { skip?: string; limit?: number } = {},
): Range[] {
  const skip = options.skip ?? DEFAULT_SKIP;
  const limit = options.limit ?? MAX_MATCHES;
  const ranges: Range[] = [];

  for (const container of containers) {
    const spans: TextSpan[] = [];
    const parts: string[] = [];
    let offset = 0;
    let lastBlock: Element | null = null;
    const walker = container.ownerDocument.createTreeWalker(container, NodeFilter.SHOW_TEXT);

    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      if (!node.length) continue;
      const parent = node.parentElement;
      if (!parent || parent.closest(skip)) continue;
      const block = parent.closest(BLOCK_SELECTOR);
      if (lastBlock && block !== lastBlock) {
        parts.push("\0");
        offset += 1;
      }
      lastBlock = block;
      const value = node.data;
      spans.push({ node, start: offset, end: offset + value.length });
      parts.push(value);
      offset += value.length;
    }

    if (!spans.length) continue;
    const joined = parts.join("");
    const re = new RegExp(pattern.source, pattern.flags);
    let cursor = 0;

    for (const match of joined.matchAll(re)) {
      const start = match.index;
      const end = start + match[0].length;
      if (end === start) continue;
      // Ignore matches that bridge across a virtual block separator.
      if (match[0].includes("\0")) continue;
      while (cursor < spans.length && spans[cursor]!.end <= start) cursor++;
      let last = cursor;
      while (last < spans.length && spans[last]!.end < end) last++;
      const firstSpan = spans[cursor];
      const lastSpan = spans[last];
      if (!firstSpan || !lastSpan) continue;
      const range = container.ownerDocument.createRange();
      range.setStart(firstSpan.node, Math.max(0, start - firstSpan.start));
      range.setEnd(lastSpan.node, Math.min(lastSpan.node.length, end - lastSpan.start));
      ranges.push(range);
      if (ranges.length >= limit) return ranges;
    }
  }
  return ranges;
}

const highlightOwners = new Map<string, symbol>();

/** Applies CSS Custom Highlight API ranges for all matches and the active match,
 * claiming ownership so hidden warm workspaces do not clear the visible pane's highlights. */
export function applyDomHighlights(
  matchName: string,
  currentName: string,
  ranges: readonly Range[],
  currentRange: Range | null | undefined,
  owner?: symbol,
) {
  if (typeof CSS === "undefined" || !CSS.highlights || typeof Highlight === "undefined") return;
  if (owner) {
    highlightOwners.set(matchName, owner);
    highlightOwners.set(currentName, owner);
  }
  if (ranges.length) CSS.highlights.set(matchName, new Highlight(...ranges));
  else CSS.highlights.delete(matchName);
  if (currentRange) CSS.highlights.set(currentName, new Highlight(currentRange));
  else CSS.highlights.delete(currentName);
}

/** Clears CSS Custom Highlight API entries when `owner` still owns them (or unconditionally if omitted). */
export function clearDomHighlights(matchName: string, currentName: string, owner?: symbol) {
  if (typeof CSS === "undefined" || !CSS.highlights) return;
  if (!owner || highlightOwners.get(matchName) === owner) {
    highlightOwners.delete(matchName);
    CSS.highlights.delete(matchName);
  }
  if (!owner || highlightOwners.get(currentName) === owner) {
    highlightOwners.delete(currentName);
    CSS.highlights.delete(currentName);
  }
}

/** Keeps light-DOM `::highlight(...)` rules synced to the active Med theme. */
export function useFindHighlightStyle(
  active: boolean,
  id: string,
  names: { match: string; current: string },
) {
  const { active: theme } = useTheme();
  const { match, current } = names;
  useEffect(() => {
    if (!active) return;
    let style = document.head.querySelector<HTMLStyleElement>(`style[data-med-find="${id}"]`);
    if (!style) {
      style = document.createElement("style");
      style.dataset.medFind = id;
      document.head.append(style);
    }
    style.textContent = highlightRules(theme, { match, current });
  }, [active, id, theme, match, current]);
}

/** Scrolls only `pane` (never ancestor split panes) to bring `range` comfortably into view. */
export function scrollRangeIntoPane(
  pane: HTMLElement,
  range: Range,
  paddingTop = 64,
  paddingBottom = 36,
) {
  const rect = range.getBoundingClientRect();
  if (!rect.width && !rect.height) return;
  const host = pane.getBoundingClientRect();
  const visibleTop = host.top + paddingTop;
  const visibleBottom = host.bottom - paddingBottom;
  if (rect.top >= visibleTop && rect.bottom <= visibleBottom) return;
  const targetOffset = (pane.clientHeight - paddingTop - paddingBottom) * 0.35 + paddingTop;
  const nextTop = pane.scrollTop + (rect.top - host.top) - targetOffset;
  pane.scrollTop = Math.max(0, Math.min(nextTop, pane.scrollHeight - pane.clientHeight));
}
