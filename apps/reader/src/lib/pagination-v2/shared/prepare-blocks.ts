import {
  prepareWithSegments,
  type LayoutCursor,
  type PreparedTextWithSegments,
} from "@chenglou/pretext";
import { clearMeasureCache, measureCollapsedSpaceWidth } from "./measure";
import {
  getInlineChromeWidthPx,
  SUPERSCRIPT_FONT_SCALE,
} from "./inline-presentation";
import { CODE_CHROME_PX, getBlockFontScale, isHeadingTag } from "./spacing";
import type {
  Block,
  FontConfig,
  InlineRun,
  PreparedBlock,
  PreparedInlineItem,
  PreparedTextBlock,
  PublisherStyleOptions,
  PublisherTextStyle,
} from "./types";

const PREPARED_TEXT_CACHE_MAX = 12_000;

interface PreparedTextCacheEntry {
  prepared: PreparedTextWithSegments;
  fullText: string;
  fullWidth: number;
  endCursor: LayoutCursor;
}

interface ResolvedFont {
  font: string;
  fontScale: number;
}

const preparedTextCache = new Map<string, PreparedTextCacheEntry | null>();

function getPreparedText(
  text: string,
  font: string,
  whiteSpace: "normal" | "pre-wrap" = "normal",
): PreparedTextCacheEntry | null {
  const cacheKey = `${whiteSpace}\n${font}\n${text}`;

  if (preparedTextCache.has(cacheKey)) {
    return preparedTextCache.get(cacheKey) ?? null;
  }

  const prepared =
    whiteSpace === "pre-wrap"
      ? prepareWithSegments(text, font, { whiteSpace })
      : prepareWithSegments(text, font);
  const cached =
    prepared.segments.length === 0
      ? null
      : {
          prepared,
          fullText: text,
          fullWidth: prepared.widths.reduce((total, width) => total + width, 0),
          endCursor: {
            segmentIndex: prepared.segments.length,
            graphemeIndex: 0,
          },
        };

  if (preparedTextCache.size >= PREPARED_TEXT_CACHE_MAX) {
    preparedTextCache.clear();
  }
  preparedTextCache.set(cacheKey, cached);
  return cached;
}

function isPublisherHeadingStyle(
  publisherStyle: PublisherTextStyle | undefined,
): boolean {
  return publisherStyle?.role === "heading";
}

function resolveFont(
  run: InlineRun,
  tag: string,
  fonts: FontConfig,
  options: PublisherStyleOptions,
  publisherStyle: PublisherTextStyle | undefined,
): ResolvedFont {
  const usePublisherStyle = options.publisherBookStylingEnabled === true;
  const publisherInlineStyle = usePublisherStyle
    ? run.publisherInlineStyle
    : undefined;
  const scale =
    publisherInlineStyle?.fontScale ??
    (usePublisherStyle && publisherStyle?.fontScale
      ? publisherStyle.fontScale
      : getBlockFontScale(tag));
  const isHeading = isHeadingTag(tag);
  const isPublisherHeading =
    usePublisherStyle && isPublisherHeadingStyle(publisherStyle);
  const publisherHeadingFamily =
    publisherInlineStyle?.fontFamily ?? publisherStyle?.fontFamily;

  let family: string;
  let sizePx: number;

  // IMPORTANT:
  // Round to whole pixels so the browser's rendered line height matches
  // what our layout engine assumes during pagination.
  //
  // CSS "half-leading": when line-height > font-size, the browser splits
  // the difference in half and adds it above and below the glyph area:
  //   glyph area (font-size) sits in the middle
  //   half-leading above + glyph area + half-leading below = line box
  //
  // Fractional font sizes make this split land on sub-pixel values that
  // the browser rounds inconsistently. For example:
  //   font-size: 19.52px, line-height: 23px
  //   leading = 23 - 19.52 = 3.48px → 1.74px above + 1.74px below
  //   browser rounds each half to 2px → 2 + 19.52 + 2 = 23.52 → 23.5px
  //
  // layoutPages() budgets N × 23px for a text slice, but the browser
  // paints N × 23.5px, so over a full page content overflows the page
  // boundary by roughly half a line.
  if (run.isCode) {
    family = fonts.codeFamily;
    sizePx = Math.round(Math.max(11, fonts.baseSizePx * scale * 0.92));
  } else if (
    run.inlineRole === "superscript" ||
    run.inlineRole === "note-ref"
  ) {
    family = fonts.bodyFamily;
    sizePx = Math.round(
      Math.max(9, fonts.baseSizePx * scale * SUPERSCRIPT_FONT_SCALE),
    );
  } else if (isHeading || isPublisherHeading) {
    family =
      isPublisherHeading && publisherHeadingFamily
        ? publisherHeadingFamily
        : fonts.headingFamily;
    sizePx = Math.round(fonts.baseSizePx * scale);
  } else {
    family = fonts.bodyFamily;
    sizePx = Math.round(fonts.baseSizePx * scale);
  }

  const weight = run.bold
    ? 700
    : publisherInlineStyle?.fontWeight ??
      (usePublisherStyle && publisherStyle?.fontWeight
        ? publisherStyle.fontWeight
        : isHeading || isPublisherHeading || tag === "th"
          ? 600
          : 400);
  const publisherFontStyle =
    publisherInlineStyle?.fontStyle ??
    (usePublisherStyle ? publisherStyle?.fontStyle : undefined);
  const style =
    run.inlineRole === "note-ref"
      ? ""
      : run.italic ||
          publisherFontStyle === "italic" ||
          (!usePublisherStyle && tag === "blockquote")
        ? "italic "
        : "";

  return {
    font: `${style}${weight} ${Math.round(sizePx * 100) / 100}px ${family}`,
    fontScale: scale,
  };
}

