import { BOOK_LEADING_SCALE } from "@/lib/pagination-v2/shared/spacing";
import { useLayoutEffect, useMemo, useState } from "react";
import {
  getFurnitureRowHeight,
  planPageFurniture,
} from "../page-furniture-layout";
import type { PagesPreference } from "../pages-preference";

const MIN_PAGE_WIDTH_PX = 200;
const MAX_PAGE_WIDTH_PX = 1440;
const MIN_PAGE_HEIGHT_PX = 200;
const MAX_PAGE_HEIGHT_PX = 980;
const MAX_SINGLE_PAGE_WIDTH_PX = 680;
const PREFERRED_SPREAD_PAGE_WIDTH_PX = 600;
/**
 * The top and bottom bands where a pointer reveals the header and footer,
 * which show over them on a tap (about 46 px tall). Auto and Two judge a
 * page by the stage less both bands, so the choice of one page or two does
 * not follow the type.
 */
const RAIL_HEIGHT_PX = 48;
const RAIL_PADDING_BUFFER_PX = 8;
/** The page block sits a hair above the screen's middle: 48 above, 52 below. */
const BLOCK_TOP_SHARE = 0.48;
/** The least room between the page block and the stage's edge. */
const MIN_EDGE_PX = 16;
/** Pages: Two shows two pages down to this size; below it, one page. */
const MIN_CHOSEN_SPREAD_PAGE_WIDTH_PX = 320;
const MIN_CHOSEN_SPREAD_PAGE_HEIGHT_PX = 320;

/**
 * Margins and the size a page needs before Auto shows two. A desktop
 * window keeps wide margins and a tall page. A tablet reads like a book but
 * has no spine, so the gap between its pages is as wide as its outer
 * margins.
 */
interface PageMetrics {
  /** One page: the least margin at each side. */
  singleMargin: number;
  /** Two pages: the margins at the outer edges and the gap between them. */
  outerMargin: number;
  gutter: number;
  /** The least room above and below the text with its titles and numbers. */
  verticalMargin: { single: number; spread: number };
  minAutoSpreadPageWidth: number;
  minAutoSpreadPageHeight: number;
}

const DESKTOP_METRICS: PageMetrics = {
  singleMargin: 28,
  outerMargin: 56,
  gutter: 72,
  verticalMargin: { single: 64, spread: 64 },
  minAutoSpreadPageWidth: 420,
  minAutoSpreadPageHeight: 520,
};

const TABLET_METRICS: PageMetrics = {
  singleMargin: 48,
  outerMargin: 48,
  gutter: 48,
  verticalMargin: { single: 48, spread: 36 },
  minAutoSpreadPageWidth: 400,
  minAutoSpreadPageHeight: 400,
};

const PHONE_METRICS: PageMetrics = {
  singleMargin: 28,
  outerMargin: 28,
  gutter: 40,
  verticalMargin: { single: 28, spread: 20 },
  minAutoSpreadPageWidth: 420,
  minAutoSpreadPageHeight: 520,
};

/** The reader's type and page furniture, which set the page block's height. */
export interface PageBlockType {
  fontSizePx: number;
  lineHeight: number;
  showNumbers: boolean;
  showTitles: boolean;
}

const DEFAULT_PAGE_BLOCK_TYPE: PageBlockType = {
  fontSizePx: 16,
  lineHeight: 1.5,
  showNumbers: true,
  showTitles: true,
};

export interface ReaderStageViewport {
  width: number;
  height: number;
}

export interface ReaderStagePadding {
  paddingX: number;
  paddingTop: number;
  paddingBottom: number;
}

export interface PaginatedReaderLayout {
  resolvedSpreadColumns: 1 | 2;
  stageViewport: ReaderStageViewport;
  stagePadding: ReaderStagePadding;
  topRailHeight: number;
  bottomRailHeight: number;
  columnGapPx: number;
  /** Whether two pages fit as Pages: Two needs them, and if not, why. */
  twoPages: TwoPagesFit;
}

export type TwoPagesFit = "fits" | "too-narrow" | "too-short";

