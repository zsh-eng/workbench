import {
  canonicalOffsetToContentAnchor,
  resolveTextAnchorToCanonicalOffset,
} from "@/lib/pagination-v2/engine/highlight-selection";
import { applyHighlightsToChapterHtml } from "@/features/reader/highlight-virtualization";
import {
  parseChapterHtmlWithCanonicalText,
  prepareBlocks,
  resolveCanonicalRangeText,
  resolveContentAnchorRangeToHighlight,
  type ChapterCanonicalText,
  type ContentAnchor,
  type FontConfig,
  type PreparedBlock,
} from "@/lib/pagination-v2";
import type { Highlight } from "@/types/highlight";
import { createHighlightFromRange } from "@zsh-eng/text-highlighter";
import { describe, expect, it } from "vitest";

const BASE_FONT_CONFIG: FontConfig = {
  bodyFamily: '"Inter", sans-serif',
  headingFamily: '"Inter", sans-serif',
  codeFamily: '"Courier New", monospace',
  baseSizePx: 16,
};

function buildChapter(html: string): {
  blocks: ReturnType<typeof parseChapterHtmlWithCanonicalText>["blocks"];
  canonicalText: ChapterCanonicalText;
  prepared: PreparedBlock[];
} {
  const { blocks, canonicalText } = parseChapterHtmlWithCanonicalText(html);
  const prepared = prepareBlocks(blocks, BASE_FONT_CONFIG);
  return { blocks, canonicalText, prepared };
}

function createTextAnchor(
  chapterIndex: number,
  blockId: string,
  itemIndex: number,
  segmentIndex: number,
  graphemeIndex: number,
): ContentAnchor {
  return {
    type: "text",
    chapterIndex,
    blockId,
    offset: {
      itemIndex,
      segmentIndex,
      graphemeIndex,
    },
  };
}

function buildHighlight(
  id: string,
  spineItemId: string,
  result: {
    startOffset: number;
    endOffset: number;
    selectedText: string;
    textBefore: string;
    textAfter: string;
  },
): Highlight {
  return {
    id,
    bookId: "book-1",
    spineItemId,
    startOffset: result.startOffset,
    endOffset: result.endOffset,
    selectedText: result.selectedText,
    textBefore: result.textBefore,
    textAfter: result.textAfter,
    color: "yellow",
    createdAt: new Date("2026-01-01T00:00:00.000Z").getTime(),
  };
}