function prepareTextBlock(
  block: Extract<Block, { type: "text" }>,
  fonts: FontConfig,
  options: PublisherStyleOptions,
): PreparedTextBlock | null {
  const items: PreparedInlineItem[] = [];
  const isPreformatted = block.tag === "pre";
  let pendingGap = 0;
  let containsNewlines = isPreformatted;

  for (const run of block.runs) {
    const carryGap = pendingGap;
    const sourceText = run.text.replace(/\u00a0/g, " ");
    const isHardBreak = !isPreformatted && run.hardBreak === true;
    const normalizedText =
      isPreformatted || isHardBreak
        ? sourceText
        : sourceText.replace(/\s+/g, " ");
    const hasLeadingWhitespace =
      !isPreformatted && !isHardBreak && /^\s/.test(sourceText);
    const hasTrailingWhitespace =
      !isPreformatted && !isHardBreak && /\s$/.test(sourceText);
    const preparedText =
      isPreformatted || isHardBreak ? normalizedText : normalizedText.trim();

    const resolvedFont = resolveFont(
      run,
      block.tag,
      fonts,
      options,
      block.publisherStyle,
    );
    const font = resolvedFont.font;
    const whiteSpace = isPreformatted || isHardBreak ? "pre-wrap" : "normal";
    const needsCollapsedSpaceWidth =
      hasTrailingWhitespace || hasLeadingWhitespace || carryGap > 0;
    const collapsedSpaceWidth = needsCollapsedSpaceWidth
      ? measureCollapsedSpaceWidth(font)
      : 0;
    pendingGap = hasTrailingWhitespace ? collapsedSpaceWidth : 0;

    if (isHardBreak) containsNewlines = true;
    if (!preparedText) continue;

    const cached = getPreparedText(preparedText, font, whiteSpace);
    if (!cached) continue;

    items.push({
      kind: "text",
      font,
      fontScale: resolvedFont.fontScale,
      ...(run.inlineRole ? { inlineRole: run.inlineRole } : {}),
      ...(run.link ? { link: { ...run.link } } : {}),
      ...(run.targetIds && run.targetIds.length > 0
        ? { targetIds: [...run.targetIds] }
        : {}),
      isCode: run.isCode,
      highlightMarks:
        run.highlightMarks && run.highlightMarks.length > 0
          ? [...run.highlightMarks]
          : undefined,
      chromeWidth: run.isCode
        ? CODE_CHROME_PX
        : getInlineChromeWidthPx(run.inlineRole, font, cached.fullWidth),
      prepared: cached.prepared,
      rawText: preparedText,
      fullText: cached.fullText,
      fullWidth: cached.fullWidth,
      endCursor: cached.endCursor,
      leadingGap:
        carryGap > 0 || hasLeadingWhitespace ? collapsedSpaceWidth : 0,
    });
  }

  if (
    items.length === 0 &&
    (!block.targetIds || block.targetIds.length === 0)
  ) {
    return null;
  }

  return {
    type: "text",
    id: block.id,
    tag: block.tag,
    ...(block.targetIds && block.targetIds.length > 0
      ? { targetIds: [...block.targetIds] }
      : {}),
    ...(block.pageBreakHints
      ? { pageBreakHints: { ...block.pageBreakHints } }
      : {}),
    ...(block.publisherStyle ? { publisherStyle: block.publisherStyle } : {}),
    items,
    containsNewlines,
  };
}

export function prepareBlocks(
  blocks: Block[],
  fonts: FontConfig,
  options: PublisherStyleOptions = {},
): PreparedBlock[] {
  const result: PreparedBlock[] = [];

  for (const block of blocks) {
    switch (block.type) {
      case "text": {
        const preparedTextBlock = prepareTextBlock(block, fonts, options);
        if (preparedTextBlock) {
          result.push(preparedTextBlock);
        }
        break;
      }
      case "image":
        result.push({ ...block });
        break;
      case "spacer":
      case "page-break":
      case "table":
        result.push({ ...block });
        break;
    }
  }

  return result;
}

export function clearPrepareCache(): void {
  clearMeasureCache();
  preparedTextCache.clear();
}
