import { getHyphenPoints } from "./hyphenation";
import { layoutPreWrapLines, layoutTextLines } from "./layout-text-lines";
import {
  collectTableCells,
  getTableStartHeight,
  layoutTablePages,
  planTable,
  type TablePlan,
} from "./layout-table";
import {
  hasHardPageBreakAfter,
  hasHardPageBreakBefore,
  shouldMoveTextBlockForPageBreakHints,
} from "./layout-page-break-hints";
import {
  getBlankLineHeight,
  getBlockInsetLeft,
  getBlockSpacing,
  getBodyLineHeight,
  getCollapsedBlockGap,
  getLineHeight,
} from "./spacing";
import type {
  LayoutTheme,
  Page,
  PageLine,
  PaginationResult,
  PreparedBlock,
  PreparedTableBlock,
  PreparedTextBlock,
  PublisherBlockRole,
  PublisherLength,
  PublisherTextStyle,
} from "./types";

const JUSTIFY_DISABLED_TAGS = new Set([
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "pre",
]);

/** A book's paragraph indent, which replaces the gap between paragraphs. */
const BOOK_PARAGRAPH_INDENT_EM = 1.2;

interface TextLayoutPlan {
  lines: PageLine[];
  renderMode: "native" | "manual-justify";
  lineHeight: number;
  spacing: { above: number; below: number };
  insets: ReturnType<typeof getResolvedTextInsets>;
  textAlign: LayoutTheme["textAlign"];
}

function resolveTextAlignForBlock(
  textAlign: LayoutTheme["textAlign"],
  tag: PreparedTextBlock["tag"],
  publisherStyle: PublisherTextStyle | undefined,
): LayoutTheme["textAlign"] {
  // Justify on follows the reader over a book that sets its body text left or
  // justified, which is most books; centred and right-aligned text is meant.
  const publisherAlign = publisherStyle?.textAlign;
  const followsReader =
    textAlign === "justify-knuth-plass" &&
    (publisherAlign === "left" || publisherAlign === "justify");
  if (publisherAlign && !followsReader) {
    return publisherAlign;
  }

  if (
    tag === "figcaption" &&
    (textAlign === "justify" || textAlign === "justify-knuth-plass")
  ) {
    return "left";
  }

  if (textAlign === "justify-knuth-plass" && JUSTIFY_DISABLED_TAGS.has(tag)) {
    return "justify";
  }

  return textAlign;
}

function isPublisherDisplayRole(role: PublisherBlockRole): boolean {
  return role !== "body" && role !== "list";
}

function getPublisherLengthPx(
  length: PublisherLength | undefined,
  theme: LayoutTheme,
  containingBlockWidthPx: number,
): number | undefined {
  if (!length) return undefined;
  return Math.max(
    0,
    (length.em ?? 0) * theme.baseFontSizePx +
      (length.percent ?? 0) * containingBlockWidthPx,
  );
}

export function getResolvedBlockSpacing(
  block: PreparedTextBlock,
  theme: LayoutTheme,
  containingBlockWidthPx: number,
): { above: number; below: number } {
  const fallback = getBlockSpacing(block.tag, theme);
  const publisherStyle = block.publisherStyle;
  if (!publisherStyle) return fallback;

  return {
    above:
      getPublisherLengthPx(
        publisherStyle.margin?.before,
        theme,
        containingBlockWidthPx,
      ) ?? fallback.above,
    below:
      getPublisherLengthPx(
        publisherStyle.margin?.after,
        theme,
        containingBlockWidthPx,
      ) ?? fallback.below,
  };
}

/** The kind of the block before, for collapsing the gap between blocks. */
export type PreviousBlockKind = PreparedTextBlock["tag"] | "image" | "table";

