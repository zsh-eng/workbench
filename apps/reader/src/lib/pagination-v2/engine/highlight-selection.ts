import type {
  Block,
  ChapterCanonicalText,
  PreparedBlock,
  PreparedTextBlock,
  PreparedTextItem,
  TextBlock,
  TextCursorOffset,
  TextRun,
} from "../shared/types";
import type { ContentAnchor } from "../types";

const DEFAULT_CONTEXT_LENGTH = 50;

const graphemeSegmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

export interface ResolvedHighlightSelection {
  chapterIndex: number;
  startOffset: number;
  endOffset: number;
  selectedText: string;
  textBefore: string;
  textAfter: string;
}

function isTextBlock(block: Block): block is TextBlock {
  return block.type === "text";
}

function getSegmentGraphemes(text: string): string[] {
  if (!graphemeSegmenter) return Array.from(text);
  return Array.from(
    graphemeSegmenter.segment(text),
    (segment) => segment.segment,
  );
}

function getPersistedRunText(blockTag: TextBlock["tag"], run: TextRun): string {
  return !run.hardBreak || blockTag === "pre" ? run.text : "";
}

function findPreparedTextBlock(
  preparedChapter: PreparedBlock[],
  blockId: string,
): PreparedTextBlock | null {
  for (const block of preparedChapter) {
    if (block.type === "text" && block.id === blockId) {
      return block;
    }
  }

  return null;
}

function normalizeRunText(
  blockTag: TextBlock["tag"],
  run: TextRun,
): {
  sourceText: string;
  preparedText: string;
  isPreformatted: boolean;
  isHardBreak: boolean;
} {
  const isPreformatted = blockTag === "pre";
  const sourceText = getPersistedRunText(blockTag, run).replace(/\u00a0/g, " ");
  const isHardBreak = !isPreformatted && run.hardBreak === true;
  const normalizedText =
    isPreformatted || isHardBreak
      ? run.text.replace(/\u00a0/g, " ")
      : sourceText.replace(/\s+/g, " ");
  const preparedText =
    isPreformatted || isHardBreak ? normalizedText : normalizedText.trim();

  return {
    sourceText,
    preparedText,
    isPreformatted,
    isHardBreak,
  };
}

function getPreparedBoundaryIndex(
  item: PreparedTextItem,
  cursor: TextCursorOffset,
): number | null {
  if (
    cursor.itemIndex < 0 ||
    cursor.segmentIndex < 0 ||
    cursor.graphemeIndex < 0
  ) {
    return null;
  }

  let boundaryIndex = 0;

  for (
    let segmentIndex = 0;
    segmentIndex < item.prepared.segments.length;
    segmentIndex++
  ) {
    const segment = item.prepared.segments[segmentIndex];
    if (segment === undefined) continue;

    if (segmentIndex < cursor.segmentIndex) {
      boundaryIndex += segment.length;
      continue;
    }

    if (segmentIndex > cursor.segmentIndex) {
      break;
    }

    const graphemes = getSegmentGraphemes(segment);
    const graphemeCount = Math.min(cursor.graphemeIndex, graphemes.length);
    for (let index = 0; index < graphemeCount; index++) {
      boundaryIndex += graphemes[index]?.length ?? 0;
    }
    return boundaryIndex;
  }

  if (cursor.segmentIndex === item.prepared.segments.length) {
    return boundaryIndex;
  }

  return null;
}

function buildCollapsedBoundaryMap(sourceText: string): number[] {
  const boundaries: number[] = [];
  const length = sourceText.length;
  let sourceIndex = 0;

  while (sourceIndex < length && /\s/.test(sourceText[sourceIndex] ?? "")) {
    sourceIndex += 1;
  }

  boundaries.push(sourceIndex);

  while (sourceIndex < length) {
    const char = sourceText[sourceIndex] ?? "";
    if (!/\s/.test(char)) {
      sourceIndex += 1;
      boundaries.push(sourceIndex);
      continue;
    }

    while (sourceIndex < length && /\s/.test(sourceText[sourceIndex] ?? "")) {
      sourceIndex += 1;
    }
    if (sourceIndex >= length) break;

    boundaries.push(sourceIndex);
  }

  return boundaries;
}

