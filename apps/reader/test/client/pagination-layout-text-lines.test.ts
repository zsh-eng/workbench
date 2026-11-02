import type {
  Block,
  FontConfig,
  PageLine,
  PreparedInlineItem,
  TextCursorOffset,
} from "@/lib/pagination-v2";
import {
  layoutPreWrapLines,
  layoutTextLines,
  prepareBlocks,
} from "@/lib/pagination-v2";
import type { HyphenPoints } from "@/lib/pagination-v2/shared/hyphenation";
import {
  measureCollapsedSpaceWidth,
  measureTextWidth,
} from "@/lib/pagination-v2/shared/measure";
import { describe, expect, it } from "vitest";

const BASE_FONT_CONFIG: FontConfig = {
  bodyFamily: '"Inter", sans-serif',
  headingFamily: '"Inter", sans-serif',
  codeFamily: '"Courier New", monospace',
  baseSizePx: 16,
};

function compareOffsets(a: TextCursorOffset, b: TextCursorOffset): number {
  if (a.itemIndex !== b.itemIndex) {
    return a.itemIndex < b.itemIndex ? -1 : 1;
  }
  if (a.segmentIndex !== b.segmentIndex) {
    return a.segmentIndex < b.segmentIndex ? -1 : 1;
  }
  if (a.graphemeIndex !== b.graphemeIndex) {
    return a.graphemeIndex < b.graphemeIndex ? -1 : 1;
  }
  return 0;
}

