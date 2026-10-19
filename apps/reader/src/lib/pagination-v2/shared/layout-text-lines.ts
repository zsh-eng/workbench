import type { LayoutCursor } from "@chenglou/pretext";
import { layoutNextLine } from "@chenglou/pretext";
import {
  layoutNextRichInlineLineRange,
  materializeRichInlineLineRange,
  prepareRichInline,
  type RichInlineCursor,
} from "@chenglou/pretext/rich-inline";
import { LINE_START_CURSOR, cursorsMatch, measureTextWidth } from "./measure";
import type {
  HighlightMark,
  LayoutTheme,
  PageFragment,
  PageLine,
  PreparedInlineItem,
  TextCursorOffset,
  TextRenderMode,
} from "./types";

const HUGE_BADNESS = 1e8;
const SOFT_HYPHEN = "\u00AD";
const ZERO_WIDTH_BREAK = "\u200B";
const RIVER_THRESHOLD = 1.5;
const INFEASIBLE_SPACE_RATIO = 0.4;
const TIGHT_SPACE_RATIO = 0.65;
const NATIVE_INLINE_WRAP_SAFETY_PX = 2;
const NATIVE_INLINE_ZERO_WIDTH_BREAK_SAFETY_PX = 8;

type TextLineLayoutResult = {
  lines: PageLine[];
  renderMode: TextRenderMode;
};

type TextLineLayoutOptions = {
  textAlign?: LayoutTheme["textAlign"];
  firstLineIndentPx?: number;
};

type InlineLayoutToken = {
  kind: "text" | "space" | "soft-hyphen";
  text: string;
  width: number;
  font: string;
  inlineRole?: PageFragment["inlineRole"];
  link?: PageFragment["link"];
  isCode: boolean;
  highlightMarks?: PageFragment["highlightMarks"];
  startOffset: TextCursorOffset;
  endOffset: TextCursorOffset;
};

type BreakCandidateKind = "start" | "space" | "soft-hyphen" | "end";

type BreakCandidate = {
  tokenIndex: number;
  kind: BreakCandidateKind;
  offset: TextCursorOffset;
};

type LineStats = {
  wordWidth: number;
  naturalWidth: number;
  spaceCount: number;
  normalSpaceWidth: number;
  trailingMarker: "none" | "soft-hyphen";
};

function createOffset(
  itemIndex: number,
  cursor: LayoutCursor,
): TextCursorOffset {
  return {
    itemIndex,
    segmentIndex: cursor.segmentIndex,
    graphemeIndex: cursor.graphemeIndex,
  };
}

function itemHasForcedBreak(item: PreparedInlineItem): boolean {
  return item.prepared.kinds.includes("hard-break");
}

function projectHighlightMarks(
  highlightMarks: HighlightMark[] | undefined,
  options: {
    preserveStart: boolean;
    preserveEnd: boolean;
  },
): HighlightMark[] | undefined {
  if (!highlightMarks || highlightMarks.length === 0) {
    return undefined;
  }

  return highlightMarks.map((mark) => ({
    id: mark.id,
    ...(mark.color ? { color: mark.color } : {}),
    ...(options.preserveStart && mark.isStart ? { isStart: true } : {}),
    ...(options.preserveEnd && mark.isEnd ? { isEnd: true } : {}),
  }));
}

export function layoutTextLines(
  items: PreparedInlineItem[],
  maxWidth: number,
  options?: TextLineLayoutOptions,
): TextLineLayoutResult {
  const safeWidth = Math.max(1, maxWidth);
  const firstLineIndentPx = Math.max(0, options?.firstLineIndentPx ?? 0);

  if (
    options?.textAlign === "justify-knuth-plass" &&
    firstLineIndentPx <= 0
  ) {
    const knuthPlassLines = layoutTextLinesKnuthPlass(items, safeWidth);
    if (knuthPlassLines !== null) {
      return {
        lines: knuthPlassLines,
        renderMode: "manual-justify",
      };
    }
  }

  return {
    lines: layoutTextLinesGreedy(items, safeWidth, firstLineIndentPx),
    renderMode: "native",
  };
}

