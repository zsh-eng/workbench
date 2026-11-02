import {
  layoutPages,
  prepareBlocks,
  getLineHeight,
  type Block,
  type FontConfig,
  type LayoutTheme,
} from "@/lib/pagination-v2";
import type { BlockTag, Page } from "@/lib/pagination-v2/shared/types";
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

describe("layoutPages — heading rhythm", () => {
  it("budgets enough line height for mobile Iowan heading metrics", () => {
    // Lower bounds: taller heading lines are a design choice, shorter ones are not.
    expect(getLineHeight("h1", LAYOUT_THEME)).toBeGreaterThanOrEqual(44);
    expect(getLineHeight("h3", LAYOUT_THEME)).toBeGreaterThanOrEqual(28);
  });
});

describe("layoutPages — image overflow spacing", () => {
  it("does not emit an orphaned pre-image spacer on the page before an overflowed image", () => {
    // Scenario: a text paragraph followed by an image. The page is too short to
    // hold both, so the image overflows to page 1. The spacing gap that belongs
    // above the image (margin-collapsing with the paragraph's margin-below)
    // must NOT be left as a trailing spacer on page 0 — it should be dropped
    // because the image now starts a fresh page where top-of-page margins are
    // suppressed (standard print layout behaviour).
    //
    // Dimensions chosen so:
    //   - one text line (~24 px) fits on page 0
    //   - the pre-image spacer (~19.2 px) also fits, reaching ~43 px used
    //   - the image (80 px) does NOT fit in the remaining ~57 px → overflows
    const blocks: Block[] = [
      {
        type: "text",
        id: "text-1",
        tag: "p",
        runs: [
          {
            kind: "text",
            text: "Short paragraph.",
            bold: false,
            italic: false,
            isCode: false,
          },
        ],
      },
      {
        type: "image",
        id: "image-1",
        src: "image.jpg",
        intrinsicWidth: 620,
        intrinsicHeight: 80,
      },
    ];

    const prepared = prepareBlocks(blocks, FONT_CONFIG);
    const { pages } = layoutPages(prepared, 620, 100, LAYOUT_THEME);

    // Confirm the image actually overflowed — if it didn't, the test is vacuous.
    const imagePageIndex = pages.findIndex((p) =>
      p.slices.some((s) => s.type === "image" && s.blockId === "image-1"),
    );
    expect(imagePageIndex).toBeGreaterThan(0);

    // No page that lacks the image should carry a spacer whose blockId matches
    // the image — that would be an orphaned pre-image spacing slice.
    const pagesWithOrphanedSpacer = pages.filter((page) => {
      const hasImage = page.slices.some(
        (s) => s.type === "image" && s.blockId === "image-1",
      );
      const hasOrphanedSpacer = page.slices.some(
        (s) => s.type === "spacer" && s.blockId === "image-1",
      );
      return hasOrphanedSpacer && !hasImage;
    });

    expect(pagesWithOrphanedSpacer).toHaveLength(0);
  });

  it("scales wide images by page width before laying out the remaining text", () => {
    const blocks: Block[] = [
      {
        type: "image",
        id: "wide-image",
        src: "wide-image.jpg",
        intrinsicWidth: 1000,
        intrinsicHeight: 500,
      },
      {
        type: "text",
        id: "text-1",
        tag: "p",
        runs: [
          {
            kind: "text",
            text: "Opening paragraph after a decorative chapter image.",
            bold: false,
            italic: false,
            isCode: false,
          },
        ],
      },
    ];

    const prepared = prepareBlocks(blocks, FONT_CONFIG);
    const { pages } = layoutPages(prepared, 300, 260, LAYOUT_THEME);
    const firstPage = pages[0];

    expect(firstPage).toBeDefined();
    expect(firstPage?.slices.some((slice) => slice.type === "image")).toBe(
      true,
    );
    expect(firstPage?.slices.some((slice) => slice.type === "text")).toBe(true);

    const imageSlice = firstPage?.slices.find(
      (slice) => slice.type === "image" && slice.blockId === "wide-image",
    );
    expect(imageSlice?.type).toBe("image");
    if (imageSlice?.type !== "image") return;

    expect(imageSlice.width).toBeCloseTo(300, 5);
    expect(imageSlice.height).toBeCloseTo(150, 5);
  });
});