function resolvePreparedBoundaryToSourceOffset(options: {
  sourceText: string;
  preparedText: string;
  normalizedBoundaryIndex: number;
  isPreformatted: boolean;
  isHardBreak: boolean;
}): number {
  const {
    sourceText,
    preparedText,
    normalizedBoundaryIndex,
    isPreformatted,
    isHardBreak,
  } = options;

  const clampedBoundary = Math.max(
    0,
    Math.min(normalizedBoundaryIndex, preparedText.length),
  );

  if (isPreformatted || isHardBreak) {
    return Math.min(clampedBoundary, sourceText.length);
  }

  const boundaries = buildCollapsedBoundaryMap(sourceText);
  const mappedBoundary =
    boundaries[Math.min(clampedBoundary, boundaries.length - 1)];

  return mappedBoundary ?? 0;
}

function resolveAnchorToBlockOffset(
  block: TextBlock,
  preparedBlock: PreparedTextBlock,
  cursor: TextCursorOffset,
): number | null {
  const targetItem = preparedBlock.items[cursor.itemIndex];
  if (!targetItem) return null;

  const normalizedBoundaryIndex = getPreparedBoundaryIndex(targetItem, cursor);
  if (normalizedBoundaryIndex === null) return null;

  let blockOffset = 0;
  let preparedItemIndex = 0;

  for (const run of block.runs) {
    const { sourceText, preparedText, isPreformatted, isHardBreak } =
      normalizeRunText(block.tag, run);

    if (!preparedText) {
      blockOffset += getPersistedRunText(block.tag, run).length;
      continue;
    }

    if (preparedItemIndex === cursor.itemIndex) {
      const sourceOffset = resolvePreparedBoundaryToSourceOffset({
        sourceText,
        preparedText,
        normalizedBoundaryIndex,
        isPreformatted,
        isHardBreak,
      });
      return blockOffset + sourceOffset;
    }

    preparedItemIndex += 1;
    blockOffset += getPersistedRunText(block.tag, run).length;
  }

  return null;
}

// Projects the content anchor into a canonical offset based on the original HTML
// This ensures that we can handle inter-block whitespace consistently
// See the test in pagination-highlight-selection
export function resolveTextAnchorToCanonicalOffset(options: {
  anchor: ContentAnchor;
  chapterBlocks: Block[];
  preparedChapter: PreparedBlock[];
  chapterCanonicalText: ChapterCanonicalText;
}): number | null {
  const { anchor, chapterBlocks, preparedChapter, chapterCanonicalText } =
    options;

  if (anchor.type !== "text") return null;

  for (const block of chapterBlocks) {
    if (!isTextBlock(block) || block.id !== anchor.blockId) continue;

    const preparedBlock = findPreparedTextBlock(preparedChapter, block.id);
    if (!preparedBlock) return null;

    const blockOffset = resolveAnchorToBlockOffset(
      block,
      preparedBlock,
      anchor.offset,
    );
    if (blockOffset === null) return null;

    const blockStart = chapterCanonicalText.blockStarts.get(block.id);
    if (blockStart === undefined) return null;

    return blockStart + blockOffset;
  }

  return null;
}

