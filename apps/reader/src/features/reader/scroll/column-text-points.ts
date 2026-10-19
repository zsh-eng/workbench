import { alignSlice, type SliceText } from "../search/search-marks";
import type { TextBlockRange } from "./page-break-continuation";

export interface DomPoint {
  node: Node;
  offset: number;
}

export interface ChapterTextSource {
  fullText: string;
  blocks: readonly TextBlockRange[];
}

/**
 * Canonical offsets to DOM positions in a scroll column (or any container
 * of rendered slices), through the same character alignment search marks
 * use. Only mounted rows can be found.
 */
export function createColumnTextPoints(
  container: Element,
  text: ChapterTextSource,
) {
  const blockById = new Map(text.blocks.map((block) => [block.blockId, block]));
  const slices = [
    ...container.querySelectorAll<HTMLElement>(
      "[data-scroll-row-index] > [data-reader-page-slice], [data-reader-page-content] > [data-reader-page-slice]",
    ),
  ];
  const aligned: SliceText[] = [];
  slices.forEach((slice, index) => {
    const blockId = slice.dataset.readerBlockId;
    const block = blockId ? blockById.get(blockId) : undefined;
    if (!block || slice.dataset.readerSliceType !== "text") return;
    const page = (element: HTMLElement) =>
      element.parentElement?.dataset.pageIndex;
    const startsPage = index === 0 || page(slice) !== page(slices[index - 1]!);
    const result = alignSlice(
      slice,
      text.fullText.slice(block.start, block.end),
      block.start,
      startsPage,
    );
    if (result) aligned.push(result);
  });

  return {
    /** Where the character at `offset` starts. */
    start(offset: number): DomPoint | null {
      for (const slice of aligned) {
        if (offset >= slice.end) continue;
        const range = slice.rangeFor(Math.max(offset, slice.start), slice.end);
        if (range)
          return { node: range.startContainer, offset: range.startOffset };
      }
      return null;
    },
    /** Where the character before `offset` ends. */
    end(offset: number): DomPoint | null {
      for (let index = aligned.length - 1; index >= 0; index--) {
        const slice = aligned[index]!;
        if (offset <= slice.start) continue;
        const range = slice.rangeFor(slice.start, Math.min(offset, slice.end));
        if (range) return { node: range.endContainer, offset: range.endOffset };
      }
      return null;
    },
  };
}

/** Offsets just after each word of `[from, to)`, in reading order. */
export function wordEnds(fullText: string, from: number, to: number): number[] {
  const ends: number[] = [];
  for (const match of fullText.slice(from, to).matchAll(/\S+/g)) {
    ends.push(from + (match.index ?? 0) + match[0].length);
  }
  return ends;
}

/** Offsets at the start of each word of `[from, to)`, nearest `to` first. */
export function wordStartsBackward(
  fullText: string,
  from: number,
  to: number,
): number[] {
  const starts: number[] = [];
  for (const match of fullText.slice(from, to).matchAll(/\S+/g)) {
    starts.push(from + (match.index ?? 0));
  }
  return starts.reverse();
}
