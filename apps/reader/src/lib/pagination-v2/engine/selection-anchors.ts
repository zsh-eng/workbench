import {
  CONTENT_ANCHOR_BLOCK_ID_ATTR,
  CONTENT_ANCHOR_END_ATTR,
  CONTENT_ANCHOR_START_ATTR,
  parseTextCursorOffset,
} from "../content-anchor-dom";
import {
  textSlicesOf,
  type PageFragment,
  type PreparedBlock,
  type PreparedTextItem,
} from "../shared/types";
import type { ContentAnchor, ResolvedSpread } from "../types";

interface ResolvedEndpointBoundary {
  blockId: string;
  fragmentStart: NonNullable<PageFragment["anchorStart"]>;
  fragmentEnd: NonNullable<PageFragment["anchorEnd"]>;
  localTextOffset: number;
}

interface MatchedSpreadFragment {
  chapterIndex: number;
  fragment: PageFragment;
}

type BoundaryFallbackBias = "forward" | "backward";

const graphemeSegmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

function compareOffsets(
  a: NonNullable<PageFragment["anchorStart"]>,
  b: NonNullable<PageFragment["anchorStart"]>,
): number {
  if (a.itemIndex !== b.itemIndex) return a.itemIndex < b.itemIndex ? -1 : 1;
  if (a.segmentIndex !== b.segmentIndex) {
    return a.segmentIndex < b.segmentIndex ? -1 : 1;
  }
  if (a.graphemeIndex !== b.graphemeIndex) {
    return a.graphemeIndex < b.graphemeIndex ? -1 : 1;
  }
  return 0;
}

function offsetsMatch(
  a: NonNullable<PageFragment["anchorStart"]> | undefined,
  b: NonNullable<PageFragment["anchorStart"]> | undefined,
): boolean {
  return !!a && !!b && compareOffsets(a, b) === 0;
}

function isElement(node: Node): node is Element {
  return node.nodeType === Node.ELEMENT_NODE;
}

function isFragmentAnchorElement(element: Element): boolean {
  return (
    element.hasAttribute(CONTENT_ANCHOR_START_ATTR) &&
    element.hasAttribute(CONTENT_ANCHOR_END_ATTR)
  );
}

function isBlockAnchorElement(element: Element): boolean {
  return element.hasAttribute(CONTENT_ANCHOR_BLOCK_ID_ATTR);
}

function closestFragmentAnchorElement(node: Node | null): Element | null {
  let current: Node | null = node;
  while (current) {
    if (isElement(current) && isFragmentAnchorElement(current)) {
      return current;
    }
    current = current.parentNode;
  }
  return null;
}

function closestBlockAnchorElement(node: Node | null): Element | null {
  let current: Node | null = node;
  while (current) {
    if (isElement(current) && isBlockAnchorElement(current)) {
      return current;
    }
    current = current.parentNode;
  }
  return null;
}

function findFirstFragmentAnchorElement(node: Node | null): Element | null {
  if (!node) return null;
  if (isElement(node) && isFragmentAnchorElement(node)) return node;

  for (const child of Array.from(node.childNodes)) {
    const match = findFirstFragmentAnchorElement(child);
    if (match) return match;
  }

  return null;
}

function findLastFragmentAnchorElement(node: Node | null): Element | null {
  if (!node) return null;
  if (isElement(node) && isFragmentAnchorElement(node)) return node;

  const children = Array.from(node.childNodes);
  for (let index = children.length - 1; index >= 0; index--) {
    const match = findLastFragmentAnchorElement(children[index] ?? null);
    if (match) return match;
  }

  return null;
}

function findPreviousFragmentAnchorElementFromBoundary(
  node: Node,
  offset: number,
): Element | null {
  if (isElement(node)) {
    const clampedOffset = Math.max(0, Math.min(offset, node.childNodes.length));
    for (let index = clampedOffset - 1; index >= 0; index--) {
      const match = findLastFragmentAnchorElement(
        node.childNodes[index] ?? null,
      );
      if (match) return match;
    }
  }

  let current: Node | null = node;
  while (current) {
    const parent: Node | null = current.parentNode;
    if (!parent) break;

    const siblings = Array.from(parent.childNodes) as Node[];
    const currentIndex = siblings.indexOf(current);

    for (let index = currentIndex - 1; index >= 0; index--) {
      const match = findLastFragmentAnchorElement(siblings[index] ?? null);
      if (match) return match;
    }

    current = parent;
  }

  return null;
}

