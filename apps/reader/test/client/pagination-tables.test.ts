import { decorateChapterContent } from "@/features/reader/data/chapter-content-pipeline";
import {
  layoutPages,
  parseChapterHtmlWithCanonicalText,
  prepareBlocks,
  textSlicesOf,
  type Block,
  type ContentAnchor,
  type FontConfig,
  type LayoutTheme,
  type Page,
  type TableSlice,
} from "@/lib/pagination-v2";
import {
  buildScrollRows,
  findAnchorOffset,
  findFirstFullyVisibleLine,
  findLineAtOrAfter,
  findLineTextPosition,
  findTextPositionOffset,
} from "@/features/reader/scroll/scroll-model";
import {
  pickAnchorForPage,
  readTableAnchor,
  resolveAnchorToPage,
} from "@/lib/pagination-v2/engine/anchors";
import { layoutChapterColumn } from "@/lib/pagination-v2/shared/layout-column";
import {
  canonicalOffsetToContentAnchor,
  resolveCanonicalRangeText,
  resolveTextAnchorToCanonicalOffset,
} from "@/lib/pagination-v2/engine/highlight-selection";
import type { PreparedTextBlock } from "@/lib/pagination-v2/shared/types";
import type { Highlight } from "@/types/highlight";
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

/** A synthetic table: a header row, then `rows` rows of three cells. */
function tableHtml(rows: number, caption = "Table 1 Sample latencies") {
  const body = Array.from(
    { length: rows },
    (_, row) =>
      `<tr><td>probe ${row}</td><td>${row * 3} ms</td><td>queue <em>depth</em> ${row}</td></tr>`,
  ).join("");
  return `<table><caption>${caption}</caption><thead><tr><th>Name</th><th>Latency</th><th>Notes</th></tr></thead><tbody>${body}</tbody></table>`;
}

const CHAPTER = `<body><p>Before the table.</p>${tableHtml(30)}<p>After the table.</p></body>`;

function parse(html: string, tables: boolean) {
  return parseChapterHtmlWithCanonicalText(html, { tables });
}

function tableSlices(pages: Page[]): TableSlice[] {
  return pages.flatMap((page) =>
    page.slices.filter((slice) => slice.type === "table"),
  );
}

function cellText(block: Block | undefined): string {
  if (block?.type !== "text") return "";
  return block.runs
    .map((run) => (run.kind === "text" ? run.text : ""))
    .join("");
}