describe("layoutPreWrapLines cursor offsets", () => {
  it("produces populated and monotonic line offsets", () => {
    const blocks: Block[] = [
      {
        type: "text",
        id: "pre-block",
        tag: "pre",
        runs: [
          {
            kind: "text",
            text: [
              "const alpha = 1;",
              "const beta = alpha + 2;",
              "const gamma = beta * 3;",
              "console.log(gamma);",
            ].join("\n"),
            bold: false,
            italic: false,
            isCode: true,
          },
        ],
      },
    ];

    const prepared = prepareBlocks(blocks, BASE_FONT_CONFIG);
    const textBlock = prepared[0];
    expect(textBlock?.type).toBe("text");
    if (!textBlock || textBlock.type !== "text") return;

    const lines = layoutPreWrapLines(textBlock.items, 180);
    expect(lines.length).toBeGreaterThan(1);

    for (const line of lines) {
      expect(line.startOffset).toBeDefined();
      expect(line.endOffset).toBeDefined();
      if (!line.startOffset || !line.endOffset) continue;

      expect(line.startOffset.itemIndex).toBe(0);
      expect(line.endOffset.itemIndex).toBe(0);
      expect(compareOffsets(line.startOffset, line.endOffset)).toBeLessThan(0);
    }

    for (let index = 1; index < lines.length; index++) {
      const previous = lines[index - 1];
      const current = lines[index];
      if (!previous?.endOffset || !current?.startOffset) continue;

      expect(
        compareOffsets(previous.endOffset, current.startOffset),
      ).toBeLessThanOrEqual(0);
    }
  });

  it("preserves highlight mark metadata on wrapped text fragments", () => {
    const blocks: Block[] = [
      {
        type: "text",
        id: "highlighted-block",
        tag: "p",
        runs: [
          {
            kind: "text",
            text: "alpha ",
            bold: false,
            italic: false,
            isCode: false,
          },
          {
            kind: "text",
            text: "beta gamma delta epsilon zeta eta theta",
            bold: false,
            italic: false,
            isCode: false,
            highlightMarks: [
              { id: "h1", color: "yellow", isStart: true, isEnd: true },
            ],
          },
        ],
      },
    ];

    const prepared = prepareBlocks(blocks, BASE_FONT_CONFIG);
    const textBlock = prepared[0];
    expect(textBlock?.type).toBe("text");
    if (!textBlock || textBlock.type !== "text") return;

    const { lines } = layoutTextLines(textBlock.items, 170);
    expect(lines.length).toBeGreaterThan(1);

    const markedFragments = lines
      .flatMap((line) => line.fragments)
      .filter((fragment) =>
        fragment.highlightMarks?.some((mark) => mark.id === "h1"),
      );

    expect(markedFragments.length).toBeGreaterThan(0);
    expect(
      markedFragments.every(
        (fragment) => fragment.highlightMarks?.[0]?.color === "yellow",
      ),
    ).toBe(true);
    expect(markedFragments[0]?.highlightMarks?.[0]?.isStart).toBe(true);
    expect(markedFragments[0]?.highlightMarks?.[0]?.isEnd).not.toBe(true);
    expect(
      markedFragments
        .slice(1, -1)
        .every(
          (fragment) =>
            fragment.highlightMarks?.[0]?.isStart !== true &&
            fragment.highlightMarks?.[0]?.isEnd !== true,
        ),
    ).toBe(true);
    expect(
      markedFragments[markedFragments.length - 1]?.highlightMarks?.[0]?.isEnd,
    ).toBe(true);
  });

  it("carries link metadata through preparation and rendered fragments", () => {
    const blocks: Block[] = [
      {
        type: "text",
        id: "linked-block",
        tag: "p",
        runs: [
          {
            kind: "text",
            text: "alpha beta gamma delta epsilon",
            bold: false,
            italic: false,
            isCode: false,
            link: { href: "OEBPS/Text/Chapter2.xhtml#target" },
          },
        ],
      },
    ];

    const prepared = prepareBlocks(blocks, BASE_FONT_CONFIG);
    const textBlock = prepared[0];
    expect(textBlock?.type).toBe("text");
    if (!textBlock || textBlock.type !== "text") return;

    const { lines } = layoutTextLines(textBlock.items, 170);
    const linkedFragments = lines
      .flatMap((line) => line.fragments)
      .filter((fragment) => fragment.link?.href);

    expect(linkedFragments.length).toBeGreaterThan(0);
    expect(
      linkedFragments.every(
        (fragment) =>
          fragment.link?.href === "OEBPS/Text/Chapter2.xhtml#target",
      ),
    ).toBe(true);
  });

  it("wraps before a new inline run instead of taking only its first grapheme", () => {
    const blocks: Block[] = [
      {
        type: "text",
        id: "run-boundary-block",
        tag: "p",
        runs: [
          {
            kind: "text",
            text: "Alpha beta gamma delta. ",
            bold: false,
            italic: false,
            isCode: false,
          },
          {
            kind: "text",
            text: "Brush the damn teeth.",
            bold: false,
            italic: false,
            isCode: false,
          },
        ],
      },
    ];

    const prepared = prepareBlocks(blocks, BASE_FONT_CONFIG);
    const textBlock = prepared[0];
    expect(textBlock?.type).toBe("text");
    if (!textBlock || textBlock.type !== "text") return;

    const firstRunWidth = textBlock.items[0]?.fullWidth ?? 0;
    const secondRunFirstWordWidth = textBlock.items[1]
      ? textBlock.items[1].prepared.widths[0]
      : 0;
    const { lines } = layoutTextLines(
      textBlock.items,
      firstRunWidth + secondRunFirstWordWidth / 2,
    );
    const firstLineText = lines[0]?.fragments
      .map((fragment) => fragment.text)
      .join("");
    const secondLineText = lines[1]?.fragments
      .map((fragment) => fragment.text)
      .join("");

    expect(firstLineText).toBe("Alpha beta gamma delta.");
    expect(secondLineText?.startsWith("Brush")).toBe(true);
  });

  it("uses extra native wrap safety when text contains zero-width breaks", () => {
    const blocks: Block[] = [
      {
        type: "text",
        id: "zero-width-break-block",
        tag: "p",
        runs: [
          {
            kind: "text",
            text: "alpha\u200B beta",
            bold: false,
            italic: false,
            isCode: false,
          },
        ],
      },
    ];

    const prepared = prepareBlocks(blocks, BASE_FONT_CONFIG);
    const textBlock = prepared[0];
    expect(textBlock?.type).toBe("text");
    if (!textBlock || textBlock.type !== "text") return;

    const itemWidth = textBlock.items[0]?.fullWidth ?? 0;
    const { lines } = layoutTextLines(textBlock.items, itemWidth + 7);
    const renderedLines = lines.map((line) =>
      line.fragments.map((fragment) => fragment.text).join(""),
    );

    expect(renderedLines).toEqual(["alpha\u200B ", "beta"]);
  });

  it("reserves extra width for note-ref hit areas while keeping plain superscripts lightweight", () => {
    const blocks: Block[] = [
      {
        type: "text",
        id: "sup-block",
        tag: "p",
        runs: [
          {
            kind: "text",
            text: "12",
            bold: false,
            italic: false,
            isCode: false,
            inlineRole: "note-ref",
            link: { href: "#note-12" },
          },
          {
            kind: "text",
            text: "2",
            bold: false,
            italic: false,
            isCode: false,
            inlineRole: "superscript",
          },
        ],
      },
    ];

    const prepared = prepareBlocks(blocks, BASE_FONT_CONFIG);
    const textBlock = prepared[0];
    expect(textBlock?.type).toBe("text");
    if (!textBlock || textBlock.type !== "text") return;

    expect(textBlock.items).toHaveLength(2);
    expect(textBlock.items[0]?.inlineRole).toBe("note-ref");
    expect(textBlock.items[0]?.chromeWidth).toBeGreaterThan(0);
    expect(textBlock.items[1]?.inlineRole).toBe("superscript");
    expect(textBlock.items[1]?.chromeWidth).toBe(0);
    expect(textBlock.items[0]?.font).toContain("12px");
    expect(textBlock.items[1]?.font).toContain("12px");

    const { lines } = layoutTextLines(textBlock.items, 240);
    const fragments = lines.flatMap((line) => line.fragments);
    expect(
      fragments.find((fragment) => fragment.text === "12")?.inlineRole,
    ).toBe("note-ref");
    expect(
      fragments.find((fragment) => fragment.text === "2")?.inlineRole,
    ).toBe("superscript");
  });

  it("preserves item boundaries for run-owned targets in pre-wrap layout", () => {
    const blocks: Block[] = [
      {
        type: "text",
        id: "pre-targets",
        tag: "pre",
        runs: [
          {
            kind: "text",
            text: "const alpha = 1;\n",
            bold: false,
            italic: false,
            isCode: true,
          },
          {
            kind: "text",
            text: "const beta = alpha + 2;\nconst gamma = beta * 3;",
            bold: false,
            italic: false,
            isCode: true,
            targetIds: ["mid-pre"],
          },
        ],
      },
    ];

    const prepared = prepareBlocks(blocks, BASE_FONT_CONFIG);
    const textBlock = prepared[0];
    expect(textBlock?.type).toBe("text");
    if (!textBlock || textBlock.type !== "text") return;

    expect(textBlock.items.map((item) => item.kind)).toEqual(["text", "text"]);
    expect(textBlock.items[1]?.targetIds).toEqual(["mid-pre"]);

    const lines = layoutPreWrapLines(textBlock.items, 180);
    expect(lines.length).toBeGreaterThan(1);

    const fragmentText = lines
      .flatMap((line) => line.fragments)
      .map((fragment) => fragment.text)
      .join("");
    expect(fragmentText).toContain("const beta = alpha + 2;");
    expect(fragmentText).not.toContain("mid-pre");

    const laterOffsets = lines
      .map((line) => line.startOffset?.itemIndex ?? -1)
      .filter((itemIndex) => itemIndex >= 0);
    expect(laterOffsets.some((itemIndex) => itemIndex >= 1)).toBe(true);
  });
});