function layoutTextLinesGreedy(
  items: PreparedInlineItem[],
  safeWidth: number,
  firstLineIndentPx = 0,
): PageLine[] {
  const hasZeroWidthBreaks = items.some((item) =>
    item.rawText.includes(ZERO_WIDTH_BREAK),
  );
  const wrapSafety = Math.max(
    NATIVE_INLINE_WRAP_SAFETY_PX,
    hasZeroWidthBreaks ? NATIVE_INLINE_ZERO_WIDTH_BREAK_SAFETY_PX : 0,
  );
  const layoutWidth = Math.max(1, safeWidth - wrapSafety);
  const prepared = prepareRichInline(
    items.map((item) => ({
      text: item.leadingGap > 0 ? ` ${item.rawText}` : item.rawText,
      font: item.font,
      extraWidth: item.chromeWidth,
    })),
  );
  const lines: PageLine[] = [];
  let cursor: RichInlineCursor | undefined;
  let isFirstLine = true;

  while (true) {
    const indentPx = isFirstLine ? Math.min(firstLineIndentPx, safeWidth - 1) : 0;
    const currentLayoutWidth = Math.max(1, layoutWidth - indentPx);
    const richLineRange = layoutNextRichInlineLineRange(
      prepared,
      currentLayoutWidth,
      cursor,
    );
    if (!richLineRange) break;

    const richLine = materializeRichInlineLineRange(prepared, richLineRange);
    const fragments = richLine.fragments.flatMap<PageFragment>((fragment) => {
      const item = items[fragment.itemIndex];
      if (!item || !fragment.text) return [];

      return {
        kind: "text",
        text: fragment.text,
        font: item.font,
        leadingGap: fragment.gapBefore,
        inlineRole: item.inlineRole,
        link: item.link,
        isCode: item.isCode,
        highlightMarks: projectHighlightMarks(item.highlightMarks, {
          preserveStart: cursorsMatch(fragment.start, LINE_START_CURSOR),
          preserveEnd: cursorsMatch(fragment.end, item.endCursor),
        }),
        anchorStart: createOffset(fragment.itemIndex, fragment.start),
        anchorEnd: createOffset(fragment.itemIndex, fragment.end),
      };
    });
    const firstFragment = richLine.fragments[0];
    const lastFragment = richLine.fragments[richLine.fragments.length - 1];

    if (fragments.length > 0 && firstFragment && lastFragment) {
      lines.push({
        fragments,
        startOffset: createOffset(firstFragment.itemIndex, firstFragment.start),
        endOffset: createOffset(lastFragment.itemIndex, lastFragment.end),
        isLastInBlock: false,
        ...(indentPx > 0 ? { indentPx } : {}),
      });
    }

    cursor = richLine.end;
    isFirstLine = false;
  }

  return lines;
}