export interface MeasuredPaginatedReaderLayout extends PaginatedReaderLayout {
  /** True after the current stage element has supplied non-zero dimensions. */
  isMeasured: boolean;
}

interface PaginatedReaderLayoutInputs {
  /** A compact window: Auto keeps one page. */
  isMobile: boolean;
  /** A tablet (`deviceClass()`): book margins. */
  isTablet: boolean;
  pages: PagesPreference;
  type?: PageBlockType;
}

interface ResolvePaginatedReaderLayoutOptions extends PaginatedReaderLayoutInputs {
  stageWidth: number;
  stageHeight: number;
  /** The screen above and below the stage: safe areas and the like. */
  insetTop?: number;
  insetBottom?: number;
}

interface UsePaginatedReaderLayoutOptions extends PaginatedReaderLayoutInputs {
  stageSlotElement: HTMLDivElement | null;
  type: PageBlockType;
}

interface StageSize {
  width: number;
  height: number;
  insetTop: number;
  insetBottom: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getPageMetrics(options: {
  isMobile: boolean;
  isTablet: boolean;
}): PageMetrics {
  if (options.isTablet) return TABLET_METRICS;
  return options.isMobile ? PHONE_METRICS : DESKTOP_METRICS;
}

function spreadPageWidth(stageWidth: number, metrics: PageMetrics): number {
  return (stageWidth - metrics.gutter - metrics.outerMargin * 2) / 2;
}

function twoPagesFit(
  stageWidth: number,
  pageHeight: number,
  metrics: PageMetrics,
): TwoPagesFit {
  if (spreadPageWidth(stageWidth, metrics) < MIN_CHOSEN_SPREAD_PAGE_WIDTH_PX)
    return "too-narrow";
  if (pageHeight < MIN_CHOSEN_SPREAD_PAGE_HEIGHT_PX) return "too-short";
  return "fits";
}

function resolveSpreadColumns(options: {
  stageWidth: number;
  pageHeight: number;
  isMobile: boolean;
  pages: PagesPreference;
  metrics: PageMetrics;
  twoPages: TwoPagesFit;
}): 1 | 2 {
  const { stageWidth, pageHeight, isMobile, pages, metrics, twoPages } =
    options;
  if (pages === "one") return 1;
  if (pages === "two") return twoPages === "fits" ? 2 : 1;
  if (isMobile) return 1;

  const autoSpreadFits =
    pageHeight >= metrics.minAutoSpreadPageHeight &&
    spreadPageWidth(stageWidth, metrics) >= metrics.minAutoSpreadPageWidth;

  return autoSpreadFits ? 2 : 1;
}

/**
 * The page block is the text with its title row above and number row below
 * (`page-furniture-layout.ts`). The text takes whole body lines within the
 * margins, and the block is centred on the screen, measured from its edges
 * rather than the stage's, a hair above the middle. A printed page keeps a
 * deeper foot, but a screen is seen whole, where that reads as empty space.
 * Text may lie under the bars' bands: they are frosted and show on request.
 */
function resolvePageBlock(options: {
  columns: 1 | 2;
  availableHeight: number;
  verticalMargin: number;
  isTablet: boolean;
  type: PageBlockType;
  insetTop: number;
  insetBottom: number;
}): { textHeight: number; paddingTop: number; paddingBottom: number } {
  const { columns, availableHeight, type } = options;
  const lineHeight = Math.max(
    1,
    Math.round(
      type.fontSizePx *
        type.lineHeight *
        (columns === 2 ? BOOK_LEADING_SCALE : 1),
    ),
  );
  const plan = planPageFurniture({
    columns,
    isTablet: options.isTablet,
    showTitles: type.showTitles,
    showNumbers: type.showNumbers,
  });
  const row = getFurnitureRowHeight(lineHeight);
  const headRow = plan.headRow ? row : 0;
  const footRow = plan.footRow ? row : 0;
  const room = Math.min(
    MAX_PAGE_HEIGHT_PX,
    availableHeight - 2 * options.verticalMargin - headRow - footRow,
  );
  const textHeight = Math.max(
    MIN_PAGE_HEIGHT_PX,
    Math.floor(room / lineHeight) * lineHeight,
  );
  const blockHeight = headRow + textHeight + footRow;
  const screenHeight = options.insetTop + availableHeight + options.insetBottom;
  const centred =
    Math.round((screenHeight - blockHeight) * BLOCK_TOP_SHARE) -
    options.insetTop;
  const blockTop = Math.max(
    0,
    Math.min(
      Math.max(MIN_EDGE_PX, centred),
      availableHeight - blockHeight - MIN_EDGE_PX,
    ),
  );
  const paddingTop = blockTop + headRow;
  return {
    textHeight,
    paddingTop,
    paddingBottom: Math.max(0, availableHeight - paddingTop - textHeight),
  };
}

export function getDefaultPaginatedReaderLayout(): PaginatedReaderLayout {
  const metrics = DESKTOP_METRICS;
  return {
    resolvedSpreadColumns: 1,
    stageViewport: {
      width: 620,
      height: 860,
    },
    stagePadding: {
      paddingX: metrics.outerMargin,
      paddingTop: RAIL_HEIGHT_PX + RAIL_PADDING_BUFFER_PX,
      paddingBottom: RAIL_HEIGHT_PX + RAIL_PADDING_BUFFER_PX,
    },
    topRailHeight: RAIL_HEIGHT_PX,
    bottomRailHeight: RAIL_HEIGHT_PX,
    columnGapPx: metrics.gutter,
    twoPages: "fits",
  };
}

function getInitialStageSize(): StageSize | null {
  if (typeof window === "undefined") return null;
  return {
    width: document.documentElement.clientWidth || window.innerWidth,
    height: window.innerHeight,
    insetTop: 0,
    insetBottom: 0,
  };
}

/**
 * Resolves the paginated reading stage from the available safe-area-adjusted
 * stage slot. A phone, a tablet and a computer each take their own margins
 * (`PageMetrics`); Pages: One or Two overrides Auto, and Two falls back to
 * one page below `MIN_CHOSEN_SPREAD_PAGE_*`. The page's height and its place
 * on the screen follow `resolvePageBlock`.
 */
export function resolvePaginatedReaderLayout(
  options: ResolvePaginatedReaderLayoutOptions,
): PaginatedReaderLayout {
  const metrics = getPageMetrics(options);
  const availableWidth = Math.max(1, options.stageWidth);
  const availableHeight = Math.max(1, options.stageHeight);
  const nominalPageHeight = clamp(
    availableHeight - 2 * (RAIL_HEIGHT_PX + RAIL_PADDING_BUFFER_PX),
    MIN_PAGE_HEIGHT_PX,
    MAX_PAGE_HEIGHT_PX,
  );
  const twoPages = twoPagesFit(availableWidth, nominalPageHeight, metrics);
  const resolvedSpreadColumns = resolveSpreadColumns({
    stageWidth: availableWidth,
    pageHeight: nominalPageHeight,
    isMobile: options.isMobile,
    pages: options.pages,
    metrics,
    twoPages,
  });
  const block = resolvePageBlock({
    columns: resolvedSpreadColumns,
    availableHeight,
    verticalMargin:
      resolvedSpreadColumns === 2
        ? metrics.verticalMargin.spread
        : metrics.verticalMargin.single,
    isTablet: options.isTablet,
    type: options.type ?? DEFAULT_PAGE_BLOCK_TYPE,
    insetTop: Math.max(0, options.insetTop ?? 0),
    insetBottom: Math.max(0, options.insetBottom ?? 0),
  });
  const shared = {
    resolvedSpreadColumns,
    topRailHeight: RAIL_HEIGHT_PX,
    bottomRailHeight: RAIL_HEIGHT_PX,
    columnGapPx: metrics.gutter,
    twoPages,
  };

  if (resolvedSpreadColumns === 1) {
    const pageWidth = clamp(
      Math.min(
        MAX_SINGLE_PAGE_WIDTH_PX,
        Math.max(
          MIN_PAGE_WIDTH_PX,
          availableWidth - metrics.singleMargin * 2,
        ),
      ),
      MIN_PAGE_WIDTH_PX,
      MAX_PAGE_WIDTH_PX,
    );

    return {
      ...shared,
      stageViewport: {
        width: pageWidth,
        height: block.textHeight,
      },
      stagePadding: {
        paddingX: Math.max(
          metrics.singleMargin,
          (availableWidth - pageWidth) / 2,
        ),
        paddingTop: block.paddingTop,
        paddingBottom: block.paddingBottom,
      },
    };
  }

  const pageWidth = clamp(
    Math.min(
      PREFERRED_SPREAD_PAGE_WIDTH_PX,
      spreadPageWidth(availableWidth, metrics),
    ),
    MIN_CHOSEN_SPREAD_PAGE_WIDTH_PX,
    MAX_PAGE_WIDTH_PX,
  );

  return {
    ...shared,
    stageViewport: {
      width: pageWidth,
      height: block.textHeight,
    },
    stagePadding: {
      paddingX: Math.max(
        metrics.outerMargin,
        (availableWidth - (pageWidth * 2 + metrics.gutter)) / 2,
      ),
      paddingTop: block.paddingTop,
      paddingBottom: block.paddingBottom,
    },
  };
}

function sameStageSize(a: StageSize | null, b: StageSize): boolean {
  return (
    a !== null &&
    a.width === b.width &&
    a.height === b.height &&
    a.insetTop === b.insetTop &&
    a.insetBottom === b.insetBottom
  );
}

/**
 * Observes the paginated reader's stage slot, with the screen around it, and
 * derives the viewport and padding from it, the Pages choice and the type.
 * The layout is worked out as the Reader renders, so a change of type sizes
 * the page in the same render that paginates it.
 */
export function usePaginatedReaderLayout({
  stageSlotElement,
  isMobile,
  isTablet,
  pages,
  type,
}: UsePaginatedReaderLayoutOptions): MeasuredPaginatedReaderLayout {
  const [stage, setStage] = useState<{
    size: StageSize | null;
    element: HTMLDivElement | null;
    isMobile: boolean;
  }>(() => ({ size: getInitialStageSize(), element: null, isMobile }));

  useLayoutEffect(() => {
    if (!stageSlotElement) return;

    const updateStage = () => {
      if (
        stageSlotElement.clientWidth === 0 ||
        stageSlotElement.clientHeight === 0
      ) {
        return;
      }

      const rect = stageSlotElement.getBoundingClientRect();
      const size: StageSize = {
        width: stageSlotElement.clientWidth,
        height: stageSlotElement.clientHeight,
        insetTop: Math.max(0, Math.round(rect.top)),
        insetBottom: Math.max(0, Math.round(window.innerHeight - rect.bottom)),
      };
      setStage((current) =>
        current.element === stageSlotElement &&
        current.isMobile === isMobile &&
        sameStageSize(current.size, size)
          ? current
          : { size, element: stageSlotElement, isMobile },
      );
    };

    updateStage();

    const observer = new ResizeObserver(updateStage);
    observer.observe(stageSlotElement);
    window.addEventListener("resize", updateStage);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateStage);
    };
  }, [isMobile, stageSlotElement]);

  const { fontSizePx, lineHeight, showNumbers, showTitles } = type;
  const { size } = stage;
  const layout = useMemo(
    () =>
      size === null
        ? getDefaultPaginatedReaderLayout()
        : resolvePaginatedReaderLayout({
            stageWidth: size.width,
            stageHeight: size.height,
            insetTop: size.insetTop,
            insetBottom: size.insetBottom,
            isMobile,
            isTablet,
            pages,
            type: { fontSizePx, lineHeight, showNumbers, showTitles },
          }),
    [
      size,
      isMobile,
      isTablet,
      pages,
      fontSizePx,
      lineHeight,
      showNumbers,
      showTitles,
    ],
  );

  return {
    ...layout,
    isMeasured:
      stageSlotElement !== null &&
      stage.element === stageSlotElement &&
      stage.isMobile === isMobile,
  };
}
