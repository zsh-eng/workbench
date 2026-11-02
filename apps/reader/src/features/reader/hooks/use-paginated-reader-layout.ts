import { useLayoutEffect, useState } from "react";
import type { PagesPreference } from "../pages-preference";

const MIN_PAGE_WIDTH_PX = 200;
const MAX_PAGE_WIDTH_PX = 1440;
const MIN_PAGE_HEIGHT_PX = 200;
const MAX_PAGE_HEIGHT_PX = 980;
const MAX_SINGLE_PAGE_WIDTH_PX = 680;
const PREFERRED_SPREAD_PAGE_WIDTH_PX = 600;
const MIN_OUTER_MARGIN_PX = 24;
/**
 * The top and bottom bands. The header and footer show over them on a tap
 * (about 46 px tall), and a pointer reveals them there, so a tablet keeps
 * them too.
 */
const RAIL_HEIGHT_PX = 48;
const RAIL_PADDING_BUFFER_PX = 8;
/** Pages: Two shows two pages down to this size; below it, one page. */
const MIN_CHOSEN_SPREAD_PAGE_WIDTH_PX = 320;
const MIN_CHOSEN_SPREAD_PAGE_HEIGHT_PX = 320;

/**
 * Margins and the size a page needs before Auto shows two. A desktop
 * window keeps wide margins and a tall page. A tablet reads like a book: a
 * gutter of two inner margins, wider outer margins, and two pages in a
 * landscape tablet's height.
 */
interface PageMetrics {
  outerMargin: number;
  gutter: number;
  minAutoSpreadPageWidth: number;
  minAutoSpreadPageHeight: number;
}

const DESKTOP_METRICS: PageMetrics = {
  outerMargin: 56,
  gutter: 72,
  minAutoSpreadPageWidth: 420,
  minAutoSpreadPageHeight: 520,
};

const TABLET_METRICS: PageMetrics = {
  outerMargin: 36,
  gutter: 56,
  minAutoSpreadPageWidth: 400,
  minAutoSpreadPageHeight: 400,
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
}

interface ResolvePaginatedReaderLayoutOptions extends PaginatedReaderLayoutInputs {
  stageWidth: number;
  stageHeight: number;
}

interface UsePaginatedReaderLayoutOptions extends PaginatedReaderLayoutInputs {
  stageSlotElement: HTMLDivElement | null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
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

function getInitialPaginatedReaderLayout(inputs: PaginatedReaderLayoutInputs) {
  if (typeof window === "undefined") {
    return getDefaultPaginatedReaderLayout();
  }

  return resolvePaginatedReaderLayout({
    stageWidth: document.documentElement.clientWidth || window.innerWidth,
    stageHeight: window.innerHeight,
    ...inputs,
  });
}

/**
 * Resolves the paginated reading stage from the available safe-area-adjusted
 * stage slot. Vertical spacing is based on the hover rails rather than the
 * visible chrome height so the reading measure remains stable as chrome UX
 * evolves. A tablet takes book margins (`TABLET_METRICS`); Pages: One or Two
 * overrides Auto, and Two falls back to one page below
 * `MIN_CHOSEN_SPREAD_PAGE_*`.
 */
export function resolvePaginatedReaderLayout(
  options: ResolvePaginatedReaderLayoutOptions,
): PaginatedReaderLayout {
  const metrics = options.isTablet ? TABLET_METRICS : DESKTOP_METRICS;
  const availableWidth = Math.max(1, options.stageWidth);
  const availableHeight = Math.max(1, options.stageHeight);
  const topRailHeight = RAIL_HEIGHT_PX;
  const bottomRailHeight = RAIL_HEIGHT_PX;
  const paddingTop = topRailHeight + RAIL_PADDING_BUFFER_PX;
  const paddingBottom = bottomRailHeight + RAIL_PADDING_BUFFER_PX;
  const pageHeight = clamp(
    availableHeight - paddingTop - paddingBottom,
    MIN_PAGE_HEIGHT_PX,
    MAX_PAGE_HEIGHT_PX,
  );
  const twoPages = twoPagesFit(availableWidth, pageHeight, metrics);
  const resolvedSpreadColumns = resolveSpreadColumns({
    stageWidth: availableWidth,
    pageHeight,
    isMobile: options.isMobile,
    pages: options.pages,
    metrics,
    twoPages,
  });
  const shared = {
    resolvedSpreadColumns,
    topRailHeight,
    bottomRailHeight,
    columnGapPx: metrics.gutter,
    twoPages,
  };

  if (resolvedSpreadColumns === 1) {
    const pageWidth = clamp(
      Math.min(
        MAX_SINGLE_PAGE_WIDTH_PX,
        Math.max(MIN_PAGE_WIDTH_PX, availableWidth - MIN_OUTER_MARGIN_PX * 2),
      ),
      MIN_PAGE_WIDTH_PX,
      MAX_PAGE_WIDTH_PX,
    );

    return {
      ...shared,
      stageViewport: {
        width: pageWidth,
        height: pageHeight,
      },
      stagePadding: {
        paddingX: Math.max(
          MIN_OUTER_MARGIN_PX,
          (availableWidth - pageWidth) / 2,
        ),
        paddingTop,
        paddingBottom,
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
      height: pageHeight,
    },
    stagePadding: {
      paddingX: Math.max(
        metrics.outerMargin,
        (availableWidth - (pageWidth * 2 + metrics.gutter)) / 2,
      ),
      paddingTop,
      paddingBottom,
    },
  };
}

/**
 * Observes the paginated reader's stage slot and keeps the derived viewport and
 * rail-based padding in sync with the available space and the Pages choice.
 */
export function usePaginatedReaderLayout({
  stageSlotElement,
  isMobile,
  isTablet,
  pages,
}: UsePaginatedReaderLayoutOptions): MeasuredPaginatedReaderLayout {
  const [layout, setLayout] = useState(() =>
    getInitialPaginatedReaderLayout({ isMobile, isTablet, pages }),
  );
  const [measurement, setMeasurement] = useState<{
    element: HTMLDivElement | null;
    isMobile: boolean;
  }>({ element: null, isMobile });

  useLayoutEffect(() => {
    if (!stageSlotElement) return;

    const updateLayout = () => {
      if (
        stageSlotElement.clientWidth === 0 ||
        stageSlotElement.clientHeight === 0
      ) {
        return;
      }

      setLayout(
        resolvePaginatedReaderLayout({
          stageWidth: stageSlotElement.clientWidth,
          stageHeight: stageSlotElement.clientHeight,
          isMobile,
          isTablet,
          pages,
        }),
      );
      setMeasurement({ element: stageSlotElement, isMobile });
    };

    updateLayout();

    const observer = new ResizeObserver(updateLayout);
    observer.observe(stageSlotElement);

    return () => {
      observer.disconnect();
    };
  }, [isMobile, isTablet, pages, stageSlotElement]);

  return {
    ...layout,
    isMeasured:
      stageSlotElement !== null &&
      measurement.element === stageSlotElement &&
      measurement.isMobile === isMobile,
  };
}