function layoutTextLinesPreWrap(
  items: PreparedInlineItem[],
  safeWidth: number,
): PageLine[] {
  const lines: PageLine[] = [];

  let itemIndex = 0;
  let textCursor: LayoutCursor | null = null;

  while (itemIndex < items.length) {
    const fragments: PageLine["fragments"] = [];
    let remainingWidth = safeWidth;
    let lineStartOffset: TextCursorOffset | null = null;
    let lineEndOffset: TextCursorOffset | null = null;

    lineLoop: while (itemIndex < items.length) {
      const item = items[itemIndex];
      if (!item) break;
      if (textCursor && cursorsMatch(textCursor, item.endCursor)) {
        itemIndex++;
        textCursor = null;
        continue;
      }

      const leadingGap = fragments.length === 0 ? 0 : item.leadingGap;
      const reservedWidth = leadingGap + item.chromeWidth;

      if (fragments.length > 0 && reservedWidth >= remainingWidth) {
        break lineLoop;
      }

      // Fast path: whole run fits
      if (!textCursor && !itemHasForcedBreak(item)) {
        const fullWidth = leadingGap + item.fullWidth + item.chromeWidth;
        if (fullWidth <= remainingWidth) {
          if (!lineStartOffset) {
            lineStartOffset = createOffset(itemIndex, LINE_START_CURSOR);
          }
          lineEndOffset = createOffset(itemIndex, item.endCursor);

          fragments.push({
            kind: "text",
            text: item.fullText,
            font: item.font,
            leadingGap,
            inlineRole: item.inlineRole,
            link: item.link,
            isCode: item.isCode,
            highlightMarks: projectHighlightMarks(item.highlightMarks, {
              preserveStart: true,
              preserveEnd: true,
            }),
            anchorStart: createOffset(itemIndex, LINE_START_CURSOR),
            anchorEnd: createOffset(itemIndex, item.endCursor),
          });
          remainingWidth -= fullWidth;
          itemIndex++;
          continue;
        }
      }

      // Slow path: split via layoutNextLine
      const start = textCursor ?? LINE_START_CURSOR;
      const line = layoutNextLine(
        item.prepared,
        start,
        Math.max(1, remainingWidth - reservedWidth),
      );

      if (!line || cursorsMatch(start, line.end)) {
        itemIndex++;
        textCursor = null;
        continue;
      }

      if (!lineStartOffset) {
        lineStartOffset = createOffset(itemIndex, start);
      }
      lineEndOffset = createOffset(itemIndex, line.end);

      fragments.push({
        kind: "text",
        text: line.text,
        font: item.font,
        leadingGap,
        inlineRole: item.inlineRole,
        link: item.link,
        isCode: item.isCode,
        highlightMarks: projectHighlightMarks(item.highlightMarks, {
          preserveStart: cursorsMatch(start, LINE_START_CURSOR),
          preserveEnd: cursorsMatch(line.end, item.endCursor),
        }),
        anchorStart: createOffset(itemIndex, start),
        anchorEnd: createOffset(itemIndex, line.end),
      });
      remainingWidth -= leadingGap + line.width + item.chromeWidth;

      if (cursorsMatch(line.end, item.endCursor)) {
        itemIndex++;
        textCursor = null;
        continue;
      }

      textCursor = line.end;
      break lineLoop;
    }

    if (fragments.length === 0) break;
    lines.push({
      fragments,
      startOffset: lineStartOffset ?? undefined,
      endOffset: lineEndOffset ?? undefined,
      isLastInBlock: false,
    });
  }

  return lines;
}

function canUseKnuthPlassJustification(items: PreparedInlineItem[]): boolean {
  return (
    items.length > 0 &&
    items.every((item) => item.chromeWidth === 0 && !itemHasForcedBreak(item))
  );
}

// ---------------------------------------------------------------------------
// Knuth-Plass justification
// ---------------------------------------------------------------------------

