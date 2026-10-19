import {
  layoutPages,
  prepareBlocks,
  getLineHeight,
  type Block,
  type FontConfig,
  type LayoutTheme,
} from "@/lib/pagination-v2";
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
