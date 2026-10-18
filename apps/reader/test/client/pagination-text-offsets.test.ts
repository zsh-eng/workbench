import {
  PaginationEngine,
  type EnginePaginationEvent,
} from "@/lib/pagination-v2/engine";
import {
  parseChapterHtmlWithCanonicalText,
  prepareBlocks,
} from "@/lib/pagination-v2";
import {
  canonicalOffsetToContentAnchor,
  createCanonicalOffsetLocator,
} from "@/lib/pagination-v2/engine/highlight-selection";
import type { PaginationCommand } from "@/lib/pagination-v2/protocol";
import type {
  PaginationConfig,
  ResolvedSpread,
  SpreadIntent,
} from "@/lib/pagination-v2/types";
import { describe, expect, it } from "vitest";

const CONFIG: PaginationConfig = {
  fontConfig: {
    bodyFamily: '"Inter", sans-serif',
    headingFamily: '"Inter", sans-serif',
    codeFamily: '"Courier New", monospace',
    baseSizePx: 16,
  },
  layoutTheme: {
    baseFontSizePx: 16,
    lineHeightFactor: 1.5,
    paragraphSpacingFactor: 1.2,
    headingSpaceAbove: 1.5,
    headingSpaceBelow: 0.7,
    textAlign: "left",
  },
  viewport: { width: 620, height: 860 },
};
const SEARCH: SpreadIntent = { kind: "jump", source: "search" };

// Forty paragraphs with italics, and one word to find near the end.
const { blocks, canonicalText } = parseChapterHtmlWithCanonicalText(
  `<body>${Array.from(
    { length: 40 },
    (_, index) =>
      `<p>Paragraph ${index}: the <em>Rabbit</em> took a watch out of its waistcoat-pocket, looked at it, and hurried on${
        index === 36 ? " past the café" : ""
      }, and Alice started to her feet.</p>`,
  ).join("")}</body>`,
);
const blockStarts = [...canonicalText.blockStarts];
const offset = canonicalText.fullText.indexOf("café");

function run(engine: PaginationEngine, command: PaginationCommand) {
  const work = engine.createWork(command);
  while (!work.next().done) {}
}

function shownText(spread: ResolvedSpread) {
  return spread.slots
    .flatMap((slot) => (slot.kind === "page" ? slot.page.content : []))
    .flatMap((slice) => (slice.type === "text" ? slice.lines : []))
    .flatMap((line) => line.fragments.map((fragment) => fragment.text))
    .join("");
}

function lastSpread(events: EnginePaginationEvent[]) {
  const event = events.findLast(
    (candidate) =>
      candidate.type === "pageContent" || candidate.type === "ready",
  );
  return event && "spread" in event ? event.spread : null;
}

describe("canonical text offsets", () => {
  it("opens the page with an offset, and again after the type changes", () => {
    const events: EnginePaginationEvent[] = [];
    const engine = new PaginationEngine((event) => events.push(event));
    run(engine, {
      type: "init",
      totalChapters: 1,
      paginationConfig: CONFIG,
      spreadConfig: { columns: 1, chapterFlow: "continuous" },
      initialChapterIndex: 0,
      firstChapterBlocks: blocks,
    });

    const open = () => {
      events.length = 0;
      run(engine, {
        type: "goToTextOffset",
        chapterIndex: 0,
        blockStarts,
        offset,
        intent: SEARCH,
      });
      return lastSpread(events)!;
    };
    const locate = (requestId: number) => {
      events.length = 0;
      run(engine, {
        type: "locateTextOffsets",
        scope: "search",
        requestId,
        chapters: [
          { chapterIndex: 0, blockStarts, offsets: [{ id: "café", offset }] },
        ],
      });
      const located = events.find(
        (event) => event.type === "textOffsetsLocated",
      );
      return located?.type === "textOffsetsLocated"
        ? located.locations["café"]
        : undefined;
    };

    const before = open();
    expect(before.intent).toEqual(SEARCH);
    expect(before.currentPage).toBeGreaterThan(1);
    expect(shownText(before)).toContain("café");
    expect(locate(1)?.page).toBe(before.currentPage);

    run(engine, {
      type: "updatePaginationConfig",
      paginationConfig: {
        ...CONFIG,
        fontConfig: { ...CONFIG.fontConfig, baseSizePx: 24 },
        layoutTheme: { ...CONFIG.layoutTheme, baseFontSizePx: 24 },
      },
    });
    const after = open();
    expect(shownText(after)).toContain("café");
    expect(after.currentPage).toBeGreaterThan(before.currentPage);
    expect(locate(2)?.page).toBe(after.currentPage);
  });

  it("reports a chapter that is not laid out yet", () => {
    const events: EnginePaginationEvent[] = [];
    const engine = new PaginationEngine((event) => events.push(event));
    run(engine, {
      type: "init",
      totalChapters: 2,
      paginationConfig: CONFIG,
      spreadConfig: { columns: 1, chapterFlow: "continuous" },
      initialChapterIndex: 0,
      firstChapterBlocks: blocks,
    });
    events.length = 0;
    run(engine, {
      type: "goToTextOffset",
      chapterIndex: 1,
      blockStarts,
      offset,
      intent: SEARCH,
    });
    expect(events.map((event) => event.type)).toEqual(["pageUnavailable"]);
  });

  it("locates every offset as the single-offset path does", () => {
    const chapter = parseChapterHtmlWithCanonicalText(
      `<body><p>Naïve <em>café</em> 🦞 and a soft\u00adhyphen,
      then   spaces.</p><h2>A <i>title</i></h2><img src="a.png"/><p>Another
      <b>bold</b> paragraph<br/>after a break.</p></body>`,
    );
    const preparedChapter = prepareBlocks(chapter.blocks, CONFIG.fontConfig);
    const locate = createCanonicalOffsetLocator({
      chapterIndex: 2,
      chapterBlocks: chapter.blocks,
      preparedChapter,
      blockStarts: chapter.canonicalText.blockStarts,
    });
    for (
      let offset = 0;
      offset <= chapter.canonicalText.fullText.length;
      offset++
    )
      expect(locate(offset)).toEqual(
        canonicalOffsetToContentAnchor({
          chapterIndex: 2,
          offset,
          chapterBlocks: chapter.blocks,
          preparedChapter,
          chapterCanonicalText: chapter.canonicalText,
        }),
      );
  });
});