function layoutTextLinesKnuthPlass(
  items: PreparedInlineItem[],
  maxWidth: number,
): PageLine[] | null {
  if (!canUseKnuthPlassJustification(items)) return null;

  const tokens = flattenInlineTokens(items);
  if (tokens.length === 0) return [];

  const firstOffset = tokens[0]?.startOffset;
  const lastOffset = tokens[tokens.length - 1]?.endOffset;
  if (!firstOffset || !lastOffset) return null;

  const breakCandidates: BreakCandidate[] = [
    {
      tokenIndex: 0,
      kind: "start",
      offset: firstOffset,
    },
  ];

  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
    const token = tokens[tokenIndex];
    if (!token) continue;

    if (
      token.kind === "space" &&
      tokenIndex + 1 < tokens.length &&
      tokens[tokenIndex + 1]
    ) {
      breakCandidates.push({
        tokenIndex: tokenIndex + 1,
        kind: "space",
        offset: tokens[tokenIndex + 1]!.startOffset,
      });
      continue;
    }

    if (token.kind === "soft-hyphen" && tokenIndex + 1 < tokens.length) {
      breakCandidates.push({
        tokenIndex: tokenIndex + 1,
        kind: "soft-hyphen",
        offset: token.endOffset,
      });
    }
  }

  breakCandidates.push({
    tokenIndex: tokens.length,
    kind: "end",
    offset: lastOffset,
  });

  const dp: number[] = new Array(breakCandidates.length).fill(Infinity);
  const previous: number[] = new Array(breakCandidates.length).fill(-1);
  dp[0] = 0;

  for (
    let toCandidate = 1;
    toCandidate < breakCandidates.length;
    toCandidate++
  ) {
    const candidate = breakCandidates[toCandidate];
    if (!candidate) continue;

    const isLastLine = candidate.kind === "end";

    for (
      let fromCandidate = toCandidate - 1;
      fromCandidate >= 0;
      fromCandidate--
    ) {
      if (dp[fromCandidate] === Infinity) continue;

      const lineStats = getLineStats(
        tokens,
        breakCandidates,
        fromCandidate,
        toCandidate,
      );
      if (lineStats === null) continue;

      if (lineStats.naturalWidth > maxWidth * 2) break;

      const totalBadness =
        dp[fromCandidate]! + lineBadness(lineStats, maxWidth, isLastLine);

      if (totalBadness < dp[toCandidate]!) {
        dp[toCandidate] = totalBadness;
        previous[toCandidate] = fromCandidate;
      }
    }
  }

  if (previous[breakCandidates.length - 1] === -1) {
    return null;
  }

  const chosenBreaks: number[] = [];
  let current = breakCandidates.length - 1;
  while (current > 0) {
    const prev = previous[current];
    if (prev === -1) return null;
    chosenBreaks.push(current);
    current = prev;
  }
  chosenBreaks.reverse();

  const lines: PageLine[] = [];
  let fromCandidate = 0;
  for (const toCandidate of chosenBreaks) {
    const line = buildKnuthPlassLine(
      tokens,
      breakCandidates,
      fromCandidate,
      toCandidate,
      maxWidth,
    );
    if (line === null) return null;
    lines.push(line);
    fromCandidate = toCandidate;
  }

  return lines;
}

function flattenInlineTokens(items: PreparedInlineItem[]): InlineLayoutToken[] {
  const tokens: InlineLayoutToken[] = [];

  for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
    const item = items[itemIndex];
    if (!item) continue;

    const itemTokens: InlineLayoutToken[] = [];

    if (tokens.length > 0 && item.leadingGap > 0) {
      const itemStartOffset = createOffset(itemIndex, LINE_START_CURSOR);
      itemTokens.push({
        kind: "space",
        text: " ",
        width: item.leadingGap,
        font: item.font,
        inlineRole: item.inlineRole,
        link: item.link,
        isCode: item.isCode,
        highlightMarks: item.highlightMarks,
        startOffset: itemStartOffset,
        endOffset: itemStartOffset,
      });
    }

    for (
      let segIndex = 0;
      segIndex < item.prepared.segments.length;
      segIndex++
    ) {
      const text = item.prepared.segments[segIndex];
      const width = item.prepared.widths[segIndex];
      if (text === undefined || width === undefined) continue;

      const startOffset = createOffset(itemIndex, {
        segmentIndex: segIndex,
        graphemeIndex: 0,
      });
      const endOffset = createOffset(itemIndex, {
        segmentIndex: segIndex + 1,
        graphemeIndex: 0,
      });

      if (text === SOFT_HYPHEN) {
        itemTokens.push({
          kind: "soft-hyphen",
          text,
          width: 0,
          font: item.font,
          link: item.link,
          isCode: item.isCode,
          highlightMarks: item.highlightMarks,
          startOffset,
          endOffset,
        });
        continue;
      }

      itemTokens.push({
        kind: isSpaceText(text) ? "space" : "text",
        text,
        width,
        font: item.font,
        inlineRole: item.inlineRole,
        link: item.link,
        isCode: item.isCode,
        highlightMarks: item.highlightMarks,
        startOffset,
        endOffset,
      });
    }

    const lastTokenIndex = itemTokens.length - 1;
    for (let tokenIndex = 0; tokenIndex < itemTokens.length; tokenIndex++) {
      const token = itemTokens[tokenIndex];
      if (!token) continue;

      tokens.push({
        ...token,
        highlightMarks: projectHighlightMarks(item.highlightMarks, {
          preserveStart: tokenIndex === 0,
          preserveEnd: tokenIndex === lastTokenIndex,
        }),
      });
    }
  }

  return tokens;
}

