/** A paragraph's slice, or a table cell's text, which is its own paragraph. */
const TEXT_SLICE_SELECTOR =
  "p[data-reader-block-id], .reader-table-cell-text[data-reader-block-id]";

function getSlices(page: Element): HTMLElement[] {
  return [
    ...page.querySelectorAll<HTMLElement>(":scope > [data-reader-page-slice]"),
  ];
}

function isSameParagraph(
  slice: HTMLElement | undefined,
  blockId: string,
): slice is HTMLElement {
  return (
    !!slice?.matches(TEXT_SLICE_SELECTOR) &&
    slice.dataset.readerBlockId === blockId
  );
}

/**
 * The pieces of the paragraph at `node` that the spread shows. A paragraph
 * that runs over a page break is the last slice of one page and the first
 * of the next.
 */
export function findParagraphSlices(node: Node): HTMLElement[] {
  const element = node instanceof Element ? node : node.parentElement;
  const slice = element?.closest<HTMLElement>(TEXT_SLICE_SELECTOR);
  const spread = slice?.closest("[data-reader-spread-layer]");
  const blockId = slice?.dataset.readerBlockId;
  if (!slice || !spread || !blockId) return [];

  const pages = [...spread.querySelectorAll("[data-reader-page-content]")].map(
    getSlices,
  );
  const pageIndex = pages.findIndex((slices) => slices.includes(slice));
  if (pageIndex < 0) return [slice];

  const paragraph = [slice];
  for (let index = pageIndex; index > 0; index--) {
    const previous = pages[index - 1]!.at(-1);
    if (
      pages[index]![0] !== paragraph[0] ||
      !isSameParagraph(previous, blockId)
    )
      break;
    paragraph.unshift(previous);
  }
  for (let index = pageIndex; index < pages.length - 1; index++) {
    const next = pages[index + 1]![0];
    if (
      pages[index]!.at(-1) !== paragraph.at(-1) ||
      !isSameParagraph(next, blockId)
    )
      break;
    paragraph.push(next);
  }
  return paragraph;
}

function textNodes(root: Node): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (node.data.trim()) nodes.push(node);
  }
  return nodes;
}

/**
 * Selects the whole paragraph around the selection, across inline markup and
 * a page break the spread shows. The page draws each line with a line break,
 * so a browser's own triple-click selects just one line.
 */
export function selectParagraph(selection: Selection): boolean {
  const anchor = selection.anchorNode;
  const slices = anchor ? findParagraphSlices(anchor) : [];
  const first = slices[0] ? textNodes(slices[0])[0] : undefined;
  const last = slices.at(-1) ? textNodes(slices.at(-1)!).at(-1) : undefined;
  if (!first || !last) return false;

  const range = document.createRange();
  range.setStart(first, 0);
  range.setEnd(last, last.length);
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}
