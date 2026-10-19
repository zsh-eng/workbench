import {
  CONTENT_ANCHOR_BLOCK_ID_ATTR,
  CONTENT_ANCHOR_END_ATTR,
  CONTENT_ANCHOR_START_ATTR,
} from "@/lib/pagination-v2/content-anchor-dom";

/**
 * One selection endpoint, named by the rendered fragment that holds it.
 *
 * Pages and the scroll column render the same line fragments, each tagged
 * with its block and its start and end content offsets. That triple names a
 * fragment in either surface, so a selection made on a page can be selected
 * again in the column.
 */
export interface SelectionPoint {
  blockId: string;
  fragmentStart: string;
  fragmentEnd: string;
  /** Characters into the fragment's text. */
  textOffset: number;
}

export interface SelectionLocators {
  anchor: SelectionPoint;
  focus: SelectionPoint;
}

function fragmentElementOf(node: Node | null): Element | null {
  let current: Node | null = node;
  while (current) {
    if (
      current instanceof Element &&
      current.hasAttribute(CONTENT_ANCHOR_START_ATTR) &&
      current.hasAttribute(CONTENT_ANCHOR_END_ATTR)
    ) {
      return current;
    }
    current = current.parentNode;
  }
  return null;
}

function textOffsetWithin(element: Element, node: Node, offset: number) {
  const range = document.createRange();
  range.selectNodeContents(element);
  try {
    range.setEnd(node, offset);
  } catch {
    return 0;
  }
  return range.toString().length;
}

function capturePoint(
  node: Node | null,
  offset: number,
): SelectionPoint | null {
  if (!node) return null;
  const fragment = fragmentElementOf(node);
  const block = fragment?.closest(`[${CONTENT_ANCHOR_BLOCK_ID_ATTR}]`);
  const blockId = block?.getAttribute(CONTENT_ANCHOR_BLOCK_ID_ATTR);
  const fragmentStart = fragment?.getAttribute(CONTENT_ANCHOR_START_ATTR);
  const fragmentEnd = fragment?.getAttribute(CONTENT_ANCHOR_END_ATTR);
  if (!fragment || !blockId || !fragmentStart || !fragmentEnd) return null;
  return {
    blockId,
    fragmentStart,
    fragmentEnd,
    textOffset: textOffsetWithin(fragment, node, offset),
  };
}

/** Reads a selection inside `container` as fragment locators. */
export function captureSelection(
  container: Element,
  selection: Selection | null,
): SelectionLocators | null {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return null;
  }
  if (
    !selection.anchorNode ||
    !selection.focusNode ||
    !container.contains(selection.anchorNode) ||
    !container.contains(selection.focusNode)
  ) {
    return null;
  }
  const anchor = capturePoint(selection.anchorNode, selection.anchorOffset);
  const focus = capturePoint(selection.focusNode, selection.focusOffset);
  return anchor && focus ? { anchor, focus } : null;
}

function resolvePoint(
  container: Element,
  point: SelectionPoint,
): { node: Node; offset: number } | null {
  const selector =
    `[${CONTENT_ANCHOR_BLOCK_ID_ATTR}="${CSS.escape(point.blockId)}"] ` +
    `[${CONTENT_ANCHOR_START_ATTR}="${CSS.escape(point.fragmentStart)}"]` +
    `[${CONTENT_ANCHOR_END_ATTR}="${CSS.escape(point.fragmentEnd)}"]`;
  const fragment = container.querySelector(selector);
  if (!fragment) return null;

  const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_TEXT);
  let remaining = point.textOffset;
  let last: Text | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    last = text;
    if (remaining <= text.length) return { node: text, offset: remaining };
    remaining -= text.length;
  }
  return last ? { node: last, offset: last.length } : null;
}

/** Selects the same text in `container`. Returns whether it could. */
export function restoreSelection(
  container: Element,
  locators: SelectionLocators,
): boolean {
  const anchor = resolvePoint(container, locators.anchor);
  const focus = resolvePoint(container, locators.focus);
  const selection = window.getSelection();
  if (!anchor || !focus || !selection) return false;
  selection.removeAllRanges();
  selection.setBaseAndExtent(
    anchor.node,
    anchor.offset,
    focus.node,
    focus.offset,
  );
  return !selection.isCollapsed;
}
