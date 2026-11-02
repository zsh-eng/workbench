import {
  PaginationEngine,
  type EnginePaginationEvent,
} from "@/lib/pagination-v2/engine";
import {
  layoutPages,
  parseChapterHtmlWithCanonicalText,
  prepareBlocks,
} from "@/lib/pagination-v2";
import {
  canonicalOffsetToContentAnchor,
  createCanonicalOffsetLocator,
} from "@/lib/pagination-v2/engine/highlight-selection";
import type { PaginationCommand } from "@/lib/pagination-v2/protocol";
import { ensureHyphenPoints } from "@/lib/pagination-v2/shared/hyphenation";
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
    expect(locate(1)?.pageInChapter).toBe(
      before.slots.find((slot) => slot.kind === "page")?.page
        .currentPageInChapter,
    );

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

  it("waits for a chapter that is not laid out yet, then opens the offset", () => {
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
    expect(events.map((event) => event.type)).toEqual(["chapterUnavailable"]);

    run(engine, { type: "addChapter", chapterIndex: 1, blocks });
    const jump = events.find((event) => event.type === "pageContent");
    expect(jump?.intent).toEqual(SEARCH);
    expect(jump && "spread" in jump && shownText(jump.spread)).toContain(
      "café",
    );
  });

  it("keeps a reading place inside a word that a hyphen breaks across pages", async () => {
    await ensureHyphenPoints("en");
    const config: PaginationConfig = {
      ...CONFIG,
      layoutTheme: {
        ...CONFIG.layoutTheme,
        textAlign: "justify-knuth-plass",
        language: "en",
      },
      viewport: { width: 240, height: 200 },
    };
    const chapter = parseChapterHtmlWithCanonicalText(
      `<body><p>${"The extraordinary conversation continued uninterrupted throughout the afternoon, notwithstanding considerable interruptions. ".repeat(40)}</p></body>`,
    );
    const { pages } = layoutPages(
      prepareBlocks(chapter.blocks, config.fontConfig),
      config.viewport.width,
      config.viewport.height,
      config.layoutTheme,
    );
    const firstLine = (page: (typeof pages)[number]) => {
      const [slice] = page.slices;
      return slice?.type === "text"
        ? { blockId: slice.blockId, line: slice.lines[0]! }
        : null;
    };
    const page = pages.find(
      (candidate) =>
        (firstLine(candidate)?.line.startOffset?.graphemeIndex ?? 0) > 0,
    );
    const start = page && firstLine(page);
    if (!start) throw new Error("Expected a page that starts inside a word");
    const initialAnchor = {
      type: "text" as const,
      chapterIndex: 0,
      blockId: start.blockId,
      offset: start.line.startOffset!,
    };

    const events: EnginePaginationEvent[] = [];
    const engine = new PaginationEngine((event) => events.push(event));
    run(engine, {
      type: "init",
      totalChapters: 1,
      paginationConfig: config,
      spreadConfig: { columns: 1, chapterFlow: "continuous" },
      initialChapterIndex: 0,
      initialAnchor,
      firstChapterBlocks: chapter.blocks,
    });
    const shown = lastSpread(events)!;
    expect(shownText(shown).startsWith(start.line.fragments[0]!.text)).toBe(
      true,
    );

    // The same place holds when the reader turns Justify off and back on.
    run(engine, { type: "updatePaginationConfig", paginationConfig: CONFIG });
    const wholeWord = start.line.fragments[0]!.text.split(" ")[0]!;
    expect(shownText(lastSpread(events)!)).toContain(wholeWord);
    run(engine, { type: "updatePaginationConfig", paginationConfig: config });
    expect(lastSpread(events)!.currentPage).toBe(shown.currentPage);
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