export function getResolvedCollapsedBlockGap(
  previousKind: PreviousBlockKind | null,
  currentBlock: PreparedTextBlock,
  theme: LayoutTheme,
  previousMarginBelow: number,
  containingBlockWidthPx: number,
): number {
  if (!previousKind) return 0;
  if (!currentBlock.publisherStyle) {
    return getCollapsedBlockGap(
      previousKind,
      currentBlock.tag,
      theme,
      previousMarginBelow,
    );
  }

  return Math.max(
    previousMarginBelow,
    getResolvedBlockSpacing(currentBlock, theme, containingBlockWidthPx).above,
  );
}

function getResolvedLineHeight(
  block: PreparedTextBlock,
  theme: LayoutTheme,
): number {
  const publisherStyle = block.publisherStyle;
  if (!publisherStyle) return getLineHeight(block.tag, theme);

  const fontScale = block.items.reduce(
    (maxFontScale, item) => Math.max(maxFontScale, item.fontScale),
    publisherStyle.fontScale ?? 1,
  );
  const lineHeightFactor =
    publisherStyle.lineHeightFactor !== undefined &&
    isPublisherDisplayRole(publisherStyle.role)
      ? publisherStyle.lineHeightFactor
      : theme.lineHeightFactor;

  return Math.round(theme.baseFontSizePx * fontScale * lineHeightFactor);
}

/**
 * The horizontal space a text block takes from the column. `drawnByCss` is
 * true for the Reader's own blockquote inset: `.reader-blockquote` draws it as
 * a border and padding, so the slice must not add it again as a margin.
 */
function getResolvedTextInsets(
  block: PreparedTextBlock,
  theme: LayoutTheme,
  containingBlockWidthPx: number,
): { left: number; right: number; drawnByCss: boolean } {
  const publisherStyle = block.publisherStyle;
  if (!publisherStyle) {
    return {
      left: getBlockInsetLeft(block.tag, theme),
      right: 0,
      drawnByCss: true,
    };
  }

  return {
    drawnByCss: false,
    left:
      getPublisherLengthPx(
        publisherStyle.margin?.left,
        theme,
        containingBlockWidthPx,
      ) ?? 0,
    right:
      getPublisherLengthPx(
        publisherStyle.margin?.right,
        theme,
        containingBlockWidthPx,
      ) ?? 0,
  };
}

function createPage(index: number): Page & { usedHeight: number } {
  return { index, slices: [], usedHeight: 0 };
}

function fitImageToBounds(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  const safeWidth = Math.max(1, maxWidth);
  const safeHeight = Math.max(1, maxHeight);
  const safeIntrinsicWidth = Math.max(1, width);
  const safeIntrinsicHeight = Math.max(1, height);
  const scale = Math.min(
    1,
    safeWidth / safeIntrinsicWidth,
    safeHeight / safeIntrinsicHeight,
  );

  return {
    width: safeIntrinsicWidth * scale,
    height: safeIntrinsicHeight * scale,
  };
}

function createTextLayoutPlan(
  textBlock: PreparedTextBlock,
  theme: LayoutTheme,
  safeWidth: number,
  followsParagraph: boolean,
): TextLayoutPlan {
  const spacing = getResolvedBlockSpacing(textBlock, theme, safeWidth);
  const insets = getResolvedTextInsets(textBlock, theme, safeWidth);
  const textLayoutWidth = Math.max(1, safeWidth - insets.left - insets.right);
  const bookIndentPx =
    theme.bookRhythm &&
    followsParagraph &&
    textBlock.tag === "p" &&
    !textBlock.publisherStyle
      ? BOOK_PARAGRAPH_INDENT_EM * theme.baseFontSizePx
      : 0;
  const firstLineIndentPx =
    getPublisherLengthPx(
      textBlock.publisherStyle?.textIndent,
      theme,
      textLayoutWidth,
    ) ?? bookIndentPx;
  const textAlign = resolveTextAlignForBlock(
    theme.textAlign,
    textBlock.tag,
    textBlock.publisherStyle,
  );
  const lineLayout = textBlock.containsNewlines
    ? {
        lines: layoutPreWrapLines(textBlock.items, textLayoutWidth),
        renderMode: "native" as const,
      }
    : layoutTextLines(textBlock.items, textLayoutWidth, {
        textAlign,
        firstLineIndentPx,
        hyphenPoints: getHyphenPoints(theme.language),
      });

  return {
    lines: lineLayout.lines,
    renderMode: lineLayout.renderMode,
    lineHeight: getResolvedLineHeight(textBlock, theme),
    spacing,
    insets,
    textAlign,
  };
}