describe("layoutPages — figcaption treatment", () => {
  it("keeps captions visually grouped with their figure image", () => {
    const blocks: Block[] = [
      {
        type: "image",
        id: "figure-image",
        src: "figure.jpg",
        intrinsicWidth: 620,
        intrinsicHeight: 240,
      },
      {
        type: "text",
        id: "figure-caption",
        tag: "figcaption",
        runs: [
          {
            kind: "text",
            text: "Figure 29. Caption text that should feel secondary to body copy.",
            bold: false,
            italic: false,
            isCode: false,
          },
        ],
      },
      {
        type: "text",
        id: "after-caption",
        tag: "p",
        runs: [
          {
            kind: "text",
            text: "Body text after the figure.",
            bold: false,
            italic: false,
            isCode: false,
          },
        ],
      },
    ];

    const prepared = prepareBlocks(blocks, FONT_CONFIG);
    const preparedCaption = prepared.find(
      (block) => block.type === "text" && block.id === "figure-caption",
    );
    expect(preparedCaption?.type).toBe("text");
    if (!preparedCaption || preparedCaption.type !== "text") return;

    const captionText = preparedCaption.items.find(
      (item) => item.kind === "text",
    );
    expect(captionText?.font).toContain(" 13px ");

    const { pages } = layoutPages(prepared, 620, 860, {
      ...LAYOUT_THEME,
      textAlign: "justify",
    });
    const slices = pages.flatMap((page) => page.slices);

    const captionSpacer = slices.find(
      (slice) => slice.type === "spacer" && slice.blockId === "figure-caption",
    );
    expect(captionSpacer?.type).toBe("spacer");
    if (captionSpacer && captionSpacer.type === "spacer") {
      expect(captionSpacer.height).toBeCloseTo(9.6, 5);
    }

    const captionSlice = slices.find(
      (slice) => slice.type === "text" && slice.blockId === "figure-caption",
    );
    expect(captionSlice?.type).toBe("text");
    if (!captionSlice || captionSlice.type !== "text") return;

    expect(captionSlice.tag).toBe("figcaption");
    expect(captionSlice.lineHeight).toBeCloseTo(18, 5);
    expect(captionSlice.textAlign).toBe("left");
  });
});

describe("layoutPages — blockquote parity", () => {
  it("uses blockquote spacing and carries tag into text slices", () => {
    const blocks: Block[] = [
      {
        type: "text",
        id: "intro",
        tag: "p",
        runs: [
          {
            kind: "text",
            text: "Intro paragraph.",
            bold: false,
            italic: false,
            isCode: false,
          },
        ],
      },
      {
        type: "text",
        id: "quote",
        tag: "blockquote",
        runs: [
          {
            kind: "text",
            text: "Quoted sentence.",
            bold: false,
            italic: false,
            isCode: false,
          },
        ],
      },
      {
        type: "text",
        id: "after",
        tag: "p",
        runs: [
          {
            kind: "text",
            text: "After paragraph.",
            bold: false,
            italic: false,
            isCode: false,
          },
        ],
      },
    ];

    const prepared = prepareBlocks(blocks, FONT_CONFIG);
    const { pages } = layoutPages(prepared, 620, 860, LAYOUT_THEME);
    const slices = pages.flatMap((page) => page.slices);

    const quoteSlice = slices.find(
      (slice) => slice.type === "text" && slice.blockId === "quote",
    );
    expect(quoteSlice?.type).toBe("text");
    if (!quoteSlice || quoteSlice.type !== "text") return;
    expect(quoteSlice.tag).toBe("blockquote");

    const spacerBeforeQuote = slices.find(
      (slice) => slice.type === "spacer" && slice.blockId === "quote",
    );
    expect(spacerBeforeQuote?.type).toBe("spacer");
    if (spacerBeforeQuote && spacerBeforeQuote.type === "spacer") {
      expect(spacerBeforeQuote.height).toBeCloseTo(28.8, 5);
    }

    const spacerBeforeAfterParagraph = slices.find(
      (slice) => slice.type === "spacer" && slice.blockId === "after",
    );
    expect(spacerBeforeAfterParagraph?.type).toBe("spacer");
    if (
      spacerBeforeAfterParagraph &&
      spacerBeforeAfterParagraph.type === "spacer"
    ) {
      expect(spacerBeforeAfterParagraph.height).toBeCloseTo(24, 5);
    }
  });

  it("forces italicized quote fonts during preparation", () => {
    const blocks: Block[] = [
      {
        type: "text",
        id: "quote-fonts",
        tag: "blockquote",
        runs: [
          {
            kind: "text",
            text: "normal ",
            bold: false,
            italic: false,
            isCode: false,
          },
          {
            kind: "text",
            text: "bold",
            bold: true,
            italic: false,
            isCode: false,
          },
        ],
      },
    ];

    const prepared = prepareBlocks(blocks, FONT_CONFIG);
    expect(prepared).toHaveLength(1);
    const quoteBlock = prepared[0];
    expect(quoteBlock?.type).toBe("text");
    if (!quoteBlock || quoteBlock.type !== "text") return;

    const textItems = quoteBlock.items.filter((item) => item.kind === "text");
    expect(textItems.length).toBeGreaterThan(0);
    for (const item of textItems) {
      expect(item.font.startsWith("italic ")).toBe(true);
    }
  });

  it("keeps tag metadata across multi-page quote slices", () => {
    const blocks: Block[] = [
      {
        type: "text",
        id: "quote-long",
        tag: "blockquote",
        runs: [
          {
            kind: "text",
            text: "This quote should span multiple pages. ".repeat(160),
            bold: false,
            italic: false,
            isCode: false,
          },
        ],
      },
    ];

    const prepared = prepareBlocks(blocks, FONT_CONFIG);
    const { pages } = layoutPages(prepared, 620, 120, LAYOUT_THEME);
    const quoteSlices = pages
      .flatMap((page) => page.slices)
      .filter(
        (slice) => slice.type === "text" && slice.blockId === "quote-long",
      );

    expect(quoteSlices.length).toBeGreaterThan(1);
    for (const slice of quoteSlices) {
      expect(slice.tag).toBe("blockquote");
    }
  });
});

