import type { BlockTag, LayoutTheme } from "./types";

export const CODE_CHROME_PX = 14;
export const DEFAULT_INTRINSIC_WIDTH = 600;
export const DEFAULT_INTRINSIC_HEIGHT = 400;
export const DEFAULT_ASPECT_RATIO = 3 / 4;
export const BLOCKQUOTE_BORDER_LEFT_PX = 4;
export const BLOCKQUOTE_PADDING_LEFT_EM = 1.5;
export const DEFAULT_PARAGRAPH_SPACING = 0.8;
export const BLOCKQUOTE_MARGIN_Y_LINES = 1.0;
// Keep captions visually secondary without making them look detached from the figure.
export const FIGCAPTION_FONT_SCALE = 0.82;
export const FIGCAPTION_MAX_LINE_HEIGHT_FACTOR = 1.35;
export const FIGCAPTION_MARGIN_TOP_LINES = 0.4;
export const FIGCAPTION_MARGIN_BOTTOM_LINES = 0.85;
export const LIST_ITEM_GAP_LINES = 0.32;
export const PRE_MARGIN_Y_LINES = 1.0;
/** Table text is set a little smaller, as print sets it, so columns fit. */
export const TABLE_FONT_SCALE = 0.88;
export const TABLE_MAX_LINE_HEIGHT_FACTOR = 1.4;

type HeadingTag = "h1" | "h2" | "h3" | "h4" | "h5" | "h6";

type LayoutBlockKind = BlockTag | "image" | "table";

interface HeadingTypographySpec {
  scale: number;
  lineHeightFactor: number;
  aboveLines: number;
  belowLines: number;
}

/**
 * Reader typography is intentionally opinionated: users control the broad
 * reading settings, while the engine owns the vertical rhythm for each block
 * type so pagination and rendering stay in sync.
 */
const HEADING_TYPOGRAPHY: Record<HeadingTag, HeadingTypographySpec> = {
  // Iowan's semibold heading glyph box is taller than the old tight factors,
  // so these line boxes need enough room for the rendered text metrics.
  h1: { scale: 2.0, lineHeightFactor: 1.38, aboveLines: 2.2, belowLines: 0.9 },
  h2: {
    scale: 1.55,
    lineHeightFactor: 1.29,
    aboveLines: 1.7,
    belowLines: 0.75,
  },
  h3: {
    scale: 1.28,
    lineHeightFactor: 1.37,
    aboveLines: 1.3,
    belowLines: 0.6,
  },
  h4: {
    scale: 1.12,
    lineHeightFactor: 1.22,
    aboveLines: 1.1,
    belowLines: 0.55,
  },
  h5: {
    scale: 1.0,
    lineHeightFactor: 1.24,
    aboveLines: 1.0,
    belowLines: 0.5,
  },
  h6: {
    scale: 1.0,
    lineHeightFactor: 1.24,
    aboveLines: 0.9,
    belowLines: 0.45,
  },
};

function getHeadingTypography(tag: string): HeadingTypographySpec | null {
  switch (tag) {
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6":
      return HEADING_TYPOGRAPHY[tag];
    default:
      return null;
  }
}

function getBodyLineHeight(theme: LayoutTheme): number {
  return Math.round(theme.baseFontSizePx * theme.lineHeightFactor);
}

function rhythmLinesToPixels(lines: number, theme: LayoutTheme): number {
  return getBodyLineHeight(theme) * lines;
}

export function isHeadingTag(tag: string): boolean {
  return getHeadingTypography(tag) !== null;
}

export function headingScale(tag: string): number {
  return getHeadingTypography(tag)?.scale ?? 1;
}

export function getBlockFontScale(tag: string): number {
  if (tag === "figcaption") {
    return FIGCAPTION_FONT_SCALE;
  }

  if (tag === "td" || tag === "th") {
    return TABLE_FONT_SCALE;
  }

  return headingScale(tag);
}