function getFollowingMinimumHeight(
  currentBlock: PreparedTextBlock,
  currentSpacingBelow: number,
  nextBlock: PreparedBlock | undefined,
  theme: LayoutTheme,
  safeWidth: number,
  safeHeight: number,
  getTablePlan: (table: PreparedTableBlock) => TablePlan,
  /** Height left on the page under the current block. */
  remainingAfterBlock: number,
): number | null {
  if (!nextBlock || nextBlock.type === "page-break") return null;
  if (hasHardPageBreakBefore(nextBlock)) return null;

  if (nextBlock.type === "text") {
    const nextPlan = createTextLayoutPlan(
      nextBlock,
      theme,
      safeWidth,
      currentBlock.tag === "p",
    );
    const lineCount = nextPlan.lines.length;
    if (lineCount === 0) return 0;
    const gap = getResolvedCollapsedBlockGap(
      currentBlock.tag,
      nextBlock,
      theme,
      currentSpacingBelow,
      safeWidth,
    );
    if (!theme.bookRhythm) return gap + nextPlan.lineHeight;
    // A paragraph of up to three lines can't split without a widow or an
    // orphan. A longer one needs room for two.
    const openingLines = lineCount <= 3 ? lineCount : 2;
    return (
      getGapOnLineGrid(
        safeHeight - remainingAfterBlock,
        gap,
        nextPlan.lineHeight,
        theme,
      ) +
      openingLines * nextPlan.lineHeight
    );
  }

  if (nextBlock.type === "image") {
    const gap = getCollapsedBlockGap(
      currentBlock.tag,
      "image",
      theme,
      currentSpacingBelow,
    );
    const fittedImage = fitImageToBounds(
      nextBlock.intrinsicWidth,
      nextBlock.intrinsicHeight,
      safeWidth,
      safeHeight,
    );
    return gap + fittedImage.height;
  }

  if (nextBlock.type === "table") {
    const gap = getCollapsedBlockGap(
      currentBlock.tag,
      "table",
      theme,
      currentSpacingBelow,
    );
    // As the table itself will decide where it starts.
    return Math.min(
      safeHeight,
      gap +
        getTableStartHeight(getTablePlan(nextBlock), {
          remaining: remainingAfterBlock - gap,
          pageHeight: safeHeight,
        }),
    );
  }

  return theme.baseFontSizePx * 0.9;
}

/**
 * How many of a block's lines to place on a page with room for `fit`, so that
 * its first line does not end a page alone and its last does not start one.
 * Zero moves the block to the next page.
 */
/**
 * Body text starts on the line grid, whatever came before it, so baselines
 * match across two pages.
 */
function getGapOnLineGrid(
  usedHeight: number,
  gap: number,
  lineHeight: number,
  theme: LayoutTheme,
): number {
  if (!theme.bookRhythm || lineHeight !== getBodyLineHeight(theme)) return gap;
  const top = Math.ceil((usedHeight + gap) / lineHeight - 0.001) * lineHeight;
  return top - usedHeight;
}

function getLinesWithoutWidowOrOrphan(
  fit: number,
  lineIndex: number,
  lineCount: number,
): number {
  const remaining = lineCount - lineIndex;
  let count = Math.min(fit, remaining);
  if (remaining - count === 1) count -= 1;
  if (lineIndex === 0 && count === 1 && lineCount > 1) count = 0;
  return Math.max(0, count);
}