describe("parsing tables", () => {
  it("keeps the canonical text and the ids around the table in both modes", () => {
    const flat = parse(CHAPTER, false);
    const grid = parse(CHAPTER, true);

    // Highlights and reading places are canonical offsets: the same text.
    expect(grid.canonicalText.fullText).toBe(flat.canonicalText.fullText);
    const ids = (blocks: Block[]) =>
      blocks.filter((block) => !block.id.includes("-c")).map((b) => b.id);
    expect(ids(grid.blocks).at(0)).toBe(ids(flat.blocks).at(0));
    expect(ids(grid.blocks).at(-1)).toBe(ids(flat.blocks).at(-1));
  });

  it("reads a table as one paragraph when tables are off", () => {
    const { blocks } = parse(CHAPTER, false);
    expect(blocks.some((block) => block.type === "table")).toBe(false);
    expect(blocks).toHaveLength(3);
  });

  it("gives each cell a block whose start points at its text", () => {
    const { blocks, canonicalText } = parse(CHAPTER, true);
    const table = blocks.find((block) => block.type === "table");
    if (table?.type !== "table") throw new Error("no table block");
    expect(table.rows).toHaveLength(31);
    expect(table.rows[0]!.header).toBe(true);
    expect(table.rows[1]!.cells.map((cell) => cell.blockId)).toHaveLength(3);

    const cells = blocks.filter(
      (block) =>
        block.type === "text" && (block.tag === "td" || block.tag === "th"),
    );
    expect(cells).toHaveLength(31 * 3);
    for (const cell of cells) {
      const start = canonicalText.blockStarts.get(cell.id);
      expect(start).toBeTypeOf("number");
      const text = cellText(cell);
      expect(canonicalText.fullText.slice(start!, start! + text.length)).toBe(
        text,
      );
    }
    // The caption keeps with the table, and names it.
    const caption = blocks[blocks.indexOf(table) - 1];
    expect(caption?.type === "text" && caption.tag).toBe("figcaption");
    expect(table.label).toBe("Table 1 Sample latencies");
  });

  it("starts cells at their text past comments in the table", () => {
    const { blocks, canonicalText } = parse(
      "<body><table><tr><td>A</td></tr><!-- row two --><tr><!-- cell --><td>Bravo</td></tr></table></body>",
      true,
    );
    const cell = blocks.find((block) => block.id.endsWith("-c1"))!;
    const start = canonicalText.blockStarts.get(cell.id)!;
    expect(canonicalText.fullText.slice(start, start + 5)).toBe("Bravo");
    const paragraph = parse(
      "<body><table><tr><td>A</td></tr><!-- row two --><tr><!-- cell --><td>Bravo</td></tr></table></body>",
      false,
    ).blocks[0];
    expect(paragraph?.type === "text" && paragraph.tableCellStarts).toEqual([
      0, 1,
    ]);
  });

  it("reads simple cell alignment, and a figure's caption as the name", () => {
    const { blocks } = parse(
      `<body><figure><figcaption>Table 2\n  Widths</figcaption><table>
        <tr align="right"><td>1</td><td align="left">2</td>
          <td style="text-align: center; vertical-align: middle">3</td></tr>
        <tr><td valign="bottom">4</td><td align="justify">5</td></tr>
      </table></figure></body>`,
      true,
    );
    const table = blocks.find((block) => block.type === "table");
    if (table?.type !== "table") throw new Error("no table block");
    expect(table.label).toBe("Table 2 Widths");
    const alignment = table.rows.map((row) =>
      row.cells.map(({ align, valign }) => ({ align, valign })),
    );
    expect(alignment).toEqual([
      [
        { align: "right", valign: undefined },
        { align: undefined, valign: undefined },
        { align: "center", valign: "middle" },
      ],
      [
        { align: undefined, valign: "bottom" },
        { align: undefined, valign: undefined },
      ],
    ]);

    const [slice] = tableSlices(
      layoutPages(prepareBlocks(blocks, FONT_CONFIG), 360, 400, LAYOUT_THEME)
        .pages,
    );
    expect(slice?.label).toBe("Table 2 Widths");
    expect(
      slice?.rows.map((row) =>
        row.cells.map((cell) => [cell.slice.textAlign, cell.valign]),
      ),
    ).toEqual([
      [
        ["right", undefined],
        ["left", undefined],
        ["center", "middle"],
      ],
      [
        ["left", "bottom"],
        ["left", undefined],
      ],
    ]);
  });
});