type Run = Block extends infer B
  ? B extends { type: "text"; runs: (infer R)[] }
    ? Partial<R> & { text: string }
    : never
  : never;

function prepareParagraph(runs: Run[]): PreparedInlineItem[] {
  const [block] = prepareBlocks(
    [
      {
        type: "text",
        id: "paragraph",
        tag: "p",
        runs: runs.map((run) => ({
          kind: "text" as const,
          bold: false,
          italic: false,
          isCode: false,
          ...run,
        })),
      },
    ],
    BASE_FONT_CONFIG,
  );
  if (block?.type !== "text") throw new Error("Expected a text block");
  return block.items;
}

const lineText = (line: PageLine) =>
  line.fragments
    .map((fragment) => (fragment.leadingGap > 0 ? " " : "") + fragment.text)
    .join("");

/** Any point past the third letter, as a language's patterns might give. */
const EVERY_THIRD_LETTER: HyphenPoints = (segment) => {
  const points: number[] = [];
  for (let point = 3; point <= segment.length - 3; point += 3) {
    points.push(point);
  }
  return points;
};

/** How wide a line's word spaces are drawn, against natural width 1. */
function spaceRatio(line: PageLine, spaceWidth: number): number {
  return (spaceWidth + (line.wordSpacingPx ?? 0)) / spaceWidth;
}

