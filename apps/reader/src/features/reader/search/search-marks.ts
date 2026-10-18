import type { TextMatch } from "./search-text";

/**
 * Marks search matches on the pages in view with the CSS Custom Highlight
 * API, which paints ranges without touching the page's DOM.
 *
 * A match is a range of canonical chapter text. The page draws a paragraph
 * as lines, drops the space where a line wraps, collapses runs of spaces and
 * adds a hyphen where it breaks a word at a soft hyphen. Everything else is
 * the canonical text in order, so the two line up character by character.
 */

export const SEARCH_HIGHLIGHT = "reader-search";
export const ACTIVE_SEARCH_HIGHLIGHT = "reader-search-active";

const SKIPPED = /[\s­​-‍⁠﻿]/;
const HYPHENS = /[-‐]/;

export interface SearchMarkMatch extends TextMatch {
  id: string;
}

export interface SliceText {
  /** Canonical offsets of the slice's first and last-plus-one characters. */
  start: number;
  end: number;
  /** The DOM position of a canonical offset the slice draws. */
  rangeFor: (start: number, end: number) => Range | null;
}

function strip(text: string): { text: string; indices: number[] } {
  let stripped = "";
  const indices: number[] = [];
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (SKIPPED.test(char) || HYPHENS.test(char)) continue;
    stripped += char;
    indices.push(index);
  }
  return { text: stripped, indices };
}

/**
 * Lines a text slice up with its block's canonical text. `blockText` runs
 * from `blockStart`. A slice that starts a page may be the end of a
 * paragraph from the page before, so it is placed from the end first.
 */
export function alignSlice(
  slice: Element,
  blockText: string,
  blockStart: number,
  startsPage: boolean,
): SliceText | null {
  const nodes: Text[] = [];
  const nodeStarts: number[] = [];
  let rendered = "";
  const walker = slice.ownerDocument.createTreeWalker(
    slice,
    NodeFilter.SHOW_TEXT,
  );
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    nodes.push(node);
    nodeStarts.push(rendered.length);
    rendered += node.data;
  }

  const canonical = strip(blockText);
  const drawn = strip(rendered).text;
  if (!drawn) return null;
  const position =
    startsPage && canonical.text.endsWith(drawn)
      ? canonical.text.length - drawn.length
      : canonical.text.startsWith(drawn)
        ? 0
        : canonical.text.indexOf(drawn);
  if (position < 0) return null;

  // Canonical index → rendered index, for the characters the slice draws.
  const first = canonical.indices[position]!;
  const drawnAt = new Map<number, number>();
  let canonicalIndex = first;
  let renderedIndex = 0;
  let last = first;
  while (canonicalIndex < blockText.length && renderedIndex < rendered.length) {
    const char = blockText[canonicalIndex]!;
    const drawnChar = rendered[renderedIndex]!;
    if (SKIPPED.test(char)) {
      canonicalIndex++;
    } else if (/\s/.test(drawnChar)) {
      renderedIndex++;
    } else if (char === drawnChar) {
      drawnAt.set(canonicalIndex, renderedIndex);
      last = canonicalIndex;
      canonicalIndex++;
      renderedIndex++;
    } else if (HYPHENS.test(drawnChar)) {
      // The hyphen at a soft-hyphen break.
      renderedIndex++;
    } else {
      break;
    }
  }

  const point = (index: number): [Text, number] => {
    let low = 0;
    let high = nodeStarts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (nodeStarts[middle]! <= index) low = middle;
      else high = middle - 1;
    }
    return [nodes[low]!, index - nodeStarts[low]!];
  };

  return {
    start: blockStart + first,
    end: blockStart + last + 1,
    rangeFor(start, end) {
      let from = Math.max(start - blockStart, first);
      let to = Math.min(end - blockStart, last + 1) - 1;
      while (from <= to && !drawnAt.has(from)) from++;
      while (to >= from && !drawnAt.has(to)) to--;
      if (from > to) return null;
      const range = slice.ownerDocument.createRange();
      range.setStart(...point(drawnAt.get(from)!));
      const [endNode, endOffset] = point(drawnAt.get(to)!);
      range.setEnd(endNode, endOffset + 1);
      return range;
    },
  };
}

export interface SearchMarkSource {
  /** The canonical text and block starts of a chapter, once loaded. */
  getChapterText: (chapterIndex: number) => {
    fullText: string;
    blockRanges: ReadonlyMap<string, { start: number; end: number }>;
  } | null;
  /** Matches by chapter and block. */
  matchesFor: (chapterIndex: number, blockId: string) => SearchMarkMatch[];
}

/** Ranges for every match drawn under `root`, and for the active one. */
export function collectSearchRanges(
  root: Element,
  source: SearchMarkSource,
  activeId: string | null,
): { all: Range[]; active: Range[] } {
  const all: Range[] = [];
  const active: Range[] = [];
  for (const page of root.querySelectorAll<HTMLElement>(
    "[data-reader-chapter-index]",
  )) {
    const chapterIndex = Number(page.dataset.readerChapterIndex);
    const text = source.getChapterText(chapterIndex);
    if (!text) continue;
    const slices = [
      ...page.querySelectorAll<HTMLElement>(
        "[data-reader-page-content] > [data-reader-page-slice]",
      ),
    ];
    slices.forEach((slice, sliceIndex) => {
      const blockId = slice.dataset.readerBlockId;
      if (!blockId || slice.dataset.readerSliceType !== "text") return;
      const matches = source.matchesFor(chapterIndex, blockId);
      const block = text.blockRanges.get(blockId);
      if (!matches.length || !block) return;
      const aligned = alignSlice(
        slice,
        text.fullText.slice(block.start, block.end),
        block.start,
        sliceIndex === 0,
      );
      if (!aligned) return;
      for (const match of matches) {
        if (match.end <= aligned.start || match.start >= aligned.end) continue;
        const range = aligned.rangeFor(match.start, match.end);
        if (!range) continue;
        (match.id === activeId ? active : all).push(range);
      }
    });
  }
  return { all, active };
}

/** Paints the ranges, or clears the marks when given none. */
export function paintSearchRanges(ranges: { all: Range[]; active: Range[] }) {
  if (typeof CSS === "undefined" || !("highlights" in CSS)) return;
  const registry = CSS.highlights;
  if (ranges.all.length)
    registry.set(SEARCH_HIGHLIGHT, new Highlight(...ranges.all));
  else registry.delete(SEARCH_HIGHLIGHT);
  if (ranges.active.length)
    registry.set(ACTIVE_SEARCH_HIGHLIGHT, new Highlight(...ranges.active));
  else registry.delete(ACTIVE_SEARCH_HIGHLIGHT);
}