describe("laying out tables", () => {
  const { blocks } = parse(CHAPTER, true);
  const prepared = prepareBlocks(blocks, FONT_CONFIG);
  const { pages } = layoutPages(prepared, 360, 400, LAYOUT_THEME);
  const slices = tableSlices(pages);

  it("splits a tall table at rows and repeats its header", () => {
    expect(slices.length).toBeGreaterThan(1);
    expect(slices[0]!.rows[0]).toMatchObject({ header: true, repeated: false });
    for (const slice of slices.slice(1))
      expect(slice.rows[0]).toMatchObject({ header: true, repeated: true });

    // Every body row shows once, in order.
    const shown = slices.flatMap((slice) =>
      slice.rows.filter((row) => !row.header).map((row) => row.index),
    );
    expect(shown).toEqual(Array.from({ length: 30 }, (_, index) => index + 1));
    for (const page of pages) {
      const used = page.slices.reduce(
        (sum, slice) =>
          sum +
          (slice.type === "table"
            ? slice.height
            : slice.type === "spacer"
              ? slice.height
              : 0),
        0,
      );
      expect(used).toBeLessThanOrEqual(400);
    }
  });

  it("fits the page width and sizes rows to whole lines", () => {
    for (const slice of slices) {
      expect(slice.overflows).toBe(false);
      expect(slice.width).toBeLessThanOrEqual(360);
      expect(slice.columnWidths.reduce((a, b) => a + b, 0)).toBe(slice.width);
      expect(slice.height).toBe(
        slice.rows.reduce((sum, row) => sum + row.height, 0),
      );
    }
  });

  it("anchors a continuation page to its own cells, and finds it again", () => {
    const pageIndex = pages.findIndex(
      (page, index) =>
        index > 0 &&
        page.slices.some(
          (slice) => slice.type === "table" && slice.rows[0]!.repeated,
        ),
    );
    expect(pageIndex).toBeGreaterThan(0);
    const anchor = pickAnchorForPage([pages], 0, pageIndex);
    expect(anchor.blockId).toMatch(/-c\d+$/);
    expect(resolveAnchorToPage([pages], anchor)).toEqual({
      chapterIndex: 0,
      localPageIndex: pageIndex,
    });
    // The repeated header's cells are not anchors on this page.
    const header = textSlicesOf(pages[pageIndex]!.slices).filter((slice) =>
      cellText(blocks.find((block) => block.id === slice.blockId)).match(
        /^(Name|Latency|Notes)$/,
      ),
    );
    expect(header).toEqual([]);
  });

  it("splits a long row where keeping it whole would leave the page empty", () => {
    const table = `<table><thead><tr><th>A</th><th>B</th><th>C</th></tr></thead><tbody><tr><td>x</td><td>${"word ".repeat(200)}</td><td>y</td></tr></tbody></table>`;
    const layout = (before: string) => {
      const parsed = parse(`<body><p>${before}</p>${table}</body>`, true);
      const { pages } = layoutPages(
        prepareBlocks(parsed.blocks, FONT_CONFIG),
        360,
        400,
        LAYOUT_THEME,
      );
      return pages.flatMap((page, pageIndex) =>
        page.slices.flatMap((slice) =>
          slice.type === "table"
            ? [
                {
                  pageIndex,
                  rows: slice.rows.map((row) => [
                    row.index,
                    row.repeated,
                    row.continued,
                  ]),
                },
              ]
            : [],
        ),
      );
    };

    // Most of the page is free: the row starts under the opening line.
    const roomy = layout("A short opening.");
    expect(roomy[0]).toEqual({
      pageIndex: 0,
      rows: [
        [0, false, false],
        [1, false, false],
      ],
    });
    expect(roomy[1]?.rows).toEqual([
      [0, true, false],
      [1, false, true],
    ]);

    // Less than a quarter is free: the table starts the next page.
    const full = layout("word ".repeat(115));
    expect(full[0]?.pageIndex).toBe(1);
  });

  it("gives every row piece room for its lines, row spans included", () => {
    const long = "word ".repeat(150);
    const html = `<body><p>Opening.</p><table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td rowspan="3">${long}</td><td>one</td></tr><tr><td>two</td></tr><tr><td>three</td></tr><tr><td>x</td><td>four</td></tr></tbody></table></body>`;
    const parsed = parse(html, true);
    const { pages } = layoutPages(
      prepareBlocks(parsed.blocks, FONT_CONFIG),
      360,
      400,
      LAYOUT_THEME,
    );
    const slices = tableSlices(pages);
    expect(slices.length).toBeGreaterThan(1);
    for (const slice of slices) {
      for (const row of slice.rows) {
        for (const cell of row.cells) {
          if (cell.rowSpan > 1) continue;
          expect(row.height).toBeGreaterThanOrEqual(
            slice.cellPaddingY * 2 +
              cell.slice.lines.length * cell.slice.lineHeight,
          );
        }
      }
      expect(slice.height).toBeLessThanOrEqual(400);
    }
    // Every word of the spanning cell shows once, over the pieces.
    const words = slices
      .flatMap((slice) => textSlicesOf([slice]))
      .filter((cell) => cell.blockId.endsWith("-c2"))
      .flatMap((cell) => cell.lines)
      .flatMap((line) => line.fragments.map((fragment) => fragment.text))
      .join(" ")
      .split(/\s+/)
      .filter(Boolean);
    expect(words).toHaveLength(150);
  });

  it("narrows its padding only when that makes it fit", () => {
    const layoutTable = (rows: string) => {
      const parsed = parse(`<body><table>${rows}</table></body>`, true);
      const { pages } = layoutPages(
        prepareBlocks(parsed.blocks, FONT_CONFIG),
        360,
        400,
        LAYOUT_THEME,
      );
      return tableSlices(pages)[0]!;
    };
    const long = "abcdefghij".repeat(4);
    // Words of growing length in: four equal columns; beside a column
    // capped at 60% of the page; under a header cell spanning two columns.
    const shapes = [
      (word: string) => `<tr>${`<td>${word}</td>`.repeat(4)}</tr>`,
      (word: string) => `<tr><td>${long}</td><td>${word}</td></tr>`,
      (word: string) =>
        `<tr><td>${word}</td><td colspan="2">${long}</td></tr><tr><td>a</td><td>b</td><td>c</td></tr>`,
    ];
    for (const shape of shapes) {
      const slices = Array.from({ length: 13 }, (_, index) =>
        layoutTable(shape("n".repeat(8 + index))),
      );
      for (const slice of slices) {
        // A table that still scrolls keeps its padding; in one that fits,
        // each word stays whole on one line.
        if (slice.overflows) expect(slice.cellPaddingX).toBe(7);
        else
          for (const cell of textSlicesOf([slice])) {
            const text = cell.lines
              .flatMap((line) => line.fragments.map((part) => part.text))
              .join("");
            if (text.startsWith("n")) expect(cell.lines).toHaveLength(1);
          }
      }
      expect(
        slices.some((slice) => !slice.overflows && slice.cellPaddingX < 7),
      ).toBe(true);
      expect(slices.at(-1)!.overflows).toBe(true);
    }
  });

  it("scrolls a table sideways when its words cannot fit", () => {
    const wide = `<table><tr>${Array.from(
      { length: 8 },
      (_, index) => `<td>unbreakable_identifier_${index}</td>`,
    ).join("")}</tr></table>`;
    const parsed = parse(`<body>${wide}</body>`, true);
    const result = layoutPages(
      prepareBlocks(parsed.blocks, FONT_CONFIG),
      360,
      400,
      LAYOUT_THEME,
    );
    const [slice] = tableSlices(result.pages);
    expect(slice?.overflows).toBe(true);
    expect(slice!.width).toBeGreaterThan(360);
  });
});