function findNextFragmentAnchorElementFromBoundary(
  node: Node,
  offset: number,
): Element | null {
  if (isElement(node)) {
    const clampedOffset = Math.max(0, Math.min(offset, node.childNodes.length));
    for (let index = clampedOffset; index < node.childNodes.length; index++) {
      const match = findFirstFragmentAnchorElement(
        node.childNodes[index] ?? null,
      );
      if (match) return match;
    }
  }

  let current: Node | null = node;
  while (current) {
    const parent: Node | null = current.parentNode;
    if (!parent) break;

    const siblings = Array.from(parent.childNodes) as Node[];
    const currentIndex = siblings.indexOf(current);

    for (let index = currentIndex + 1; index < siblings.length; index++) {
      const match = findFirstFragmentAnchorElement(siblings[index] ?? null);
      if (match) return match;
    }

    current = parent;
  }

  return null;
}

function resolveBoundaryFragmentElement(
  node: Node,
  offset: number,
  fallbackBias?: BoundaryFallbackBias,
): { fragmentElement: Element; localTextOffset: number } | null {
  const directFragment = closestFragmentAnchorElement(node);
  if (directFragment) {
    return {
      fragmentElement: directFragment,
      localTextOffset: getTextOffsetWithinElement(directFragment, node, offset),
    };
  }

  if (!isElement(node)) return null;

  const childCount = node.childNodes.length;
  const clampedOffset = Math.max(0, Math.min(offset, childCount));

  const leftCandidate =
    clampedOffset > 0
      ? findLastFragmentAnchorElement(
          node.childNodes[clampedOffset - 1] ?? null,
        )
      : null;
  if (leftCandidate) {
    return {
      fragmentElement: leftCandidate,
      localTextOffset: leftCandidate.textContent?.length ?? 0,
    };
  }

  const rightCandidate =
    clampedOffset < childCount
      ? findFirstFragmentAnchorElement(node.childNodes[clampedOffset] ?? null)
      : null;
  if (rightCandidate) {
    return {
      fragmentElement: rightCandidate,
      localTextOffset: 0,
    };
  }

  if (fallbackBias === "backward") {
    const previousCandidate = findPreviousFragmentAnchorElementFromBoundary(
      node,
      offset,
    );
    if (previousCandidate) {
      return {
        fragmentElement: previousCandidate,
        localTextOffset: previousCandidate.textContent?.length ?? 0,
      };
    }
  }

  if (fallbackBias === "forward") {
    const nextCandidate = findNextFragmentAnchorElementFromBoundary(
      node,
      offset,
    );
    if (nextCandidate) {
      return {
        fragmentElement: nextCandidate,
        localTextOffset: 0,
      };
    }
  }

  return null;
}

function getTextOffsetWithinElement(
  element: Element,
  targetNode: Node,
  targetOffset: number,
): number {
  try {
    const range = document.createRange();
    range.selectNodeContents(element);
    range.setEnd(targetNode, targetOffset);
    return range.toString().length;
  } catch {
    return 0;
  }
}

function getSegmentGraphemes(text: string): string[] {
  if (!graphemeSegmenter) return Array.from(text);
  return Array.from(
    graphemeSegmenter.segment(text),
    (segment) => segment.segment,
  );
}

function nextCursorInItem(
  itemIndex: number,
  item: PreparedTextItem,
  cursor: NonNullable<PageFragment["anchorStart"]>,
): {
  next: NonNullable<PageFragment["anchorStart"]>;
  text: string;
} | null {
  const segmentText = item.prepared.segments[cursor.segmentIndex];
  if (segmentText === undefined) return null;

  const graphemes = getSegmentGraphemes(segmentText);
  if (graphemes.length === 0) return null;

  if (cursor.graphemeIndex > 0 || graphemes.length > 1) {
    const grapheme = graphemes[cursor.graphemeIndex];
    if (grapheme === undefined) return null;

    const nextGraphemeIndex = cursor.graphemeIndex + 1;
    return {
      text: grapheme,
      next:
        nextGraphemeIndex < graphemes.length
          ? {
              itemIndex,
              segmentIndex: cursor.segmentIndex,
              graphemeIndex: nextGraphemeIndex,
            }
          : {
              itemIndex,
              segmentIndex: cursor.segmentIndex + 1,
              graphemeIndex: 0,
            },
    };
  }

  return {
    text: segmentText,
    next: {
      itemIndex,
      segmentIndex: cursor.segmentIndex + 1,
      graphemeIndex: 0,
    },
  };
}

