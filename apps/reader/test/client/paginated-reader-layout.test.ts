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

  it("bases vertical padding on hover rail heights instead of chrome height", () => {
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

  it("reads a landscape tablet as a book: two pages, narrow margins", () => {
    for (const [width, height, pageWidth] of [
      [1008, 630, 458],
      [960, 598, 434],
    ]) {
      const layout = resolvePaginatedReaderLayout({
        stageWidth: width,
        stageHeight: height,
        ...tablet,
      });

      expect(layout.resolvedSpreadColumns).toBe(2);
      expect(layout.stageViewport.width).toBe(pageWidth);
      expect(layout.stagePadding.paddingX).toBe(24);
      expect(layout.columnGapPx).toBe(44);
    }
  });

  it("keeps one page on a portrait tablet, with book margins", () => {
    const layout = resolvePaginatedReaderLayout({
      stageWidth: 672,
      stageHeight: 960,
      ...tablet,
    });

    expect(layout.resolvedSpreadColumns).toBe(1);
    expect(layout.stagePadding.paddingX).toBe(24);
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