describe("resolveContentAnchorRangeToHighlight", () => {
  it("computes persisted offsets and context inside a single block", () => {
    const { blocks, canonicalText, prepared } = buildChapter(
      "<p>alpha beta gamma</p>",
    );
    const blockId = blocks[0]?.id;
    expect(blockId).toBeDefined();
    if (!blockId) return;

    const result = resolveContentAnchorRangeToHighlight({
      startAnchor: createTextAnchor(0, blockId, 0, 2, 0),
      endAnchor: createTextAnchor(0, blockId, 0, 2, 4),
      chapterBlocks: blocks,
      preparedChapter: prepared,
      chapterCanonicalText: canonicalText,
    });

    expect(result).toEqual({
      chapterIndex: 0,
      startOffset: 6,
      endOffset: 10,
      selectedText: "beta",
      textBefore: "alpha ",
      textAfter: " gamma",
    });
  });

  it("maps collapsed whitespace back to the raw chapter offsets", () => {
    const { blocks, canonicalText, prepared } = buildChapter(
      "<p>alpha   beta gamma</p>",
    );
    const blockId = blocks[0]?.id;
    expect(blockId).toBeDefined();
    if (!blockId) return;

    const result = resolveContentAnchorRangeToHighlight({
      startAnchor: createTextAnchor(0, blockId, 0, 2, 0),
      endAnchor: createTextAnchor(0, blockId, 0, 2, 4),
      chapterBlocks: blocks,
      preparedChapter: prepared,
      chapterCanonicalText: canonicalText,
    });

    expect(result).toEqual({
      chapterIndex: 0,
      startOffset: 8,
      endOffset: 12,
      selectedText: "beta",
      textBefore: "alpha   ",
      textAfter: " gamma",
    });
  });

  it("spans multiple text blocks within the same chapter", () => {
    const { blocks, canonicalText, prepared } = buildChapter(
      "<p>alpha beta</p><p>gamma delta</p>",
    );
    const firstBlockId = blocks[0]?.id;
    const secondBlockId = blocks[1]?.id;
    expect(firstBlockId).toBeDefined();
    expect(secondBlockId).toBeDefined();
    if (!firstBlockId || !secondBlockId) return;

    const result = resolveContentAnchorRangeToHighlight({
      startAnchor: createTextAnchor(0, firstBlockId, 0, 2, 0),
      endAnchor: createTextAnchor(0, secondBlockId, 0, 0, 5),
      chapterBlocks: blocks,
      preparedChapter: prepared,
      chapterCanonicalText: canonicalText,
    });

    expect(result).toEqual({
      chapterIndex: 0,
      startOffset: 6,
      endOffset: 15,
      selectedText: "betagamma",
      textBefore: "alpha ",
      textAfter: " delta",
    });
  });

  it("does not count hard-break-only runs in persisted offsets", () => {
    const { blocks, canonicalText, prepared } = buildChapter(
      "<p>alpha<br>beta</p>",
    );
    const blockId = blocks[0]?.id;
    expect(blockId).toBeDefined();
    if (!blockId) return;

    const result = resolveContentAnchorRangeToHighlight({
      startAnchor: createTextAnchor(0, blockId, 2, 0, 0),
      endAnchor: createTextAnchor(0, blockId, 2, 0, 4),
      chapterBlocks: blocks,
      preparedChapter: prepared,
      chapterCanonicalText: canonicalText,
    });

    expect(result).toEqual({
      chapterIndex: 0,
      startOffset: 5,
      endOffset: 9,
      selectedText: "beta",
      textBefore: "alpha",
      textAfter: "",
    });
  });

  it("rejects anchor pairs from different chapters", () => {
    const { blocks, canonicalText, prepared } = buildChapter(
      "<p>alpha beta gamma</p>",
    );
    const blockId = blocks[0]?.id;
    expect(blockId).toBeDefined();
    if (!blockId) return;

    const result = resolveContentAnchorRangeToHighlight({
      startAnchor: createTextAnchor(0, blockId, 0, 2, 0),
      endAnchor: createTextAnchor(1, blockId, 0, 2, 4),
      chapterBlocks: blocks,
      preparedChapter: prepared,
      chapterCanonicalText: canonicalText,
    });

    expect(result).toBeNull();
  });

  it("matches the canonical DOM highlight contract after a hard break", () => {
    const html = "<p>alpha<br>beta</p>";
    const { blocks, canonicalText, prepared } = buildChapter(html);
    const blockId = blocks[0]?.id;
    expect(blockId).toBeDefined();
    if (!blockId) return;

    const container = document.createElement("div");
    container.innerHTML = html;

    const paragraph = container.querySelector("p");
    const betaTextNode = paragraph?.lastChild;
    expect(betaTextNode?.nodeType).toBe(Node.TEXT_NODE);
    if (!(betaTextNode instanceof Text)) return;

    const range = document.createRange();
    range.setStart(betaTextNode, 0);
    range.setEnd(betaTextNode, betaTextNode.textContent?.length ?? 0);

    const canonical = createHighlightFromRange(range, container);
    expect(canonical).not.toBeNull();
    if (!canonical) return;

    const projected = resolveContentAnchorRangeToHighlight({
      startAnchor: createTextAnchor(0, blockId, 2, 0, 0),
      endAnchor: createTextAnchor(0, blockId, 2, 0, 4),
      chapterBlocks: blocks,
      preparedChapter: prepared,
      chapterCanonicalText: canonicalText,
    });

    expect(projected).not.toBeNull();
    if (!projected) return;

    expect({
      startOffset: projected.startOffset,
      endOffset: projected.endOffset,
      selectedText: projected.selectedText,
    }).toEqual({
      startOffset: canonical.startOffset,
      endOffset: canonical.endOffset,
      selectedText: canonical.selectedText,
    });

    const projectedHtml = applyHighlightsToChapterHtml(html, [
      buildHighlight("projected", "spine-1", projected),
    ]);
    const canonicalHtml = applyHighlightsToChapterHtml(html, [
      buildHighlight("canonical", "spine-1", canonical),
    ]);

    expect(canonicalHtml).toContain('data-highlight-id="canonical"');
    expect(projectedHtml).toContain('data-highlight-id="projected"');
  });

  it("matches the canonical DOM highlight contract when source HTML includes inter-block whitespace", () => {
    const html = `
      <section>
        <p>alpha</p>
        <p>beta</p>
      </section>
    `;
    const { blocks, canonicalText, prepared } = buildChapter(html);
    const secondBlockId = blocks[1]?.id;
    expect(secondBlockId).toBeDefined();
    if (!secondBlockId) return;

    const container = document.createElement("div");
    container.innerHTML = html;

    const paragraphs = container.querySelectorAll("p");
    const betaTextNode = paragraphs[1]?.firstChild;
    expect(betaTextNode?.nodeType).toBe(Node.TEXT_NODE);
    if (!(betaTextNode instanceof Text)) return;

    const range = document.createRange();
    range.setStart(betaTextNode, 0);
    range.setEnd(betaTextNode, betaTextNode.textContent?.length ?? 0);

    const canonical = createHighlightFromRange(range, container);
    expect(canonical).not.toBeNull();
    if (!canonical) return;

    const projected = resolveContentAnchorRangeToHighlight({
      startAnchor: createTextAnchor(0, secondBlockId, 0, 0, 0),
      endAnchor: createTextAnchor(0, secondBlockId, 0, 0, 4),
      chapterBlocks: blocks,
      preparedChapter: prepared,
      chapterCanonicalText: canonicalText,
    });

    expect(projected).not.toBeNull();
    if (!projected) return;

    expect({
      startOffset: projected.startOffset,
      endOffset: projected.endOffset,
      selectedText: projected.selectedText,
      textBefore: projected.textBefore,
    }).toEqual({
      startOffset: canonical.startOffset,
      endOffset: canonical.endOffset,
      selectedText: canonical.selectedText,
      textBefore: canonical.textBefore,
    });

    const projectedHtml = applyHighlightsToChapterHtml(html, [
      buildHighlight("projected", "spine-1", projected),
    ]);
    const canonicalHtml = applyHighlightsToChapterHtml(html, [
      buildHighlight("canonical", "spine-1", canonical),
    ]);

    expect(canonicalHtml).toContain('data-highlight-id="canonical"');
    expect(projectedHtml).toContain('data-highlight-id="projected"');
  });
});

