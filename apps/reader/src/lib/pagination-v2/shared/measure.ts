import {
  layoutNextLine,
  prepareWithSegments,
  type PreparedTextWithSegments,
} from "@chenglou/pretext";
import type { LayoutCursor } from "@chenglou/pretext";

export const LINE_START_CURSOR: LayoutCursor = {
  segmentIndex: 0,
  graphemeIndex: 0,
};
const UNBOUNDED_WIDTH = 100_000;

const collapsedSpaceWidthCache = new Map<string, number>();
const measuredTextWidthCache = new Map<string, number>();

export function measureSingleLineWidth(
  prepared: PreparedTextWithSegments,
): number {
  const line = layoutNextLine(prepared, LINE_START_CURSOR, UNBOUNDED_WIDTH);
  return line?.width ?? 0;
}

export function measureCollapsedSpaceWidth(font: string): number {
  const cached = collapsedSpaceWidthCache.get(font);
  if (cached !== undefined) return cached;

  const joined = measureTextWidth("A A", font);
  const compact = measureTextWidth("AA", font);
  const width = Math.max(0, joined - compact);
  collapsedSpaceWidthCache.set(font, width);
  return width;
}

export function measureTextWidth(text: string, font: string): number {
  const cacheKey = `${font}\n${text}`;
  const cached = measuredTextWidthCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const width = measureSingleLineWidth(prepareWithSegments(text, font));
  measuredTextWidthCache.set(cacheKey, width);
  return width;
}

const graphemeSegmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

export function countGraphemes(text: string): number {
  if (!graphemeSegmenter) return Array.from(text).length;
  let count = 0;
  for (const _ of graphemeSegmenter.segment(text)) count++;
  return count;
}

/** The first `graphemeCount` graphemes of `text`, in UTF-16 code units. */
export function graphemePrefixLength(
  text: string,
  graphemeCount: number,
): number {
  if (graphemeCount <= 0) return 0;
  if (!graphemeSegmenter) {
    return Array.from(text).slice(0, graphemeCount).join("").length;
  }
  let count = 0;
  for (const { index } of graphemeSegmenter.segment(text)) {
    if (count === graphemeCount) return index;
    count++;
  }
  return text.length;
}

export function clearMeasureCache(): void {
  collapsedSpaceWidthCache.clear();
  measuredTextWidthCache.clear();
}

export function cursorsMatch(a: LayoutCursor, b: LayoutCursor): boolean {
  return (
    a.segmentIndex === b.segmentIndex && a.graphemeIndex === b.graphemeIndex
  );
}
