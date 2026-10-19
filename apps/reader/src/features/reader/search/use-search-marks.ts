import type {
  ChapterCanonicalText,
  ResolvedSpread,
  ResolvedSpreadWindow,
} from "@/lib/pagination-v2";
import { useLayoutEffect, useMemo, type RefObject } from "react";
import {
  collectSearchRanges,
  paintSearchRanges,
  type SearchMarkMatch,
  type SearchMarkSource,
} from "./search-marks";
import { chapterBlockRanges } from "./search-text";
import type { ReaderSearchResult } from "./use-reader-search";

const blockRangesByText = new WeakMap<
  ChapterCanonicalText,
  ReadonlyMap<string, { start: number; end: number }>
>();

function blockRanges(text: ChapterCanonicalText) {
  let ranges = blockRangesByText.get(text);
  if (!ranges) {
    ranges = new Map(
      chapterBlockRanges({
        fullText: text.fullText,
        blockStarts: [...text.blockStarts],
      }).map(({ blockId, start, end }) => [blockId, { start, end }]),
    );
    blockRangesByText.set(text, ranges);
  }
  return ranges;
}

/**
 * Marks the matches on the pages in view, the active one more strongly,
 * after each new spread is in the page and before it paints.
 */
export function useSearchMarks({
  enabled,
  containerRef,
  spread,
  spreadWindow,
  results,
  activeId,
  getCanonicalText,
  contentKey,
}: {
  enabled: boolean;
  containerRef: RefObject<HTMLElement | null>;
  spread: ResolvedSpread | null;
  spreadWindow: ResolvedSpreadWindow | null;
  results: ReaderSearchResult[];
  activeId: string | null;
  getCanonicalText: (chapterIndex: number) => ChapterCanonicalText | null;
  /** Changes when the view mounts other text, as scroll mode does. */
  contentKey: string;
}) {
  const byBlock = useMemo(() => {
    const map = new Map<string, SearchMarkMatch[]>();
    for (const result of results) {
      const key = `${result.chapterIndex}:${result.blockId}`;
      const matches = map.get(key) ?? [];
      matches.push(result);
      map.set(key, matches);
    }
    return map;
  }, [results]);

  useLayoutEffect(() => {
    const root = containerRef.current;
    if (!enabled || !root || !byBlock.size) {
      paintSearchRanges({ all: [], active: [] });
      return;
    }
    const source: SearchMarkSource = {
      getChapterText(chapterIndex) {
        const text = getCanonicalText(chapterIndex);
        return text
          ? { fullText: text.fullText, blockRanges: blockRanges(text) }
          : null;
      },
      matchesFor: (chapterIndex, blockId) =>
        byBlock.get(`${chapterIndex}:${blockId}`) ?? [],
    };
    paintSearchRanges(collectSearchRanges(root, source, activeId));
  }, [
    activeId,
    byBlock,
    containerRef,
    contentKey,
    enabled,
    getCanonicalText,
    spread,
    spreadWindow,
  ]);

  useLayoutEffect(() => () => paintSearchRanges({ all: [], active: [] }), []);
}