function getLineStats(
  tokens: readonly InlineLayoutToken[],
  breakCandidates: readonly BreakCandidate[],
  fromCandidate: number,
  toCandidate: number,
): LineStats | null {
  const from = breakCandidates[fromCandidate]?.tokenIndex;
  const to = breakCandidates[toCandidate]?.tokenIndex;
  const breakKind = breakCandidates[toCandidate]?.kind;
  if (from === undefined || to === undefined || breakKind === undefined) {
    return null;
  }

  let wordWidth = 0;
  let naturalWidth = 0;
  let spaceCount = 0;

  for (let tokenIndex = from; tokenIndex < to; tokenIndex++) {
    const token = tokens[tokenIndex];
    if (!token || token.kind === "soft-hyphen") continue;

    naturalWidth += token.width;
    if (token.kind === "space") {
      spaceCount += 1;
      continue;
    }

    wordWidth += token.width;
  }

  const trailingToken = to > from ? tokens[to - 1] : null;
  if (trailingToken?.kind === "space") {
    naturalWidth -= trailingToken.width;
    spaceCount -= 1;
  }

  const hyphenWidth =
    breakKind === "soft-hyphen"
      ? measureTextWidth("-", tokens[to - 1]?.font ?? "")
      : 0;
  const normalSpaceWidth =
    spaceCount > 0 ? (naturalWidth - wordWidth) / spaceCount : 0;

  return {
    wordWidth: wordWidth + hyphenWidth,
    naturalWidth: naturalWidth + hyphenWidth,
    spaceCount: Math.max(0, spaceCount),
    normalSpaceWidth: Math.max(0, normalSpaceWidth),
    trailingMarker: breakKind === "soft-hyphen" ? "soft-hyphen" : "none",
  };
}

function lineBadness(
  lineStats: LineStats,
  maxWidth: number,
  isLastLine: boolean,
): number {
  if (isLastLine) {
    // The last line is not justified. It keeps its natural spaces, so the
    // spaces must fit as well as the words.
    if (lineStats.naturalWidth > maxWidth) return HUGE_BADNESS;
    return 0;
  }

  if (lineStats.spaceCount <= 0) {
    const slack = maxWidth - lineStats.wordWidth;
    if (slack < 0) return HUGE_BADNESS;
    return slack * slack * 10;
  }

  const justifiedSpace =
    (maxWidth - lineStats.wordWidth) / lineStats.spaceCount;
  if (justifiedSpace < 0) return HUGE_BADNESS;
  const normalSpaceWidth = lineStats.normalSpaceWidth || justifiedSpace;
  if (normalSpaceWidth <= 0) return HUGE_BADNESS;

  if (justifiedSpace < normalSpaceWidth * INFEASIBLE_SPACE_RATIO) {
    return HUGE_BADNESS;
  }

  const ratio = (justifiedSpace - normalSpaceWidth) / normalSpaceWidth;
  const absRatio = Math.abs(ratio);
  const badness = absRatio * absRatio * absRatio * 1000;

  const riverExcess = justifiedSpace / normalSpaceWidth - RIVER_THRESHOLD;
  const riverPenalty =
    riverExcess > 0 ? 5000 + riverExcess * riverExcess * 10000 : 0;

  const tightThreshold = normalSpaceWidth * TIGHT_SPACE_RATIO;
  const tightPenalty =
    justifiedSpace < tightThreshold
      ? 3000 + (tightThreshold - justifiedSpace) ** 2 * 10000
      : 0;

  const hyphenPenalty = lineStats.trailingMarker === "soft-hyphen" ? 50 : 0;
  return badness + riverPenalty + tightPenalty + hyphenPenalty;
}

