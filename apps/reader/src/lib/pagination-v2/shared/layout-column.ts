import {
  hasHardPageBreakAfter,
  hasHardPageBreakBefore,
} from "./layout-page-break-hints";
import {
  getResolvedBlockSpacing,
  getResolvedCollapsedBlockGap,
  type PreviousBlockKind,
} from "./layout-pages";
import { getBlockSpacing, getCollapsedBlockGap } from "./spacing";
import type { LayoutTheme, Page, PageSlice, PreparedBlock } from "./types";

/** One placed slice of a chapter column. It belongs to exactly one page. */
export interface ColumnSlice {
  /** Offset of the slice top from the column top, in CSS pixels. */
  y: number;
  /** Chapter-local index of the page that holds this slice. */
  pageIndex: number;
  slice: PageSlice;
}

export interface ChapterColumn {
  /** Height of the whole column, without page cuts. */
  height: number;
  slices: ColumnSlice[];
  /** Column offset of the top of each page, in page order. */
  pageStarts: number[];
}

/**
 * Lays out one chapter as a single column: the same block loop and gap rules
 * as `layoutPages`, with no height cut.
 *
 * The column reuses the lines, images and spacers of the paged layout, so
 * every line has the same breaks. Differences from the pages are limited to
 * what page breaking adds:
 *
 * - a gap that the page top suppressed is present in the column;
 * - a hard page break becomes a section gap.
 *
 * Text slices stay split where the pages split them. Each column slice
 * therefore belongs to one page, and `pageStarts[p]` maps a scroll offset to
 * the exact top of page `p`. Inside one page, offsets relative to its start
 * are the same as on the page itself.
 */
export function layoutChapterColumn(
  preparedBlocks: PreparedBlock[],
  pages: Page[],
  pageWidth: number,
  theme: LayoutTheme,
): ChapterColumn {
  const safeWidth = Math.max(140, pageWidth);
  const sectionGap = theme.baseFontSizePx * 3;

  // Page slices by block, in page order. Gap spacers carry the id of the
  // block that follows them; they are filtered out by type below.
  const pageSlicesByBlock = new Map<
    string,
    { pageIndex: number; slice: PageSlice }[]
  >();
  for (const page of pages) {
    for (const slice of page.slices) {
      const entries = pageSlicesByBlock.get(slice.blockId);
      if (entries) entries.push({ pageIndex: page.index, slice });
      else
        pageSlicesByBlock.set(slice.blockId, [
          { pageIndex: page.index, slice },
        ]);
    }
  }

  const slices: ColumnSlice[] = [];
  const offsetBySlice = new Map<PageSlice, number>();
  let y = 0;
  let pendingSectionBreak = false;
  let prevMarginBelow = 0;
  let previousBlockKind: PreviousBlockKind | null = null;

  const hasContent = () => slices.length > 0;
  const breakSection = () => {
    if (hasContent()) pendingSectionBreak = true;
    prevMarginBelow = 0;
    previousBlockKind = null;
  };
  const place = (pageIndex: number, slice: PageSlice, height: number) => {
    if (pendingSectionBreak) {
      y += sectionGap;
      pendingSectionBreak = false;
    }
    slices.push({ y, pageIndex, slice });
    offsetBySlice.set(slice, y);
    y += height;
  };
  const finishBlock = (
    block: PreparedBlock,
    kind: PreviousBlockKind | null,
    marginBelow: number,
  ) => {
    if (hasHardPageBreakAfter(block)) {
      breakSection();
      return;
    }
    prevMarginBelow = marginBelow;
    previousBlockKind = kind;
  };

  for (const block of preparedBlocks) {
    if (block.type === "page-break") {
      breakSection();
      continue;
    }
    if (hasHardPageBreakBefore(block)) breakSection();

    const placed = pageSlicesByBlock.get(block.id) ?? [];

    if (block.type === "spacer") {
      const spacer = placed.find((entry) => entry.slice.type === "spacer");
      if (spacer && spacer.slice.type === "spacer") {
        place(spacer.pageIndex, spacer.slice, spacer.slice.height);
      }
      finishBlock(block, null, 0);
      continue;
    }

    if (block.type === "image") {
      const image = placed.find((entry) => entry.slice.type === "image");
      if (!image || image.slice.type !== "image") continue;
      if (hasContent() && !pendingSectionBreak) {
        y += getCollapsedBlockGap(
          previousBlockKind,
          "image",
          theme,
          prevMarginBelow,
        );
      }
      place(image.pageIndex, image.slice, image.slice.height);
      finishBlock(block, "image", getBlockSpacing("image", theme).below);
      continue;
    }

    // A table's parts, one per page; its cells' blocks have no slices of
    // their own and are skipped below.
    if (block.type === "table") {
      const parts = placed.filter((entry) => entry.slice.type === "table");
      if (parts.length === 0) continue;
      if (hasContent() && !pendingSectionBreak) {
        y += getCollapsedBlockGap(
          previousBlockKind,
          "table",
          theme,
          prevMarginBelow,
        );
      }
      for (const { pageIndex, slice } of parts) {
        if (slice.type === "table") place(pageIndex, slice, slice.height);
      }
      finishBlock(block, "table", getBlockSpacing("table", theme).below);
      continue;
    }

    const textSlices = placed.filter((entry) => entry.slice.type === "text");
    // layoutPages skips a text block without lines, including its margins.
    if (textSlices.length === 0) continue;

    if (hasContent() && !pendingSectionBreak) {
      y += getResolvedCollapsedBlockGap(
        previousBlockKind,
        block,
        theme,
        prevMarginBelow,
        safeWidth,
      );
    }
    for (const { pageIndex, slice } of textSlices) {
      if (slice.type !== "text") continue;
      place(pageIndex, slice, slice.lines.length * slice.lineHeight);
    }
    finishBlock(
      block,
      block.tag,
      getResolvedBlockSpacing(block, theme, safeWidth).below,
    );
  }

  // A page can start with a gap spacer that did not fit on the page before.
  // The column keeps that gap above the block, so the page starts at the gap.
  const pageStarts: number[] = [];
  for (const page of pages) {
    let leadingSpacerHeight = 0;
    let start: number | null = null;
    for (const slice of page.slices) {
      const offset = offsetBySlice.get(slice);
      if (offset !== undefined) {
        start = offset - leadingSpacerHeight;
        break;
      }
      if (slice.type === "spacer") leadingSpacerHeight += slice.height;
    }
    pageStarts.push(start ?? pageStarts[pageStarts.length - 1] ?? 0);
  }

  return { height: y, slices, pageStarts };
}
