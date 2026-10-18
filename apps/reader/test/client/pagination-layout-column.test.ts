import {
  buildScrollRows,
  findFirstFullyVisibleLine,
  resolveSnapPage,
} from "@/features/reader/scroll/scroll-model";
import {
  layoutPages,
  prepareBlocks,
  type Block,
  type ChapterColumnLayout,
  type FontConfig,
  type LayoutTheme,
} from "@/lib/pagination-v2";
import { layoutChapterColumn } from "@/lib/pagination-v2/shared/layout-column";
import { describe, expect, it } from "vitest";

const FONT_CONFIG: FontConfig = {
  bodyFamily: '"Inter", sans-serif',
  headingFamily: '"Inter", sans-serif',
  codeFamily: '"Courier New", monospace',
  baseSizePx: 16,
};

const LAYOUT_THEME: LayoutTheme = {
  baseFontSizePx: 16,
  lineHeightFactor: 1.5,
  paragraphSpacingFactor: 1.2,
  headingSpaceAbove: 1.5,
  headingSpaceBelow: 0.7,
  textAlign: "left",
};

const PAGE_WIDTH = 320;
const PAGE_HEIGHT = 400;
const LINE_HEIGHT = 24;

function paragraph(id: string, words: number): Block {
  return {
    type: "text",
    id,
    tag: "p",
    runs: [
      {
        kind: "text",
        text: Array.from({ length: words }, (_, i) => `word${i}`).join(" "),
        bold: false,
        italic: false,
        isCode: false,
      },
    ],
  };
}

function layoutChapter(blocks: Block[]): ChapterColumnLayout {
  const prepared = prepareBlocks(blocks, FONT_CONFIG);
  const { pages } = layoutPages(
    prepared,
    PAGE_WIDTH,
    PAGE_HEIGHT,
    LAYOUT_THEME,
  );
  const column = layoutChapterColumn(prepared, pages, PAGE_WIDTH, LAYOUT_THEME);
  return {
    chapterIndex: 0,
    width: PAGE_WIDTH,
    pageHeight: PAGE_HEIGHT,
    ...column,
    pageAnchors: column.pageStarts.map(() => ({
      type: "block",
      chapterIndex: 0,
      blockId: "unused",
    })),
  };
}

function lineText(line: { fragments: { text: string }[] }): string {
  return line.fragments.map((fragment) => fragment.text).join("");
}

const BLOCKS: Block[] = [
  {
    type: "text",
    id: "h",
    tag: "h2",
    runs: [
      { kind: "text", text: "One", bold: false, italic: false, isCode: false },
    ],
  },
  ...Array.from({ length: 24 }, (_, i) =>
    paragraph(`p${i}`, 30 + (i % 5) * 17),
  ),
];

describe("layoutChapterColumn", () => {
  it("keeps every page's slices at their page offsets", () => {
    const prepared = prepareBlocks(BLOCKS, FONT_CONFIG);
    const { pages } = layoutPages(
      prepared,
      PAGE_WIDTH,
      PAGE_HEIGHT,
      LAYOUT_THEME,
    );
    const column = layoutChapterColumn(
      prepared,
      pages,
      PAGE_WIDTH,
      LAYOUT_THEME,
    );
    expect(pages.length).toBeGreaterThan(3);
    expect(column.pageStarts).toHaveLength(pages.length);

    const offsetBySlice = new Map(
      column.slices.map((entry) => [entry.slice, entry]),
    );
    for (const page of pages) {
      let pageOffset = 0;
      for (const slice of page.slices) {
        const placed = offsetBySlice.get(slice);
        if (placed) {
          expect(placed.pageIndex).toBe(page.index);
          expect(placed.y - column.pageStarts[page.index]!).toBeCloseTo(
            pageOffset,
            3,
          );
        }
        pageOffset +=
          slice.type === "text"
            ? slice.lines.length * slice.lineHeight
            : slice.height;
      }
    }

    // Every line of the pages is in the column, in order.
    const pageLines = pages.flatMap((page) =>
      page.slices.flatMap((slice) =>
        slice.type === "text" ? slice.lines.map(lineText) : [],
      ),
    );
    const columnLines = column.slices.flatMap(({ slice }) =>
      slice.type === "text" ? slice.lines.map(lineText) : [],
    );
    expect(columnLines).toEqual(pageLines);
  });
});

describe("resolveSnapPage", () => {
  const column = layoutChapter(BLOCKS);
  const rows = buildScrollRows(column);
  const snap = (viewTop: number) =>
    resolveSnapPage({ column, rows, viewTop, bodyLineHeight: LINE_HEIGHT });

  it("snaps back to the page of the first fully visible line", () => {
    const start = column.pageStarts[2]!;
    expect(snap(start)).toBe(2);
    expect(snap(start + PAGE_HEIGHT / 2)).toBe(2);
  });

  it("snaps forward when the next page starts within two lines", () => {
    const nextStart = column.pageStarts[3]!;
    const line = findFirstFullyVisibleLine(rows, 0, nextStart - LINE_HEIGHT);
    expect(line?.pageIndex).toBe(2);
    expect(snap(nextStart - LINE_HEIGHT)).toBe(3);
    expect(snap(nextStart - 2 * LINE_HEIGHT)).toBe(3);
    expect(snap(nextStart - 4 * LINE_HEIGHT)).toBe(2);
  });

  it("splits long blocks into rows that never cross a page", () => {
    for (const row of rows) {
      const start = column.pageStarts[row.pageIndex]!;
      const end = column.pageStarts[row.pageIndex + 1] ?? column.height;
      expect(row.y).toBeGreaterThanOrEqual(start - 0.01);
      expect(row.y + row.height).toBeLessThanOrEqual(end + 0.01);
    }
  });
});