describe("tables in scroll mode", () => {
  const { blocks } = parse(CHAPTER, true);
  const prepared = prepareBlocks(blocks, FONT_CONFIG);
  const { pages } = layoutPages(prepared, 360, 400, LAYOUT_THEME);
  const column = layoutChapterColumn(prepared, pages, 360, LAYOUT_THEME);
  const rows = buildScrollRows(column);
  const parts = rows.filter((row) => row.slice.type === "table");

  it("places each part where its page puts it", () => {
    expect(parts.length).toBeGreaterThan(2);
    for (const part of parts)
      expect(part.y).toBeGreaterThanOrEqual(column.pageStarts[part.pageIndex]!);
  });

  it("shows the header once, and starts a continuation's page at its header", () => {
    const header = pages
      .flatMap((page) => page.slices)
      .flatMap((slice) => (slice.type === "table" ? slice.rows : []))
      .filter((row) => row.repeated);
    expect(header.length).toBeGreaterThan(0);
    for (const part of parts) {
      if (part.slice.type !== "table") continue;
      expect(part.slice.rows.some((row) => row.repeated)).toBe(false);
    }
    // On the page, a continuation's rows sit under the header; in the
    // column the page starts where that header would be.
    const repeatedHeight = (pageIndex: number) =>
      pages[pageIndex]!.slices.flatMap((slice) =>
        slice.type === "table" ? slice.rows : [],
      )
        .filter((row) => row.repeated)
        .reduce((sum, row) => sum + row.height, 0);
    const continued = parts.filter((part) => repeatedHeight(part.pageIndex));
    expect(continued.length).toBeGreaterThan(0);
    for (const part of continued)
      expect(column.pageStarts[part.pageIndex]).toBeCloseTo(
        part.y - repeatedHeight(part.pageIndex),
      );
  });

  it("keeps the reading place inside a later part", () => {
    const part = parts[2]!;
    // Halfway down the part, below its repeated header.
    const y = part.y + part.height / 2;
    const line = findLineAtOrAfter(rows, 0, y)!;
    expect(line.anchor.blockId).toMatch(/-c\d+$/);
    expect(line.y).toBeGreaterThan(part.y);
    expect(line.y).toBeLessThan(part.y + part.height);
    // The anchor resolves to the first line of the same table row.
    const anchored = findAnchorOffset(rows, line.anchor)!;
    expect(anchored).toBeGreaterThanOrEqual(line.y);
    expect(anchored).toBeLessThan(line.y + line.height);

    const visible = findFirstFullyVisibleLine(rows, 0, y)!;
    expect(visible.y).toBeGreaterThanOrEqual(y);
    expect(visible.anchor.blockId).toMatch(/-c\d+$/);

    // A relayout finds the same row again by its text, at the row's top,
    // where the reading line measured it from.
    const position = findLineTextPosition(rows, line.y)!;
    expect(position.blockId).toBe(line.anchor.blockId);
    expect(findTextPositionOffset(rows, position)).toBe(line.y);
  });
});

