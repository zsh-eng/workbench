import {
  buildScrollRows,
  findAnchorOffset,
  findFirstFullyVisibleLine,
  findLineAtOrAfter,
  findLineTextPosition,
  findTextPositionOffset,
  readingLineOffset,
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

function layoutChapter(
  blocks: Block[],
  width = PAGE_WIDTH,
): ChapterColumnLayout {
  const prepared = prepareBlocks(blocks, FONT_CONFIG);
  const { pages } = layoutPages(prepared, width, PAGE_HEIGHT, LAYOUT_THEME);
  const column = layoutChapterColumn(prepared, pages, width, LAYOUT_THEME);
  return {
    chapterIndex: 0,
    width,
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
  const PADDING_TOP = 40;
  const VIEW_HEIGHT = 600;
  const snap = (scrollTop: number) =>
    resolveSnapPage({
      column,
      readingLine: readingLineOffset(scrollTop, PADDING_TOP, VIEW_HEIGHT),
    });

  it("puts the reading line a third of the way down the view", () => {
    expect(readingLineOffset(100, PADDING_TOP, VIEW_HEIGHT)).toBe(
      100 - PADDING_TOP + VIEW_HEIGHT / 3,
    );
  });

  it("snaps to the page that holds the reading line", () => {
    const start = column.pageStarts[2]!;
    const nextStart = column.pageStarts[3]!;
    const third = VIEW_HEIGHT / 3 - PADDING_TOP;
    // The reading line on page 2, just after its start.
    expect(snap(start - third + 1)).toBe(2);
    // Page 3 starts right above the reading line: snap forward.
    expect(snap(nextStart - third + 1)).toBe(3);
    // Page 3 starts just below the reading line: stay on page 2.
    expect(snap(nextStart - third - 1)).toBe(2);
  });

  it("snaps to the first page at the top of the chapter", () => {
    expect(snap(0)).toBe(0);
  });

  it("finds the line under the reading line, and the line of an anchor", () => {
    const offset = column.pageStarts[2]! + LINE_HEIGHT * 3 + 4;
    const line = findLineAtOrAfter(rows, 0, offset);
    expect(line?.pageIndex).toBe(2);
    expect(line!.y).toBeLessThanOrEqual(offset);
    expect(line!.y + line!.height).toBeGreaterThan(offset);
    expect(findAnchorOffset(rows, line!.anchor)).toBe(line!.y);
  });

  it("names the first fully visible line by its page", () => {
    const start = column.pageStarts[2]!;
    expect(findFirstFullyVisibleLine(rows, 0, start)?.pageIndex).toBe(2);
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

describe("line text positions", () => {
  const words = Array.from({ length: 160 }, (_, i) => `word${i}`).join(" ");
  const run = (text: string) => ({
    kind: "text" as const,
    text,
    bold: false,
    italic: false,
    isCode: false,
  });
  const block = (runs: string[]): Block => ({
    type: "text",
    id: "p",
    tag: "p",
    runs: runs.map(run),
  });
  // A highlight splits a run, which renumbers every cursor offset after it.
  const plain = buildScrollRows(layoutChapter([block([words])]));
  const split = buildScrollRows(
    layoutChapter([
      block([words.slice(0, 301), words.slice(301, 420), words.slice(420)]),
    ]),
  );

  function lineAt(rows: ReturnType<typeof buildScrollRows>, y: number) {
    for (const row of rows) {
      if (row.slice.type !== "text") continue;
      const index = Math.floor((y - row.y) / row.slice.lineHeight);
      const line = row.slice.lines[index];
      if (line && index >= 0) return lineText(line);
    }
    return null;
  }

  it("finds the same line after a run is split", () => {
    const line = findLineAtOrAfter(plain, 0, LINE_HEIGHT * 9 + 3)!;
    const position = findLineTextPosition(plain, line.y)!;
    expect(position.blockId).toBe("p");
    expect(position.textOffset).toBeGreaterThan(0);
    const offset = findTextPositionOffset(split, position);
    expect(offset).toBe(line.y);
    expect(lineAt(split, offset!)).toBe(lineAt(plain, line.y));
  });

  it("finds the line that now holds the same words after a reflow", () => {
    const narrow = buildScrollRows(layoutChapter([block([words])], 240));
    const line = findLineAtOrAfter(plain, 0, LINE_HEIGHT * 6 + 3)!;
    const position = findLineTextPosition(plain, line.y)!;
    const firstWord = lineAt(plain, line.y)!.trim().split(/\s+/)[0]!;
    const offset = findTextPositionOffset(narrow, position)!;
    const reflowed = lineAt(narrow, offset)!;
    // The first word of the old line starts on, or ends, the new line.
    expect(
      reflowed.includes(firstWord) ||
        (lineAt(narrow, offset + LINE_HEIGHT) ?? "").startsWith(firstWord),
    ).toBe(true);
  });
});