const PROSE =
  "Alice was beginning to get very tired of sitting by her sister on the bank, and of having nothing to do: once or twice she had peeped into the book her sister was reading, but it had no pictures or conversations in it, and what is the use of a book, thought Alice, without pictures or conversations?";

describe("justified text", () => {
  const justified = (
    items: PreparedInlineItem[],
    width: number,
    options?: Parameters<typeof layoutTextLines>[2],
  ) =>
    layoutTextLines(items, width, {
      textAlign: "justify-knuth-plass",
      ...options,
    });

  it("sets each line but the last to the column, and the last at natural spaces", () => {
    const items = prepareParagraph([{ text: PROSE }]);
    const width = 400;

    const { lines, renderMode } = justified(items, width);

    expect(renderMode).toBe("manual-justify");
    expect(lines.length).toBeGreaterThan(3);
    for (const line of lines.slice(0, -1)) {
      const text = lineText(line).trimEnd();
      const spaces = text.split(" ").length - 1;
      const drawn =
        measureTextWidth(text, items[0]!.font) +
        spaces * line.wordSpacingPx! +
        3; // the browser's justification closes this slack
      expect(drawn).toBeCloseTo(width, 5);
    }
    expect(lines.at(-1)!.wordSpacingPx).toBeUndefined();
  });

  it("evens a paragraph's spaces where line-at-a-time breaking cannot", () => {
    const items = prepareParagraph([{ text: PROSE }]);
    const spaceWidth = measureCollapsedSpaceWidth(items[0]!.font);
    const width = 360;

    const { lines } = justified(items, width);
    const ratios = lines
      .slice(0, -1)
      .map((line) => spaceRatio(line, spaceWidth));

    const greedy = layoutTextLines(items, width).lines.slice(0, -1);
    const greedyRatios = greedy.map((line) => {
      const text = lineText(line).trimEnd();
      const spaces = text.split(" ").length - 1;
      return (
        (spaceWidth +
          (width - measureTextWidth(text, items[0]!.font)) / spaces) /
        spaceWidth
      );
    });
    expect(Math.max(...ratios)).toBeLessThan(Math.max(...greedyRatios));
    expect(Math.min(...ratios)).toBeGreaterThanOrEqual(0.79);
  });

  it("hyphenates only when a paragraph needs it", () => {
    const items = prepareParagraph([{ text: PROSE }]);
    // At this width spaces alone set the paragraph.
    const roomy = justified(items, 640, { hyphenPoints: EVERY_THIRD_LETTER });
    expect(roomy.lines.some((line) => lineText(line).endsWith("-"))).toBe(
      false,
    );

    const narrow = justified(items, 200, { hyphenPoints: EVERY_THIRD_LETTER });
    expect(narrow.lines.some((line) => lineText(line).endsWith("-"))).toBe(
      true,
    );
  });

  it("shows a hyphen on the page and nowhere in the text", () => {
    const items = prepareParagraph([{ text: PROSE }]);

    const { lines } = justified(items, 200, {
      hyphenPoints: EVERY_THIRD_LETTER,
    });

    const broken = lines.findIndex((line) => lineText(line).endsWith("-"));
    expect(broken).toBeGreaterThanOrEqual(0);
    // The break is a cursor inside a segment, where the next line starts.
    expect(lines[broken]!.endOffset!.graphemeIndex).toBeGreaterThan(0);
    expect(lines[broken + 1]!.startOffset).toEqual(lines[broken]!.endOffset);

    const rebuilt = lines
      .map((line) => {
        const text = lineText(line);
        return text.endsWith("-") ? text.slice(0, -1) : text;
      })
      .join("");
    expect(rebuilt).toBe(PROSE);

    lines.forEach((line, index) => {
      if (index > 0) {
        expect(line.startOffset).toEqual(lines[index - 1]!.endOffset);
      }
    });
  });

  it("does not add a hyphen where a word already has one", () => {
    const text =
      `${"word ".repeat(9)}well-known ${"word ".repeat(9)}`.trimEnd();
    const items = prepareParagraph([{ text }]);
    // "well-" ends a line of exactly this width.
    const width = 8 * ("word ".repeat(9).length + 5);

    const { lines } = justified(items, width);

    expect(lineText(lines[0]!)).toBe(`${"word ".repeat(9)}well-`);
    expect(lineText(lines[1]!).startsWith("known ")).toBe(true);
  });

  it("measures an indented first line shorter", () => {
    const items = prepareParagraph([{ text: PROSE }]);
    const width = 400;

    const { lines, renderMode } = justified(items, width, {
      firstLineIndentPx: 40,
    });

    expect(renderMode).toBe("manual-justify");
    expect(lines[0]!.indentPx).toBe(40);
    expect(lines[1]!.indentPx).toBeUndefined();
    const text = lineText(lines[0]!).trimEnd();
    const spaces = text.split(" ").length - 1;
    expect(
      measureTextWidth(text, items[0]!.font) +
        spaces * lines[0]!.wordSpacingPx! +
        3,
    ).toBeCloseTo(width - 40, 5);
  });

  it("keeps inline code, with its chrome, whole", () => {
    const items = prepareParagraph([
      { text: `${"word ".repeat(12)}` },
      { text: "two words", isCode: true },
      { text: ` ${"word ".repeat(12)}`.trimEnd() },
    ]);

    const { lines, renderMode } = justified(items, 200);

    expect(renderMode).toBe("manual-justify");
    const code = lines.filter((line) =>
      line.fragments.some((fragment) => fragment.isCode),
    );
    expect(code).toHaveLength(1);
    expect(code[0]!.fragments.find((f) => f.isCode)!.text).toBe("two words");
  });

  it("leaves a word wider than the column to ragged text", () => {
    const items = prepareParagraph([
      { text: `some text ${"long".repeat(30)} more text` },
    ]);

    expect(justified(items, 200).renderMode).toBe("native");
  });

  it("keeps its lines when a highlight splits a word", () => {
    const hyphenPoints = EVERY_THIRD_LETTER;
    const whole = prepareParagraph([{ text: PROSE }]);
    const at = PROSE.indexOf("conversations") + 4;
    const split = prepareParagraph([
      { text: PROSE.slice(0, at) },
      {
        text: PROSE.slice(at, at + 4),
        highlightMarks: [{ id: "note", isStart: true, isEnd: true }],
      },
      { text: PROSE.slice(at + 4) },
    ]);

    const before = justified(whole, 200, { hyphenPoints }).lines;
    const after = justified(split, 200, { hyphenPoints }).lines;

    expect(after.map(lineText)).toEqual(before.map(lineText));
  });
});

describe("Knuth-Plass justification", () => {
  it("keeps the unjustified last line, with its spaces, inside the column", () => {
    const blocks: Block[] = [
      {
        type: "text",
        id: "last-line",
        tag: "p",
        runs: [
          {
            kind: "text",
            text: "Ana looks bemused at the call",
            bold: false,
            italic: false,
            isCode: false,
          },
        ],
      },
    ];
    const [textBlock] = prepareBlocks(blocks, BASE_FONT_CONFIG);
    if (textBlock?.type !== "text") throw new Error("Expected a text block");
    const item = textBlock.items[0]!;
    // The words fit on one line; the words and their spaces do not.
    const maxWidth = item.fullWidth - measureCollapsedSpaceWidth(item.font);

    const { lines, renderMode } = layoutTextLines(textBlock.items, maxWidth, {
      textAlign: "justify-knuth-plass",
    });

    expect(renderMode).toBe("manual-justify");
    expect(lines.length).toBeGreaterThan(1);
    const lastLineText = lines
      .at(-1)!
      .fragments.map((fragment) => fragment.text)
      .join("")
      .trimEnd();
    expect(measureTextWidth(lastLineText, item.font)).toBeLessThanOrEqual(
      maxWidth,
    );
  });
});
