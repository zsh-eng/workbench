import {
  layoutPages,
  parseChapterHtml,
  parseChapterHtmlWithCanonicalText,
  prepareBlocks,
  type FontConfig,
  type LayoutTheme,
} from "@/lib/pagination-v2";
import type { Page } from "@/lib/pagination-v2/shared/types";
import { describe, expect, it } from "vitest";

// A blank line is a paragraph of only `&nbsp;`. Calibre writes two of them
// for a scene break.

const FONT_CONFIG: FontConfig = {
  bodyFamily: '"Inter", sans-serif',
  headingFamily: '"Inter", sans-serif',
  codeFamily: '"Courier New", monospace',
  baseSizePx: 16,
};

const THEME: LayoutTheme = {
  baseFontSizePx: 16,
  lineHeightFactor: 1.5,
  paragraphSpacingFactor: 1.2,
  textAlign: "left",
};

function layout(html: string, pageHeight: number, theme = THEME): Page[] {
  const blocks = prepareBlocks(parseChapterHtml(html), FONT_CONFIG);
  return layoutPages(blocks, 620, pageHeight, theme).pages;
}

function spacerHeights(pages: Page[]): number[] {
  return pages.flatMap((page) =>
    page.slices.flatMap((slice) =>
      slice.type === "spacer" && slice.blockId.startsWith("spacer-")
        ? [slice.height]
        : [],
    ),
  );
}

describe("blank lines", () => {
  it("keep a run of them as one spacer without moving later text", () => {
    // A paragraph of ordinary whitespace collapses away, as in a browser.
    const html = `
      <p>was richer by a whole thirty dollars.</p>
      <p>&nbsp;</p>
      <p>&nbsp;</p>
      <p> </p>
      <p>The Discworld turned against the glittering backdrop of space.</p>
    `;

    const { blocks, canonicalText } = parseChapterHtmlWithCanonicalText(html);

    expect(blocks.map((block) => [block.type, block.id])).toEqual([
      ["text", "text-1"],
      ["spacer", "spacer-2"],
      ["text", "text-5"],
    ]);
    expect(blocks[1]).toMatchObject({ kind: "blank-line" });
    expect(canonicalText.blockStarts.get("text-5")).toBe(
      canonicalText.fullText.indexOf("The Discworld"),
    );
  });

  it("are one line plus the paragraph gap, or one line in book rhythm", () => {
    const html = "<p>One.</p><p>&nbsp;</p><p>&nbsp;</p><p>Two.</p>";
    const lineHeight = 24; // 16 px × 1.5

    expect(spacerHeights(layout(html, 800))).toEqual([lineHeight * 2.2]);
    expect(
      spacerHeights(layout(html, 800, { ...THEME, bookRhythm: true })),
    ).toEqual([lineHeight]);
  });

  it("are dropped at the edges of a chapter", () => {
    const pages = layout(
      "<p>&nbsp;</p><h2>Title</h2><p>One.</p><p>&nbsp;</p><p>&nbsp;</p>",
      120,
    );

    expect(pages).toHaveLength(1);
    expect(pages[0]?.slices[0]).toMatchObject({ type: "text" });
    expect(spacerHeights(pages)).toEqual([]);
  });

  it("turn the page when they do not fit at its foot", () => {
    // Two lines and a gap fill 76.8 px of 120; the 52.8 px blank line does not
    // fit, so the next passage starts the next page without it.
    const pages = layout(
      "<p>One.</p><p>Two.</p><p>&nbsp;</p><p>Three.</p>",
      120,
    );

    expect(pages).toHaveLength(2);
    expect(spacerHeights(pages)).toEqual([]);
    expect(pages[1]?.slices[0]).toMatchObject({ type: "text" });
  });
});