describe("highlights and selections in cells", () => {
  const { canonicalText } = parse(CHAPTER, true);
  const word = "queue depth 7";
  const startOffset = canonicalText.fullText.indexOf(word);

  it("draws a highlight inside its cell", () => {
    const highlight: Highlight = {
      id: "h1",
      bookId: "book",
      spineItemId: "chapter",
      startOffset,
      endOffset: startOffset + word.length,
      selectedText: word,
      textBefore: "",
      textAfter: "",
      color: "yellow",
      createdAt: 0,
    };
    const { blocks } = decorateChapterContent({
      baseContent: {
        chapterIndex: 0,
        entry: { index: 0, spineItemId: "chapter", href: "c.xhtml", title: "" },
        html: CHAPTER,
        tables: true,
        canonicalText,
        bookStylesheets: [],
        publisherFontFaces: [],
      },
      highlights: [highlight],
    });
    const { pages } = layoutPages(
      prepareBlocks(blocks, FONT_CONFIG),
      360,
      400,
      LAYOUT_THEME,
    );
    const marked = tableSlices(pages)
      .flatMap((slice) => textSlicesOf([slice]))
      .flatMap((slice) => slice.lines)
      .flatMap((line) => line.fragments)
      .filter((fragment) => fragment.highlightMarks?.length)
      .map((fragment) => fragment.text.trim())
      .join(" ");
    expect(marked).toBe("queue depth 7");
  });

  it("turns a cell offset into an anchor and back", () => {
    const { blocks } = parse(CHAPTER, true);
    const prepared = prepareBlocks(blocks, FONT_CONFIG);
    const offset = startOffset + "queue ".length;
    const anchor = canonicalOffsetToContentAnchor({
      chapterIndex: 0,
      offset,
      chapterBlocks: blocks,
      preparedChapter: prepared,
      chapterCanonicalText: canonicalText,
    });
    expect(anchor?.blockId).toMatch(/-c\d+$/);
    expect(
      resolveTextAnchorToCanonicalOffset({
        anchor: anchor!,
        chapterBlocks: blocks,
        preparedChapter: prepared,
        chapterCanonicalText: canonicalText,
      }),
    ).toBe(offset);
  });
});

describe("copying from a table", () => {
  const copy = (html: string, start: string, end: string) => {
    const { blocks, canonicalText } = parse(html, true);
    return resolveCanonicalRangeText({
      chapterBlocks: blocks,
      chapterCanonicalText: canonicalText,
      startOffset: canonicalText.fullText.indexOf(start),
      endOffset: canonicalText.fullText.indexOf(end) + end.length,
    });
  };

  it("copies cells as tab-separated rows", () => {
    expect(copy(CHAPTER, "Name", "queue depth 1")).toBe(
      "Name\tLatency\tNotes\nprobe 0\t0 ms\tqueue depth 0\nprobe 1\t3 ms\tqueue depth 1",
    );
    // From partway along a row to partway along a later one.
    expect(copy(CHAPTER, "0 ms", "probe 1")).toBe(
      "0 ms\tqueue depth 0\nprobe 1",
    );
  });

  it("keeps columns in line past spanned and empty cells", () => {
    const html =
      "<body><table><tr><th colspan='2'>Pair</th><th>One</th></tr>" +
      "<tr><td rowspan='2'>Tall</td><td>a</td><td></td></tr>" +
      "<tr><td>b</td><td>line<br/>two</td></tr></table></body>";
    expect(copy(html, "Pair", "two")).toBe(
      "Pair\t\tOne\nTall\ta\t\n\tb\tline two",
    );
  });

  it("copies text in one cell, and the text around a table, as paragraphs", () => {
    expect(copy(CHAPTER, "queue depth 3", "queue depth 3")).toBe(
      "queue depth 3",
    );
    expect(copy(CHAPTER, "Before", "Latency")).toBe(
      "Before the table.\n\nTable 1 Sample latencies\n\nName\tLatency",
    );
  });
});

