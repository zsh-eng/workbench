import {
  getDefaultPaginatedReaderLayout,
  resolvePaginatedReaderLayout,
} from "@/features/reader/hooks/use-paginated-reader-layout";
import { describe, expect, it } from "vitest";

describe("resolvePaginatedReaderLayout", () => {
  it("starts from a conservative single-page default before the stage is measured", () => {
    const layout = getDefaultPaginatedReaderLayout();

    expect(layout.resolvedSpreadColumns).toBe(1);
  });

  // 16 px type at 1.5: 24 px lines on one page, 23 px on two (95%).
  it("fills a phone's page with whole lines and centres it on the screen", () => {
    // An iPhone: 844 px, less 59 above and 34 below for the system.
    const layout = resolvePaginatedReaderLayout({
      stageWidth: 390,
      stageHeight: 751,
      insetTop: 59,
      insetBottom: 34,
      isMobile: true,
      isTablet: false,
      pages: "auto",
    });
    const { paddingTop, paddingBottom } = layout.stagePadding;
    const numberRow = 24 + 12;

    expect(layout.stageViewport.height).toBe(27 * 24);
    expect(layout.stagePadding.paddingX).toBe(28);
    // The block is the text and the number under it, a hair above the
    // screen's middle: 77 px above it, 83 below.
    expect(59 + paddingTop).toBe(77);
    expect(paddingBottom - numberRow + 34).toBe(83);
  });

  it("counts a tablet spread's title row as part of the block", () => {
    const layout = resolvePaginatedReaderLayout({
      stageWidth: 1008,
      stageHeight: 640,
      ...tablet,
    });
    const titleRow = 23 + 12;
    const { paddingTop, paddingBottom } = layout.stagePadding;

    expect(layout.stageViewport.height).toBe(23 * 23);
    // The numbers share the titles' row, so nothing sits under the text.
    expect(paddingTop - titleRow).toBe(36);
    expect(paddingBottom).toBe(40);
  });

  it("gives the text the rows that titles and numbers leave", () => {
    const stage = {
      stageWidth: 1512,
      stageHeight: 860,
      isMobile: false,
      isTablet: false,
      pages: "auto",
    } as const;
    const bare = resolvePaginatedReaderLayout({
      ...stage,
      type: {
        fontSizePx: 16,
        lineHeight: 1.5,
        showNumbers: false,
        showTitles: false,
      },
    });
    const dressed = resolvePaginatedReaderLayout(stage);

    expect(bare.resolvedSpreadColumns).toBe(2);
    expect(bare.stageViewport.height).toBe(31 * 23);
    expect(dressed.stageViewport.height).toBe(28 * 23);
    expect(bare.stagePadding.paddingTop).toBeGreaterThanOrEqual(64);
  });

  it("follows the type: larger type takes fewer, taller lines", () => {
    const layout = resolvePaginatedReaderLayout({
      stageWidth: 390,
      stageHeight: 751,
      isMobile: true,
      isTablet: false,
      pages: "auto",
      type: {
        fontSizePx: 20,
        lineHeight: 1.6,
        showNumbers: true,
        showTitles: true,
      },
    });

    expect(layout.stageViewport.height % 32).toBe(0);
    expect(layout.stageViewport.height).toBe(20 * 32);
  });

  it("bases the default's vertical padding on hover rail heights instead of chrome height", () => {
    const layout = getDefaultPaginatedReaderLayout();

    expect(layout.stagePadding.paddingTop).toBeGreaterThan(
      layout.topRailHeight,
    );
    expect(layout.stagePadding.paddingBottom).toBeGreaterThan(
      layout.bottomRailHeight,
    );
    expect(layout.stagePadding.paddingTop - layout.topRailHeight).toBe(
      layout.stagePadding.paddingBottom - layout.bottomRailHeight,
    );
  });

  it("keeps mobile in single-page mode even on wide stages", () => {
    const layout = resolvePaginatedReaderLayout({
      stageWidth: 1440,
      stageHeight: 900,
      isMobile: true,
      isTablet: false,
      pages: "auto",
    });

    expect(layout.resolvedSpreadColumns).toBe(1);
  });

  it("switches desktop to a spread once two narrow pages fit comfortably", () => {
    const layout = resolvePaginatedReaderLayout({
      stageWidth: 1024,
      stageHeight: 900,
      isMobile: false,
      isTablet: false,
      pages: "auto",
    });

    expect(layout.resolvedSpreadColumns).toBe(2);
    expect(layout.columnGapPx).toBeGreaterThan(20);
    expect(layout.stageViewport.width).toBeGreaterThanOrEqual(420);
  });

  it("falls back to single-page when a spread would be cramped", () => {
    const layout = resolvePaginatedReaderLayout({
      stageWidth: 980,
      stageHeight: 900,
      isMobile: false,
      isTablet: false,
      pages: "auto",
    });

    expect(layout.resolvedSpreadColumns).toBe(1);
  });

  it("adds extra desktop width to outer margins once spread measure is satisfied", () => {
    const wideStage = resolvePaginatedReaderLayout({
      stageWidth: 1500,
      stageHeight: 900,
      isMobile: false,
      isTablet: false,
      pages: "auto",
    });
    const ultraWideStage = resolvePaginatedReaderLayout({
      stageWidth: 1800,
      stageHeight: 900,
      isMobile: false,
      isTablet: false,
      pages: "auto",
    });

    expect(wideStage.resolvedSpreadColumns).toBe(2);
    expect(ultraWideStage.resolvedSpreadColumns).toBe(2);
    expect(ultraWideStage.stageViewport.width).toBe(
      wideStage.stageViewport.width,
    );
    expect(ultraWideStage.stagePadding.paddingX).toBeGreaterThan(
      wideStage.stagePadding.paddingX,
    );
  });

  // The OPPO Pad Mini as an installed app: its screen less the status bar.
  const tablet = { isMobile: false, isTablet: true, pages: "auto" } as const;

  it("reads a landscape tablet as a book: two pages, the gap as wide as the edges", () => {
    for (const [width, height, pageWidth] of [
      [1008, 630, 432],
      [960, 598, 408],
    ]) {
      const layout = resolvePaginatedReaderLayout({
        stageWidth: width,
        stageHeight: height,
        ...tablet,
      });

      expect(layout.resolvedSpreadColumns).toBe(2);
      expect(layout.stageViewport.width).toBe(pageWidth);
      expect(layout.stagePadding.paddingX).toBe(48);
      expect(layout.columnGapPx).toBe(48);
    }
  });

  it("keeps one page on a portrait tablet, with book margins", () => {
    const layout = resolvePaginatedReaderLayout({
      stageWidth: 672,
      stageHeight: 960,
      ...tablet,
    });

    expect(layout.resolvedSpreadColumns).toBe(1);
    expect(layout.stagePadding.paddingX).toBe(48);
  });

  it("follows Pages: One and Two, and says why Two cannot fit", () => {
    const one = resolvePaginatedReaderLayout({
      stageWidth: 1500,
      stageHeight: 900,
      isMobile: false,
      isTablet: false,
      pages: "one",
    });
    const two = resolvePaginatedReaderLayout({
      stageWidth: 900,
      stageHeight: 900,
      isMobile: false,
      isTablet: false,
      pages: "two",
    });
    const narrow = resolvePaginatedReaderLayout({
      stageWidth: 672,
      stageHeight: 960,
      ...tablet,
      pages: "two",
    });
    const short = resolvePaginatedReaderLayout({
      stageWidth: 844,
      stageHeight: 420,
      ...tablet,
      pages: "two",
    });

    expect(one.resolvedSpreadColumns).toBe(1);
    expect(two.resolvedSpreadColumns).toBe(2);
    expect(two.stageViewport.width).toBeGreaterThanOrEqual(320);
    expect(narrow.resolvedSpreadColumns).toBe(1);
    expect(narrow.twoPages).toBe("too-narrow");
    expect(short.resolvedSpreadColumns).toBe(1);
    expect(short.twoPages).toBe("too-short");
  });
});