/**
 * Plans each table once per layout, for its own placement and for a caption
 * that keeps with it.
 */
function createTablePlanner(
  preparedBlocks: PreparedBlock[],
  theme: LayoutTheme,
  safeWidth: number,
): (table: PreparedTableBlock) => TablePlan {
  const plans = new Map<string, TablePlan>();
  const indexById = new Map<string, number>();
  return (table) => {
    const planned = plans.get(table.id);
    if (planned) return planned;
    if (indexById.size === 0)
      preparedBlocks.forEach((block, index) => indexById.set(block.id, index));
    const { cells } = collectTableCells(
      table,
      preparedBlocks,
      indexById.get(table.id) ?? preparedBlocks.length,
    );
    const plan = planTable(table, cells, theme, safeWidth);
    plans.set(table.id, plan);
    return plan;
  };
}

export function layoutPages(
  preparedBlocks: PreparedBlock[],
  pageWidth: number,
  pageHeight: number,
  theme: LayoutTheme,
): PaginationResult {
  const startedAt = performance.now();

  if (preparedBlocks.length === 0) {
    return {
      pages: [{ index: 0, slices: [] }],
      diagnostics: { blockCount: 0, lineCount: 0, computeMs: 0 },
    };
  }

  const safeHeight = Math.max(120, pageHeight);
  const safeWidth = Math.max(140, pageWidth);

  const pages: Page[] = [];
  let current = createPage(0);
  let prevMarginBelow = 0;
  let previousBlockKind: PreviousBlockKind | null = null;
  let totalLineCount = 0;
  const getTablePlan = createTablePlanner(preparedBlocks, theme, safeWidth);

  const pushPage = () => {
    const { usedHeight: _, ...page } = current;
    pages.push(page);
    current = createPage(pages.length);
    prevMarginBelow = 0;
    previousBlockKind = null;
  };

  const addSpacer = (blockId: string, height: number) => {
    const requested = Math.max(0, height);
    if (requested <= 0) return;

    // Keep spacers atomic so a single spacer block never appears on multiple
    // pages with the same blockId (which breaks anchor resolution).
    const spacerHeight = Math.min(requested, safeHeight);
    const available = safeHeight - current.usedHeight;

    if (spacerHeight > available && current.slices.length > 0) {
      pushPage();
    }

    current.slices.push({
      type: "spacer",
      blockId,
      height: spacerHeight,
    });
    current.usedHeight += spacerHeight;
  };

  const startBlock = (block: PreparedBlock) => {
    if (hasHardPageBreakBefore(block) && current.slices.length > 0) {
      pushPage();
    }
  };

  const finishBlock = (
    block: PreparedBlock,
    nextPreviousBlockKind: PreviousBlockKind | null,
    nextMarginBelow: number,
  ): boolean => {
    if (hasHardPageBreakAfter(block) && current.slices.length > 0) {
      pushPage();
      return true;
    }

    prevMarginBelow = nextMarginBelow;
    previousBlockKind = nextPreviousBlockKind;
    return false;
  };

  let lastContentIndex = preparedBlocks.length - 1;
  while (lastContentIndex >= 0) {
    const block = preparedBlocks[lastContentIndex];
    const isContent =
      block?.type !== "page-break" &&
      !(block?.type === "spacer" && block.kind === "blank-line");
    if (isContent) break;
    lastContentIndex--;
  }

  for (let blockIndex = 0; blockIndex < preparedBlocks.length; blockIndex++) {
    const block = preparedBlocks[blockIndex];
    if (!block) continue;

    if (block.type === "page-break") {
      if (current.slices.length > 0) pushPage();
      prevMarginBelow = 0;
      previousBlockKind = null;
      continue;
    }

    startBlock(block);

    // A book's blank line (a scene break) separates two passages on one page.
    // At the top of a page or chapter, or after the last content, there is
    // nothing to separate, so it is dropped. When it does not fit, the page
    // turn is the break: the next passage starts a new page.
    if (block.type === "spacer" && block.kind === "blank-line") {
      if (current.slices.length === 0 || blockIndex > lastContentIndex) {
        continue;
      }
      const height = getBlankLineHeight(theme);
      if (height > safeHeight - current.usedHeight) {
        pushPage();
        continue;
      }
      addSpacer(block.id, height);
      finishBlock(block, null, 0);
      continue;
    }

    if (block.type === "spacer") {
      addSpacer(block.id, theme.baseFontSizePx * 0.9);
      finishBlock(block, null, 0);
      continue;
    }

    if (block.type === "table") {
      const plan = getTablePlan(block);
      blockIndex =
        collectTableCells(block, preparedBlocks, blockIndex).nextIndex - 1;
      if (plan.rows.length === 0) continue;
      for (const row of plan.rows)
        for (const cell of row.cells) totalLineCount += cell.lines.length;
      const spacing = getBlockSpacing("table", theme);
      let gap =
        current.slices.length === 0
          ? 0
          : getCollapsedBlockGap(
              previousBlockKind,
              "table",
              theme,
              prevMarginBelow,
            );
      // As with images: when the table's start does not fit, it starts the
      // next page and the gap above it is dropped there.
      const startHeight = Math.min(
        safeHeight,
        getTableStartHeight(plan, {
          remaining: safeHeight - current.usedHeight - gap,
          pageHeight: safeHeight,
        }),
      );
      if (
        current.slices.length > 0 &&
        gap + startHeight > safeHeight - current.usedHeight
      ) {
        pushPage();
        gap = 0;
      }
      if (gap > 0) addSpacer(block.id, gap);
      layoutTablePages(plan, {
        remaining: () => safeHeight - current.usedHeight,
        isEmpty: () => current.slices.length === 0,
        pageHeight: safeHeight,
        place: (slice) => {
          current.slices.push(slice);
          current.usedHeight += slice.height;
        },
        breakPage: pushPage,
      });
      finishBlock(block, "table", spacing.below);
      continue;
    }

    if (block.type === "image") {
      const spacing = getBlockSpacing("image", theme);
      const gap = getCollapsedBlockGap(
        previousBlockKind,
        "image",
        theme,
        prevMarginBelow,
      );
      const fittedImage = fitImageToBounds(
        block.intrinsicWidth,
        block.intrinsicHeight,
        safeWidth,
        safeHeight,
      );

      // Only emit the gap when there is already content on this page. Crucially,
      // check whether the image will overflow *before* emitting the spacer: if
      // the image won't fit (with or without the gap), push the page first and
      // drop the gap. Emitting the spacer then pushing would leave it stranded
      // on the previous page, separated from the image it belongs to.
      // This matches standard print layout — top-of-page margins are suppressed.
      if (current.slices.length > 0) {
        const available = safeHeight - current.usedHeight;
        if (gap + fittedImage.height <= available) {
          if (gap > 0) addSpacer(block.id, gap);
        } else {
          pushPage();
        }
      }

      let available = safeHeight - current.usedHeight;
      if (available <= 0) {
        pushPage();
        available = safeHeight;
      }
      const displaySize = fitImageToBounds(
        block.intrinsicWidth,
        block.intrinsicHeight,
        safeWidth,
        available,
      );

      current.slices.push({
        type: "image",
        blockId: block.id,
        src: block.src,
        alt: block.alt,
        width: displaySize.width,
        height: displaySize.height,
      });
      current.usedHeight += displaySize.height;

      finishBlock(block, "image", spacing.below);
      continue;
    }

    // Text block
    const textBlock = block as PreparedTextBlock;
    const previousBlock = preparedBlocks[blockIndex - 1];
    const textPlan = createTextLayoutPlan(
      textBlock,
      theme,
      safeWidth,
      previousBlock?.type === "text" && previousBlock.tag === "p",
    );
    const { lines, renderMode, lineHeight, spacing, insets, textAlign } =
      textPlan;
    totalLineCount += lines.length;

    if (lines.length === 0) {
      continue;
    }

    // Margin collapsing
    let effectiveGap =
      current.slices.length === 0
        ? 0
        : getGapOnLineGrid(
            current.usedHeight,
            getResolvedCollapsedBlockGap(
              previousBlockKind,
              textBlock,
              theme,
              prevMarginBelow,
              safeWidth,
            ),
            lineHeight,
            theme,
          );

    const blockHeight = lines.length * lineHeight;
    const availableBeforeBlock = safeHeight - current.usedHeight;
    const followingMinimumHeight =
      textBlock.pageBreakHints?.breakAfter === "avoid"
        ? getFollowingMinimumHeight(
            textBlock,
            spacing.below,
            preparedBlocks[blockIndex + 1],
            theme,
            safeWidth,
            safeHeight,
            getTablePlan,
            availableBeforeBlock - effectiveGap - blockHeight,
          )
        : null;
    const leavesOrphan =
      theme.bookRhythm &&
      current.slices.length > 0 &&
      getLinesWithoutWidowOrOrphan(
        Math.floor((availableBeforeBlock - effectiveGap) / lineHeight),
        0,
        lines.length,
      ) === 0;
    if (
      leavesOrphan ||
      shouldMoveTextBlockForPageBreakHints({
        hints: textBlock.pageBreakHints,
        currentPageHasContent: current.slices.length > 0,
        gapBefore: effectiveGap,
        blockHeight,
        availableBeforeBlock,
        safeHeight,
        followingMinimumHeight,
      })
    ) {
      pushPage();
      effectiveGap = 0;
    }
    if (effectiveGap > 0) addSpacer(textBlock.id, effectiveGap);

    const lastLine = lines[lines.length - 1];
    if (lastLine) {
      lastLine.isLastInBlock = true;
    }

    let lineIndex = 0;

    while (lineIndex < lines.length) {
      const available = safeHeight - current.usedHeight;
      if (available <= 0) {
        pushPage();
        continue;
      }

      let maxLines = Math.floor(available / lineHeight);
      if (maxLines <= 0) {
        if (current.slices.length > 0) {
          pushPage();
          continue;
        }
        maxLines = 1;
      }

      const fit = Math.min(maxLines, lines.length - lineIndex);
      const kept = theme.bookRhythm
        ? getLinesWithoutWidowOrOrphan(fit, lineIndex, lines.length)
        : fit;
      if (kept === 0 && current.slices.length > 0) {
        pushPage();
        continue;
      }
      // An empty page too short to obey takes what it can.
      const take = kept || fit;
      const sliceLines = lines.slice(lineIndex, lineIndex + take);

      current.slices.push({
        type: "text",
        blockId: textBlock.id,
        tag: textBlock.tag,
        ...(textBlock.publisherStyle
          ? { publisherStyle: textBlock.publisherStyle }
          : {}),
        lineHeight,
        textAlign,
        renderMode,
        ...(!insets.drawnByCss && insets.left > 0
          ? { marginLeftPx: insets.left }
          : {}),
        ...(!insets.drawnByCss && insets.right > 0
          ? { marginRightPx: insets.right }
          : {}),
        lines: sliceLines,
      });
      current.usedHeight += take * lineHeight;
      lineIndex += take;
    }

    finishBlock(textBlock, textBlock.tag, spacing.below);
  }

  if (current.slices.length > 0 || pages.length === 0) {
    const { usedHeight: _, ...page } = current;
    pages.push(page);
  }

  return {
    pages,
    diagnostics: {
      blockCount: preparedBlocks.length,
      lineCount: totalLineCount,
      computeMs: performance.now() - startedAt,
    },
  };
}