describe("layoutPages — a book's rhythm", () => {
  const BOOK_THEME: LayoutTheme = { ...LAYOUT_THEME, bookRhythm: true };
  const LINE = 24;
  const WORDS = "the quick brown fox jumps over the lazy dog and runs ";

  function text(id: string, tag: BlockTag, length: number): Block {
    return {
      type: "text",
      id,
      tag,
      runs: [
        {
          kind: "text",
          text: WORDS.repeat(Math.ceil(length / WORDS.length))
            .slice(0, length)
            .trim(),
          bold: false,
          italic: false,
          isCode: false,
        },
      ],
    };
  }

  const prepare = (blocks: Block[]) => prepareBlocks(blocks, FONT_CONFIG);

  /** Each text slice's top on its page, with its height. */
  function textTops(page: Page) {
    let top = 0;
    const tops: { blockId: string; top: number; lines: number }[] = [];
    for (const slice of page.slices) {
      if (slice.type === "spacer") top += slice.height;
      if (slice.type !== "text") continue;
      tops.push({ blockId: slice.blockId, top, lines: slice.lines.length });
      top += slice.lines.length * slice.lineHeight;
    }
    return tops;
  }

  it("sets paragraphs solid, and indents all but the first", () => {
    const { pages } = layoutPages(
      prepare([
        text("heading", "h2", 20),
        text("first", "p", 200),
        text("second", "p", 200),
      ]),
      320,
      2000,
      BOOK_THEME,
    );

    const slices = pages[0]!.slices.filter((slice) => slice.type === "text");
    expect(slices.map((slice) => slice.blockId)).toEqual([
      "heading",
      "first",
      "second",
    ]);
    expect(pages[0]!.slices.filter((s) => s.type === "spacer")).toHaveLength(1);
    expect(slices[1]!.lines[0]!.indentPx).toBeUndefined();
    expect(slices[2]!.lines[0]!.indentPx).toBeCloseTo(19.2);
    expect(slices[2]!.lines[1]!.indentPx).toBeUndefined();
  });

  it("starts body text on the line grid after a heading or a quotation", () => {
    const { pages } = layoutPages(
      prepare([
        text("heading", "h2", 20),
        text("body", "p", 120),
        text("quote", "blockquote", 120),
        text("after", "p", 120),
        text("heading-2", "h3", 20),
        text("end", "p", 120),
      ]),
      320,
      2000,
      BOOK_THEME,
    );

    const tops = textTops(pages[0]!).filter(
      ({ blockId }) => !blockId.startsWith("heading"),
    );
    expect(tops).toHaveLength(4);
    for (const { top } of tops) {
      expect(top % LINE).toBeCloseTo(0);
    }
  });

  it("leaves no first line alone at a page's foot", () => {
    // Room for the first paragraph and one line of the next.
    const blocks = [
      text("before", "p", 280),
      text("next", "p", 280),
      text("end", "p", 40),
    ];
    const prepared = prepare(blocks);
    const beforeLines = layoutPages(prepared, 320, 2000, BOOK_THEME).pages[0]!
      .slices[0]!;
    if (beforeLines.type !== "text") throw new Error("Expected text");

    const height = (beforeLines.lines.length + 1) * LINE;
    const { pages } = layoutPages(prepared, 320, height, BOOK_THEME);

    expect(textTops(pages[0]!).map(({ blockId }) => blockId)).toEqual([
      "before",
    ]);
    expect(textTops(pages[1]!)[0]).toMatchObject({ blockId: "next", top: 0 });
  });

  it("leaves no last line alone at a page's head", () => {
    const paragraph = text("long", "p", 900);
    const prepared = prepare([paragraph]);
    const all = layoutPages(prepared, 320, 10_000, BOOK_THEME).pages[0]!
      .slices[0]!;
    if (all.type !== "text") throw new Error("Expected text");

    // One line short of the whole paragraph.
    const height = (all.lines.length - 1) * LINE;
    const { pages } = layoutPages(prepared, 320, height, BOOK_THEME);

    expect(pages).toHaveLength(2);
    expect(textTops(pages[0]!)[0]!.lines).toBe(all.lines.length - 2);
    expect(textTops(pages[1]!)[0]!.lines).toBe(2);
  });

  it("gives a line's worth of height to a page too short to obey", () => {
    const prepared = prepare([text("tall", "p", 600)]);
    const { pages } = layoutPages(prepared, 320, 120, {
      ...BOOK_THEME,
      lineHeightFactor: 4.5,
    });

    expect(pages.length).toBeGreaterThan(1);
    const shown = pages.flatMap(textTops);
    expect(shown.every(({ lines }) => lines >= 1)).toBe(true);
  });
});