function getBlockLineHeightFactor(
  tag: string,
  theme: LayoutTheme,
): number | null {
  const headingTypography = getHeadingTypography(tag);
  if (headingTypography) {
    return headingTypography.lineHeightFactor;
  }

  if (tag === "figcaption") {
    return Math.min(theme.lineHeightFactor, FIGCAPTION_MAX_LINE_HEIGHT_FACTOR);
  }

  if (tag === "td" || tag === "th") {
    return Math.min(theme.lineHeightFactor, TABLE_MAX_LINE_HEIGHT_FACTOR);
  }

  return null;
}

export function getLineHeight(tag: string, theme: LayoutTheme): number {
  const scale = getBlockFontScale(tag);
  const lineHeightFactor =
    getBlockLineHeightFactor(tag, theme) ?? theme.lineHeightFactor;

  return Math.round(theme.baseFontSizePx * scale * lineHeightFactor);
}

export function getBlockSpacing(
  tag: LayoutBlockKind,
  theme: LayoutTheme,
): { above: number; below: number } {
  if (tag === "image") {
    return {
      above: 0,
      below: rhythmLinesToPixels(theme.paragraphSpacingFactor, theme),
    };
  }

  if (tag === "table") {
    const tableSpacing = rhythmLinesToPixels(theme.paragraphSpacingFactor, theme);
    return { above: tableSpacing, below: tableSpacing };
  }

  if (tag === "blockquote") {
    const quoteSpacing = rhythmLinesToPixels(BLOCKQUOTE_MARGIN_Y_LINES, theme);
    return {
      above: quoteSpacing,
      below: quoteSpacing,
    };
  }

  if (tag === "pre") {
    return {
      above: rhythmLinesToPixels(PRE_MARGIN_Y_LINES, theme),
      below: rhythmLinesToPixels(PRE_MARGIN_Y_LINES, theme),
    };
  }

  if (tag === "li") {
    return {
      above: 0,
      below: rhythmLinesToPixels(LIST_ITEM_GAP_LINES, theme),
    };
  }

  if (tag === "figcaption") {
    return {
      above: rhythmLinesToPixels(FIGCAPTION_MARGIN_TOP_LINES, theme),
      below: rhythmLinesToPixels(FIGCAPTION_MARGIN_BOTTOM_LINES, theme),
    };
  }

  const headingTypography = getHeadingTypography(tag);
  if (headingTypography) {
    return {
      above: rhythmLinesToPixels(headingTypography.aboveLines, theme),
      below: rhythmLinesToPixels(headingTypography.belowLines, theme),
    };
  }

  return {
    above: 0,
    below: rhythmLinesToPixels(theme.paragraphSpacingFactor, theme),
  };
}

export function getCollapsedBlockGap(
  previousKind: LayoutBlockKind | null,
  currentKind: LayoutBlockKind,
  theme: LayoutTheme,
  previousMarginBelow: number,
): number {
  if (!previousKind) {
    return 0;
  }

  if (previousKind === "image" && currentKind === "figcaption") {
    return rhythmLinesToPixels(FIGCAPTION_MARGIN_TOP_LINES, theme);
  }

  if (previousKind === "li" && currentKind === "li") {
    return previousMarginBelow;
  }

  if (currentKind === "li") {
    return Math.max(
      previousMarginBelow,
      rhythmLinesToPixels(theme.paragraphSpacingFactor, theme),
    );
  }

  if (previousKind === "li") {
    return Math.max(
      previousMarginBelow,
      rhythmLinesToPixels(theme.paragraphSpacingFactor, theme),
      getBlockSpacing(currentKind, theme).above,
    );
  }

  return Math.max(
    previousMarginBelow,
    getBlockSpacing(currentKind, theme).above,
  );
}

export function getBlockInsetLeft(tag: string, theme: LayoutTheme): number {
  if (tag !== "blockquote") return 0;

  return (
    theme.baseFontSizePx * BLOCKQUOTE_PADDING_LEFT_EM +
    BLOCKQUOTE_BORDER_LEFT_PX
  );
}
