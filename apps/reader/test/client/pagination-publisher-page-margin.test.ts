import {
  layoutPages,
  parseChapterHtml,
  parseChapterHtmlWithCanonicalText,
  prepareBlocks,
  type BookStylesheet,
  type FontConfig,
  type LayoutTheme,
  type TextBlock,
} from "@/lib/pagination-v2";
import { describe, expect, it } from "vitest";

const FONT_CONFIG: FontConfig = {
  bodyFamily: '"Lora", serif',
  headingFamily: '"Lora", serif',
  codeFamily: '"Courier New", monospace',
  baseSizePx: 16,
};

const LAYOUT_THEME: LayoutTheme = {
  baseFontSizePx: 16,
  lineHeightFactor: 1.5,
  paragraphSpacingFactor: 0.8,
  textAlign: "left",
};

const PROSE =
  "The Discworld turned against the glittering backdrop of space, spinning very gently on the backs of the four giant elephants that perched on the shell of Great A'Tuin the star turtle.";

/** Calibre's shape: the body's own margin, then every paragraph's 1em. */
function stylesheet(extra = ""): BookStylesheet[] {
  return [
    {
      basePath: "OEBPS/stylesheet.css",
      cssText: `
        .calibre3 { margin-left: 5pt; margin-right: 5pt; }
        .calibre4 { margin: 0 1em; text-align: justify; text-indent: 1.5em; }
        ${extra}
      `,
    },
  ];
}

function chapter(paragraphs: string[]): string {
  return `<div class="calibre3">${paragraphs.join("")}</div>`;
}

const body = (count: number) =>
  Array.from({ length: count }, () => `<p class="calibre4">${PROSE}</p>`);

function styled(html: string, sheets: BookStylesheet[]): TextBlock[] {
  return parseChapterHtml(html, {
    publisherBookStylingEnabled: true,
    bookStylesheets: sheets,
  }).filter((block): block is TextBlock => block.type === "text");
}

function layOut(blocks: TextBlock[]) {
  const prepared = prepareBlocks(blocks, FONT_CONFIG, {
    publisherBookStylingEnabled: true,
  });
  return layoutPages(prepared, 400, 2000, LAYOUT_THEME).pages.flatMap(
    (page) => page.slices.filter((slice) => slice.type === "text"),
  );
}

describe("a book's page margin, set on its paragraphs", () => {
  it("comes off body text, which then runs the full measure", () => {
    const blocks = styled(chapter(body(4)), stylesheet());

    for (const block of blocks) {
      expect(block.publisherStyle?.margin?.left).toBeUndefined();
      expect(block.publisherStyle?.margin?.right).toBeUndefined();
      expect(block.publisherStyle?.textIndent).toEqual({ em: 1.5 });
    }

    const plain = layOut(
      styled(
        chapter(body(4)),
        stylesheet(".calibre4 { margin: 0; text-indent: 1.5em; }"),
      ),
    );
    const slices = layOut(blocks);
    expect(slices.map((slice) => slice.lines.length)).toEqual(
      plain.map((slice) => slice.lines.length),
    );
    for (const slice of slices) {
      if (slice.type !== "text") continue;
      expect(slice.marginLeftPx).toBeUndefined();
    }
  });

  it("leaves a block quote only what it has beyond the body's margin", () => {
    const blocks = styled(
      chapter([
        ...body(4),
        `<p class="calibre4 letter">${PROSE}</p>`,
        ...body(1),
      ]),
      stylesheet(".letter { margin-left: 3em; margin-right: 2em; }"),
    );

    expect(blocks[4]?.publisherStyle?.margin).toMatchObject({
      left: { em: 2 },
      right: { em: 1 },
    });
    const letter = layOut(blocks)[4];
    expect(letter?.type === "text" && letter.marginLeftPx).toBe(32);
  });

  it("takes the margin most of the body text shares", () => {
    const narrow = `<p class="calibre4 narrow">${PROSE}</p>`;
    const mostlyWide = styled(
      chapter([...body(3), narrow]),
      stylesheet(".narrow { margin: 0 0.5em; }"),
    );
    const sides = (block: TextBlock | undefined) => ({
      left: block?.publisherStyle?.margin?.left,
      right: block?.publisherStyle?.margin?.right,
    });
    const none = { left: undefined, right: undefined };
    expect(mostlyWide.map(sides)).toEqual([none, none, none, none]);

    const mostlyNarrow = styled(
      chapter([...body(1), narrow, narrow, narrow]),
      stylesheet(".narrow { margin: 0 0.5em; }"),
    );
    expect(sides(mostlyNarrow[0])).toEqual({
      left: { em: 0.5 },
      right: { em: 0.5 },
    });
    expect(sides(mostlyNarrow[1])).toEqual(none);
  });

  it("stays when the chapter has too little body text to tell", () => {
    const [only] = styled(
      chapter(['<p class="calibre4">A short dedication.</p>']),
      stylesheet(),
    );
    expect(only?.publisherStyle?.margin).toMatchObject({
      left: { em: 1 },
      right: { em: 1 },
    });
  });

  it("changes no block or text offsets", () => {
    const html = chapter([...body(3), "<h2>Part Two</h2>", ...body(2)]);
    const plain = parseChapterHtmlWithCanonicalText(html);
    const withStyles = parseChapterHtmlWithCanonicalText(html, {
      publisherBookStylingEnabled: true,
      bookStylesheets: stylesheet(),
    });

    expect(withStyles.blocks.map((block) => block.id)).toEqual(
      plain.blocks.map((block) => block.id),
    );
    expect(withStyles.canonicalText.fullText).toBe(
      plain.canonicalText.fullText,
    );
    expect([...withStyles.canonicalText.blockStarts]).toEqual([
      ...plain.canonicalText.blockStarts,
    ]);
  });
});
