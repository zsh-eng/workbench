import { decorateChapterContent } from "@/features/reader/data/chapter-content-pipeline";
import {
  layoutPages,
  parseChapterHtmlWithCanonicalText,
  prepareBlocks,
  textSlicesOf,
  type Block,
  type FontConfig,
  type LayoutTheme,
  type Page,
  type TableSlice,
} from "@/lib/pagination-v2";
import {
  pickAnchorForPage,
  resolveAnchorToPage,
} from "@/lib/pagination-v2/engine/anchors";
import {
  canonicalOffsetToContentAnchor,
  resolveTextAnchorToCanonicalOffset,
} from "@/lib/pagination-v2/engine/highlight-selection";
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
    // The caption keeps with the table.
    const caption = blocks[blocks.indexOf(table) - 1];
    expect(caption?.type === "text" && caption.tag).toBe("figcaption");
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
        canonicalText,
        bookStylesheets: [],
        publisherFontFaces: [],
      },
      highlights: [highlight],
      tables: true,
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
