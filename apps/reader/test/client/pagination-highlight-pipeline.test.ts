import { decorateChapterContent } from "@/features/reader/data/chapter-content-pipeline";
import {
  layoutPages,
  parseChapterHtml,
  parseChapterHtmlWithCanonicalText,
  prepareBlocks,
  type FontConfig,
  type LayoutTheme,
} from "@/lib/pagination-v2";
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

describe("pagination highlight pipeline", () => {
  it("carries nested highlight metadata from parse to page fragments", () => {
    const html =
      '<p>Hello <mark data-highlight-id="h1" data-color="yellow">ab<mark data-highlight-id="h2" data-color="blue">cd</mark>ef</mark> world</p>';

    const blocks = parseChapterHtml(html);
    const prepared = prepareBlocks(blocks, FONT_CONFIG);
    const { pages } = layoutPages(prepared, 620, 120, LAYOUT_THEME);

    const fragments = pages
      .flatMap((page) => page.slices)
      .filter((slice) => slice.type === "text")
      .flatMap((slice) => slice.lines)
      .flatMap((line) => line.fragments);

    const singleMarked = fragments.find(
      (fragment) =>
        fragment.text.includes("ab") && fragment.highlightMarks?.length === 1,
    );
    expect(singleMarked?.highlightMarks).toEqual([
      { id: "h1", color: "yellow" },
    ]);

    const stacked = fragments.find(
      (fragment) =>
        fragment.text.includes("cd") && fragment.highlightMarks?.length === 2,
    );
    expect(stacked?.highlightMarks).toEqual([
      { id: "h1", color: "yellow" },
      { id: "h2", color: "blue" },
    ]);
  });
});

/**
 * The lines of each page, with highlighted text in brackets. The test canvas
 * measures every character as 8px wide, so these breaks are deterministic.
 */
function pageLines(
  html: string,
  highlightedWord: string | null,
  pageWidth: number,
  pageHeight: number,
): string[][] {
  const { canonicalText } = parseChapterHtmlWithCanonicalText(html);
  const highlights: Highlight[] = [];
  if (highlightedWord) {
    const startOffset = canonicalText.fullText.indexOf(highlightedWord);
    highlights.push({
      id: "h1",
      bookId: "book",
      spineItemId: "chapter",
      startOffset,
      endOffset: startOffset + highlightedWord.length,
      selectedText: highlightedWord,
      textBefore: "",
      textAfter: "",
      color: "yellow",
      createdAt: 0,
    });
  }
  const { blocks } = decorateChapterContent({
    baseContent: {
      chapterIndex: 0,
      entry: { index: 0, spineItemId: "chapter", href: "c.xhtml", title: "" },
      html,
      canonicalText,
      bookStylesheets: [],
      publisherFontFaces: [],
    },
    highlights,
  });
  const { pages } = layoutPages(
    prepareBlocks(blocks, FONT_CONFIG),
    pageWidth,
    pageHeight,
    LAYOUT_THEME,
  );
  return pages.map((page) =>
    page.slices.flatMap((slice) =>
      slice.type === "text"
        ? slice.lines.map((line) =>
            line.fragments
              .map(
                (fragment) =>
                  (fragment.leadingGap > 0 ? " " : "") +
                  (fragment.highlightMarks
                    ? `[${fragment.text}]`
                    : fragment.text),
              )
              .join("")
              .trim(),
          )
        : [],
    ),
  );
}

// A phone selects a word without the quotes and commas around it, so a
// highlight often starts or ends inside what line breaking treats as one word.
describe("a highlight that starts or ends inside a word", () => {
  const html =
    "<p>The lamp was low and the hall was quiet when the two of them came in from the rain. \u201cNothing moves here,\u201d she said, and the door closed behind them both.</p>";

  it("stays on the page where its word was, before a comma", () => {
    const plain = pageLines(html, null, 156, 144);
    expect(plain[1]?.[0]).toBe("here,\u201d she said,");

    expect(pageLines(html, "here", 156, 144)).toEqual([
      plain[0],
      ["[here],\u201d she said,", ...plain[1]!.slice(1)],
    ]);
  });

  it("does not split its word over two pages, after an opening quote", () => {
    const plain = pageLines(html, null, 148, 120);
    expect(plain[1]?.[0]).toBe("\u201cNothing moves");

    expect(pageLines(html, "Nothing", 148, 120)).toEqual([
      plain[0],
      ["\u201c[Nothing] moves", ...plain[1]!.slice(1)],
    ]);
  });
});

// Blocks with <br> are laid out run by run, so a highlighted word is its own
// run there even when spaces surround it.
describe("a highlight in a block with line breaks", () => {
  const html =
    "<p>The lamp was low and the hall was quiet when the two of them came in from the rain. “Nothing moves here,” she said, and the door closed behind them both.<br/>Then the lamp went out.</p>";

  it.each([
    ["here", 172],
    ["Nothing", 144],
    ["said", 232],
  ])("keeps %s whole and on the line where it was", (word, width) => {
    const plain = pageLines(html, null, width, 1000);
    const highlighted = pageLines(html, word, width, 1000);

    expect(highlighted.flat()).toContainEqual(
      expect.stringContaining(`[${word}]`),
    );
    expect(
      highlighted.map((page) => page.map((line) => line.replace(/[[\]]/g, ""))),
    ).toEqual(plain);
  });
});