it("round trips a stored note offset through prepared text with whitespace and emoji", () => {
  const { blocks, canonicalText, prepared } = buildChapter(
    "<p>Before   <em>words 👋🏽</em> and after.</p><p>Second paragraph.</p>",
  );
  for (const word of ["Before", "words", "👋🏽", "after", "Second"]) {
    const offset = canonicalText.fullText.indexOf(word);
    const options = {
      chapterIndex: 0,
      offset,
      chapterBlocks: blocks,
      chapterCanonicalText: canonicalText,
      preparedChapter: prepared,
    };
    const anchor = canonicalOffsetToContentAnchor(options);
    expect(anchor).not.toBeNull();
    expect(
      resolveTextAnchorToCanonicalOffset({ ...options, anchor: anchor! }),
    ).toBe(offset);
  }
});

describe("resolveCanonicalRangeText", () => {
  const { blocks, canonicalText } = buildChapter(
    "<p>First   line\n of a <em>wrapped</em> para\u00adgraph</p>" +
      "<p>Poem one<br/>Poem two</p>" +
      "<pre>code\n  indented\n</pre>",
  );
  const copy = (start: string, end: string) =>
    resolveCanonicalRangeText({
      chapterBlocks: blocks,
      chapterCanonicalText: canonicalText,
      startOffset: canonicalText.fullText.indexOf(start),
      endOffset: canonicalText.fullText.indexOf(end) + end.length,
    });

  it("collapses source whitespace and separates paragraphs with a blank line", () => {
    expect(copy("First", "indented\n")).toBe(
      "First line of a wrapped paragraph\n\nPoem one\nPoem two\n\ncode\n  indented",
    );
  });

  it("keeps only the line breaks inside the range", () => {
    expect(copy("wrapped", "Poem o")).toBe("wrapped paragraph\n\nPoem o");
    expect(copy("one", "Poem t")).toBe("one\nPoem t");
  });
});