describe("a reading place across Grid and Paragraph", () => {
  // Tall enough to fill pages as one paragraph too.
  const chapter = `<body><p>Before the table.</p>${tableHtml(150)}<p>After the table.</p></body>`;
  const read = (tables: boolean) => {
    const { blocks, canonicalText } = parse(chapter, tables);
    const prepared = prepareBlocks(blocks, FONT_CONFIG);
    const { pages } = layoutPages(prepared, 360, 400, LAYOUT_THEME);
    const pageOf = (offset: number) =>
      resolveAnchorToPage(
        [pages],
        canonicalOffsetToContentAnchor({
          chapterIndex: 0,
          offset,
          chapterBlocks: blocks,
          preparedChapter: prepared,
          chapterCanonicalText: canonicalText,
        })!,
      )!.localPageIndex;
    const offsetOf = (anchor: ContentAnchor) =>
      resolveTextAnchorToCanonicalOffset({
        anchor,
        chapterBlocks: blocks,
        preparedChapter: prepared,
        chapterCanonicalText: canonicalText,
      });
    const translate = (anchor: ContentAnchor) =>
      readTableAnchor(
        anchor,
        blocks,
        prepared,
        (paragraph) =>
          prepareBlocks([paragraph], FONT_CONFIG)[0] as PreparedTextBlock,
      );
    return { blocks, canonicalText, pages, pageOf, offsetOf, translate };
  };
  const grid = read(true);
  const flat = read(false);
  const table = grid.blocks.find((block) => block.type === "table")!.id;
  /** A page well inside the table, past its first. */
  const tablePage = (pages: Page[], isTable: (page: Page) => boolean) =>
    pages.findIndex(isTable) + 3;

  it("numbers a paragraph's cells where the grid starts them", () => {
    const paragraph = flat.blocks.find((block) => block.id === table);
    expect(paragraph?.type === "text" && paragraph.tableCellStarts).toEqual(
      Array.from(
        { length: 151 * 3 },
        (_, n) =>
          grid.canonicalText.blockStarts.get(`${table}-c${n}`)! -
          grid.canonicalText.blockStarts.get(table)!,
      ),
    );
  });

  it("opens a place in a cell at its text in the paragraph", () => {
    const page = tablePage(grid.pages, (page) =>
      page.slices.some((slice) => slice.type === "table"),
    );
    const anchor = pickAnchorForPage([grid.pages], 0, page);
    expect(anchor.blockId).toMatch(new RegExp(`^${table}-c\\d+$`));
    const cellStart = grid.canonicalText.blockStarts.get(anchor.blockId)!;
    const opened = resolveAnchorToPage([flat.pages], flat.translate(anchor))!;
    expect(opened.localPageIndex).toBeGreaterThan(0);
    expect(opened.localPageIndex).toBe(flat.pageOf(cellStart));
  });

  it("opens a place in the paragraph at the cell that holds it", () => {
    const page = tablePage(flat.pages, (page) =>
      page.slices.some((slice) => slice.blockId === table),
    );
    const anchor = pickAnchorForPage([flat.pages], 0, page);
    expect(anchor.blockId).toBe(table);
    const offset = flat.offsetOf(anchor)!;
    const translated = grid.translate(anchor);
    expect(translated.blockId).toMatch(new RegExp(`^${table}-c\\d+$`));
    // The cell's cursor is at or just before the place.
    expect(offset - grid.offsetOf(translated)!).toBeGreaterThanOrEqual(0);
    expect(offset - grid.offsetOf(translated)!).toBeLessThan(20);
    const opened = resolveAnchorToPage([grid.pages], translated)!;
    expect(opened.localPageIndex).toBeGreaterThan(grid.pageOf(0));
    expect(opened.localPageIndex).toBe(grid.pageOf(offset));
  });
});