export function resolveContentAnchorRangeToHighlight(options: {
  startAnchor: ContentAnchor;
  endAnchor: ContentAnchor;
  chapterBlocks: Block[];
  preparedChapter: PreparedBlock[];
  chapterCanonicalText: ChapterCanonicalText;
  contextLength?: number;
}): ResolvedHighlightSelection | null {
  const {
    startAnchor,
    endAnchor,
    chapterBlocks,
    preparedChapter,
    chapterCanonicalText,
    contextLength = DEFAULT_CONTEXT_LENGTH,
  } = options;

  if (startAnchor.type !== "text" || endAnchor.type !== "text") {
    return null;
  }

  if (startAnchor.chapterIndex !== endAnchor.chapterIndex) {
    return null;
  }

  const startOffset = resolveTextAnchorToCanonicalOffset({
    anchor: startAnchor,
    chapterBlocks,
    preparedChapter,
    chapterCanonicalText,
  });
  const endOffset = resolveTextAnchorToCanonicalOffset({
    anchor: endAnchor,
    chapterBlocks,
    preparedChapter,
    chapterCanonicalText,
  });

  if (startOffset === null || endOffset === null) return null;

  const rangeStart = Math.min(startOffset, endOffset);
  const rangeEnd = Math.max(startOffset, endOffset);
  if (rangeStart === rangeEnd) return null;

  const fullText = chapterCanonicalText.fullText;
  const selectedText = fullText.slice(rangeStart, rangeEnd).trim();
  if (!selectedText) return null;

  return {
    chapterIndex: startAnchor.chapterIndex,
    startOffset: rangeStart,
    endOffset: rangeEnd,
    selectedText,
    textBefore: fullText.substring(
      Math.max(0, rangeStart - contextLength),
      rangeStart,
    ),
    textAfter: fullText.substring(
      rangeEnd,
      Math.min(fullText.length, rangeEnd + contextLength),
    ),
  };
}

const INVISIBLE_CHARACTERS = /[­​]/g;

/**
 * The text a reader expects to copy from a range of canonical chapter text.
 *
 * Canonical text keeps the source file's whitespace: line wraps and
 * indentation inside a paragraph, and any or no whitespace between
 * paragraphs. The rendered page has neither. Here spaces collapse as they do
 * on the page, a `<br>` stays a line break, preformatted text stays as it is,
 * and paragraphs are separated by a blank line.
 */
export function resolveCanonicalRangeText(options: {
  chapterBlocks: Block[];
  chapterCanonicalText: ChapterCanonicalText;
  startOffset: number;
  endOffset: number;
}): string {
  const { chapterBlocks, chapterCanonicalText, startOffset, endOffset } =
    options;
  const { fullText, blockStarts } = chapterCanonicalText;
  const paragraphs: string[] = [];

  for (const block of chapterBlocks) {
    if (!isTextBlock(block)) continue;
    const blockStart = blockStarts.get(block.id);
    if (blockStart === undefined || blockStart >= endOffset) continue;

    const isPreformatted = block.tag === "pre";
    // Lines split only at <br>; source whitespace is never a line break.
    const lines = [""];
    let runStart = blockStart;
    for (const run of block.runs) {
      const runEnd = runStart + getPersistedRunText(block.tag, run).length;
      if (run.hardBreak && !isPreformatted) {
        if (runStart > startOffset && runStart < endOffset) lines.push("");
      } else {
        const from = Math.max(runStart, startOffset);
        const to = Math.min(runEnd, endOffset);
        if (from < to) {
          const text = fullText
            .slice(from, to)
            .replace(INVISIBLE_CHARACTERS, "");
          lines[lines.length - 1] += isPreformatted
            ? text
            : text.replace(/\s+/g, " ");
        }
      }
      runStart = runEnd;
    }

    const paragraph = isPreformatted
      ? lines.join("").replace(/^\n+|\n+$/g, "")
      : lines
          .map((line) => line.trim())
          .join("\n")
          .trim();
    if (paragraph) paragraphs.push(paragraph);
  }

  return paragraphs.join("\n\n");
}

/** Resolve persisted chapter text coordinates without depending on page layout. */
function getTextCursorBoundaries(
  prepared: PreparedTextBlock,
): TextCursorOffset[] {
  const boundaries: TextCursorOffset[] = [];
  prepared.items.forEach((item, itemIndex) => {
    item.prepared.segments.forEach((segment, segmentIndex) => {
      const count = getSegmentGraphemes(segment).length;
      for (let graphemeIndex = 0; graphemeIndex <= count; graphemeIndex++)
        boundaries.push({ itemIndex, segmentIndex, graphemeIndex });
    });
  });
  return boundaries;
}