function resolveOffsetWithinPreparedItem(
  item: PreparedTextItem,
  start: NonNullable<PageFragment["anchorStart"]>,
  end: NonNullable<PageFragment["anchorEnd"]>,
  localTextOffset: number,
): NonNullable<PageFragment["anchorStart"]> {
  if (compareOffsets(start, end) >= 0 || localTextOffset <= 0) {
    return { ...start };
  }

  let remaining = localTextOffset;
  let cursor = { ...start };

  while (compareOffsets(cursor, end) < 0) {
    const step = nextCursorInItem(start.itemIndex, item, cursor);
    if (!step) {
      return { ...end };
    }

    remaining -= step.text.length;
    cursor = step.next;
    if (remaining <= 0) {
      return compareOffsets(cursor, end) > 0 ? { ...end } : cursor;
    }
  }

  return { ...end };
}

function resolveEndpointBoundary(
  node: Node,
  offset: number,
  fallbackBias?: BoundaryFallbackBias,
): ResolvedEndpointBoundary | null {
  const fragmentBoundary = resolveBoundaryFragmentElement(
    node,
    offset,
    fallbackBias,
  );
  if (!fragmentBoundary) return null;

  const { fragmentElement, localTextOffset } = fragmentBoundary;
  const blockElement = closestBlockAnchorElement(fragmentElement);
  const blockId = blockElement
    ?.getAttribute(CONTENT_ANCHOR_BLOCK_ID_ATTR)
    ?.trim();
  if (!blockId) return null;

  const fragmentStart = parseTextCursorOffset(
    fragmentElement.getAttribute(CONTENT_ANCHOR_START_ATTR),
  );
  const fragmentEnd = parseTextCursorOffset(
    fragmentElement.getAttribute(CONTENT_ANCHOR_END_ATTR),
  );
  if (!fragmentStart || !fragmentEnd) return null;

  return {
    blockId,
    fragmentStart,
    fragmentEnd,
    localTextOffset,
  };
}

function matchSpreadFragment(
  spread: ResolvedSpread,
  boundary: ResolvedEndpointBoundary,
): MatchedSpreadFragment | null {
  for (const slot of spread.slots) {
    if (slot.kind !== "page") continue;

    for (const slice of textSlicesOf(slot.page.content)) {
      if (slice.blockId !== boundary.blockId) continue;

      for (const line of slice.lines) {
        for (const fragment of line.fragments) {
          if (
            offsetsMatch(fragment.anchorStart, boundary.fragmentStart) &&
            offsetsMatch(fragment.anchorEnd, boundary.fragmentEnd)
          ) {
            return {
              chapterIndex: slot.page.chapterIndex,
              fragment,
            };
          }
        }
      }
    }
  }

  return null;
}

function findPreparedTextBlock(
  prepared: PreparedBlock[] | null,
  blockId: string,
): Extract<PreparedBlock, { type: "text" }> | null {
  if (!prepared) return null;

  for (const block of prepared) {
    if (block.type === "text" && block.id === blockId) {
      return block;
    }
  }

  return null;
}

export function resolveDomEndpointToContentAnchor(options: {
  node: Node;
  offset: number;
  spread: ResolvedSpread;
  preparedByChapter: (PreparedBlock[] | null)[];
  fallbackBias?: BoundaryFallbackBias;
}): ContentAnchor | null {
  const { node, offset, spread, preparedByChapter, fallbackBias } = options;

  const boundary = resolveEndpointBoundary(node, offset, fallbackBias);
  if (!boundary) return null;

  const match = matchSpreadFragment(spread, boundary);
  if (!match) return null;

  const textBlock = findPreparedTextBlock(
    preparedByChapter[match.chapterIndex] ?? null,
    boundary.blockId,
  );
  if (!textBlock) return null;

  const item = textBlock.items[boundary.fragmentStart.itemIndex];
  if (!item) return null;

  const preciseOffset = resolveOffsetWithinPreparedItem(
    item,
    boundary.fragmentStart,
    boundary.fragmentEnd,
    boundary.localTextOffset,
  );

  return {
    type: "text",
    chapterIndex: match.chapterIndex,
    blockId: boundary.blockId,
    offset: preciseOffset,
  };
}