function buildKnuthPlassLine(
  tokens: readonly InlineLayoutToken[],
  breakCandidates: readonly BreakCandidate[],
  fromCandidate: number,
  toCandidate: number,
  maxWidth: number,
): PageLine | null {
  const from = breakCandidates[fromCandidate]?.tokenIndex;
  const to = breakCandidates[toCandidate]?.tokenIndex;
  const breakKind = breakCandidates[toCandidate]?.kind;
  const startOffset = breakCandidates[fromCandidate]?.offset;
  const endOffset = breakCandidates[toCandidate]?.offset;
  if (
    from === undefined ||
    to === undefined ||
    breakKind === undefined ||
    !startOffset ||
    !endOffset
  ) {
    return null;
  }

  const lineStats = getLineStats(
    tokens,
    breakCandidates,
    fromCandidate,
    toCandidate,
  );
  if (lineStats === null) return null;

  const fragments: PageFragment[] = [];
  const isLastLine = breakKind === "end";
  const targetSpaceWidth =
    !isLastLine && lineStats.spaceCount > 0
      ? (maxWidth - lineStats.wordWidth) / lineStats.spaceCount
      : null;
  const wordSpacingPx =
    targetSpaceWidth !== null
      ? targetSpaceWidth - lineStats.normalSpaceWidth
      : undefined;
  const trailingFillPx =
    !isLastLine && lineStats.spaceCount <= 0
      ? Math.max(0, maxWidth - lineStats.wordWidth)
      : 0;

  let lastRenderableFragment: PageFragment | null = null;
  for (let tokenIndex = from; tokenIndex < to; tokenIndex++) {
    const token = tokens[tokenIndex];
    if (!token || token.kind === "soft-hyphen") continue;

    const fragment: PageFragment = {
      kind: token.kind === "space" ? "space" : "text",
      text: token.kind === "space" ? " " : token.text,
      font: token.font,
      leadingGap: 0,
      inlineRole: token.inlineRole,
      link: token.link,
      isCode: token.isCode,
      highlightMarks: token.highlightMarks,
      anchorStart: token.startOffset,
      anchorEnd: token.endOffset,
    };

    fragments.push(fragment);
    lastRenderableFragment = fragment;
  }

  if (breakKind === "soft-hyphen") {
    const softHyphenToken = tokens[to - 1];
    fragments.push({
      kind: "text",
      text: "-",
      font: softHyphenToken?.font ?? "",
      leadingGap: 0,
      ...(softHyphenToken?.inlineRole
        ? { inlineRole: softHyphenToken.inlineRole }
        : {}),
      ...(softHyphenToken?.link ? { link: softHyphenToken.link } : {}),
      isCode: softHyphenToken?.isCode ?? false,
      highlightMarks: softHyphenToken?.highlightMarks,
      ...(softHyphenToken
        ? {
            anchorStart: softHyphenToken.startOffset,
            anchorEnd: softHyphenToken.endOffset,
          }
        : {}),
    });
    lastRenderableFragment =
      fragments[fragments.length - 1] ?? lastRenderableFragment;
  }

  if (trailingFillPx > 0 && lastRenderableFragment) {
    lastRenderableFragment.marginRightPx = trailingFillPx;
  }

  return {
    fragments,
    startOffset,
    endOffset,
    isLastInBlock: false,
    wordSpacingPx,
  };
}

export function layoutPreWrapLines(
  items: PreparedInlineItem[],
  maxWidth: number,
): PageLine[] {
  return layoutTextLinesPreWrap(items, Math.max(1, maxWidth));
}

function isSpaceText(text: string): boolean {
  return text.trim().length === 0;
}