/** The last cursor at or before `blockOffset` characters into a block. */
function blockOffsetToTextCursor(
  block: TextBlock,
  prepared: PreparedTextBlock,
  boundaries: TextCursorOffset[],
  blockOffset: number,
): TextCursorOffset | null | undefined {
  let low = 0,
    high = boundaries.length - 1;
  let result: TextCursorOffset | undefined;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const position = resolveAnchorToBlockOffset(
      block,
      prepared,
      boundaries[middle]!,
    );
    if (position === null) return null;
    if (position <= blockOffset) {
      result = boundaries[middle];
      low = middle + 1;
    } else high = middle - 1;
  }
  return result;
}

export function canonicalOffsetToContentAnchor(options: {
  chapterIndex: number;
  offset: number;
  chapterBlocks: Block[];
  preparedChapter: PreparedBlock[];
  chapterCanonicalText: ChapterCanonicalText;
}): ContentAnchor | null {
  const {
    chapterIndex,
    offset,
    chapterBlocks,
    preparedChapter,
    chapterCanonicalText,
  } = options;
  const candidates = chapterBlocks.filter(
    (block) =>
      block.type === "text" &&
      (chapterCanonicalText.blockStarts.get(block.id) ?? Infinity) <= offset,
  );
  const block = candidates.at(-1);
  if (!block || block.type !== "text") return null;
  const prepared = findPreparedTextBlock(preparedChapter, block.id);
  if (!prepared) return null;
  const cursor = blockOffsetToTextCursor(
    block,
    prepared,
    getTextCursorBoundaries(prepared),
    offset - chapterCanonicalText.blockStarts.get(block.id)!,
  );
  return cursor
    ? { type: "text", chapterIndex, blockId: block.id, offset: cursor }
    : null;
}

/**
 * `canonicalOffsetToContentAnchor` for many offsets in one chapter: the
 * chapter's blocks are indexed once, and each block's cursors once.
 */
export function createCanonicalOffsetLocator(options: {
  chapterIndex: number;
  chapterBlocks: Block[];
  preparedChapter: PreparedBlock[];
  blockStarts: ReadonlyMap<string, number>;
}): (offset: number) => ContentAnchor | null {
  const { chapterIndex, chapterBlocks, preparedChapter, blockStarts } = options;
  // Canonical text runs in document order, so the starts already ascend.
  const textBlocks = chapterBlocks.flatMap((block) => {
    const start = blockStarts.get(block.id);
    return block.type === "text" && start !== undefined
      ? [{ block, start }]
      : [];
  });
  const preparedById = new Map(
    preparedChapter.flatMap((block) =>
      block.type === "text" ? [[block.id, block] as const] : [],
    ),
  );
  const boundariesById = new Map<string, TextCursorOffset[]>();
  return (offset) => {
    let low = 0;
    let high = textBlocks.length - 1;
    let found: (typeof textBlocks)[number] | undefined;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (textBlocks[middle]!.start <= offset) {
        found = textBlocks[middle];
        low = middle + 1;
      } else high = middle - 1;
    }
    if (!found) return null;
    const prepared = preparedById.get(found.block.id);
    if (!prepared) return null;
    let boundaries = boundariesById.get(found.block.id);
    if (!boundaries) {
      boundaries = getTextCursorBoundaries(prepared);
      boundariesById.set(found.block.id, boundaries);
    }
    const cursor = blockOffsetToTextCursor(
      found.block,
      prepared,
      boundaries,
      offset - found.start,
    );
    return cursor
      ? { type: "text", chapterIndex, blockId: found.block.id, offset: cursor }
      : null;
  };
}
