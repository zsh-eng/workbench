import {
  PaginationEngine,
  type EnginePaginationEvent,
  type PaginationEngineWork,
} from "@/lib/pagination-v2/engine";
import type { PaginationCommand } from "@/lib/pagination-v2/protocol";
import type {
  Block,
  ContentAnchor,
  FontConfig,
  LayoutTheme,
  PaginationConfig,
  ResolvedSpread,
  SpreadConfig,
  SpreadIntent,
} from "@/lib/pagination-v2/types";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const BASE_FONT_CONFIG: FontConfig = {
  bodyFamily: '"Inter", sans-serif',
  headingFamily: '"Inter", sans-serif',
  codeFamily: '"Courier New", monospace',
  baseSizePx: 16,
};

const BASE_LAYOUT_THEME: LayoutTheme = {
  baseFontSizePx: 16,
  lineHeightFactor: 1.5,
  paragraphSpacingFactor: 1.2,
  headingSpaceAbove: 1.5,
  headingSpaceBelow: 0.7,
  textAlign: "left",
};

const BASE_PAGINATION_CONFIG: PaginationConfig = {
  fontConfig: BASE_FONT_CONFIG,
  layoutTheme: BASE_LAYOUT_THEME,
  viewport: { width: 620, height: 860 },
};

const BASE_SPREAD_CONFIG: SpreadConfig = {
  columns: 1,
  chapterFlow: "continuous",
};

const REPLACE_INTENT: SpreadIntent = { kind: "replace" };
const FORWARD_LINEAR_INTENT: SpreadIntent = {
  kind: "linear",
  direction: "forward",
};
const BACKWARD_LINEAR_INTENT: SpreadIntent = {
  kind: "linear",
  direction: "backward",
};
const CHAPTER_JUMP_INTENT: SpreadIntent = {
  kind: "jump",
  source: "chapter",
};
const SCRUBBER_JUMP_INTENT: SpreadIntent = {
  kind: "jump",
  source: "scrubber",
};
const INTERNAL_LINK_JUMP_INTENT: SpreadIntent = {
  kind: "jump",
  source: "internal-link",
};

function makeSpacerBlocks(chapterIndex: number): Block[] {
  return [{ type: "spacer", kind: "rule", id: `spacer-${chapterIndex}` }];
}

function makeFixedPageBlocks(chapterIndex: number, pageCount: number): Block[] {
  const blocks: Block[] = [];

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
    blocks.push({
      type: "spacer",
      kind: "rule",
      id: `spacer-${chapterIndex}-${pageIndex}`,
    });
    if (pageIndex < pageCount - 1) {
      blocks.push({
        type: "page-break",
        id: `pb-${chapterIndex}-${pageIndex}`,
      });
    }
  }

  return blocks;
}

function makeLongTextBlocks(blockId: string): Block[] {
  const paragraph = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ";
  return [
    {
      type: "text",
      id: blockId,
      tag: "p",
      runs: [
        {
          kind: "text",
          text: paragraph.repeat(260),
          bold: false,
          italic: false,
          isCode: false,
        },
      ],
    },
  ];
}

function makeInlineTargetedLongBlocks(targetId: string): Block[] {
  const paragraph = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ";
  return [
    {
      type: "text",
      id: `inline-target-${targetId}`,
      tag: "p",
      runs: [
        {
          kind: "text",
          text: paragraph.repeat(220),
          bold: false,
          italic: false,
          isCode: false,
        },
        {
          kind: "text",
          text: paragraph.repeat(140),
          bold: false,
          italic: false,
          isCode: false,
          targetIds: [targetId],
        },
      ],
    },
  ];
}

function makePreTargetedLongBlocks(targetId: string): Block[] {
  const repeatedLine = "const value = alpha + beta + gamma + delta;\n";
  return [
    {
      type: "text",
      id: `pre-target-${targetId}`,
      tag: "pre",
      runs: [
        {
          kind: "text",
          text: repeatedLine.repeat(80),
          bold: false,
          italic: false,
          isCode: true,
        },
        {
          kind: "text",
          text: repeatedLine.repeat(60),
          bold: false,
          italic: false,
          isCode: true,
          targetIds: [targetId],
        },
      ],
    },
  ];
}

function makeBlockTargetBlocks(targetId: string): Block[] {
  return [
    ...makeLongTextBlocks("before-block-target"),
    {
      type: "text",
      id: "block-target",
      tag: "p",
      targetIds: [targetId],
      runs: [
        {
          kind: "text",
          text: "This block owns the fragment target.",
          bold: false,
          italic: false,
          isCode: false,
        },
      ],
    },
  ];
}

function makeSpacerSplitBlocks(): Block[] {
  return [
    {
      type: "image",
      id: "image-before-split",
      src: "cover-before-split.jpg",
      intrinsicWidth: 600,
      intrinsicHeight: 855,
    },
    { type: "spacer", kind: "rule", id: "spacer-21" },
    { type: "page-break", id: "pb-after-spacer" },
  ];
}

function pageSlots(spread: ResolvedSpread) {
  return spread.slots.filter(
    (slot): slot is Extract<(typeof spread.slots)[number], { kind: "page" }> =>
      slot.kind === "page",
  );
}

function gapSlots(spread: ResolvedSpread) {
  return spread.slots.filter(
    (slot): slot is Extract<(typeof spread.slots)[number], { kind: "gap" }> =>
      slot.kind === "gap",
  );
}

function firstPageSlot(spread: ResolvedSpread) {
  return pageSlots(spread)[0];
}

function spreadContainsLeafPage(spread: ResolvedSpread, pageNumber: number) {
  return pageSlots(spread).some((slot) => slot.page.currentPage === pageNumber);
}

function runWork(work: PaginationEngineWork): void {
  while (!work.next().done) {}
}

function runCommand(
  engine: PaginationEngine,
  command: PaginationCommand,
): void {
  runWork(engine.createWork(command));
}

/** Create an engine with `initialChapterIndex` chapter already initialised. */
function createEngine(options?: {
  totalChapters?: number;
  initialChapterIndex?: number;
  initialAnchor?: ContentAnchor;
  blocks?: Block[];
  paginationConfig?: PaginationConfig;
  spreadConfig?: SpreadConfig;
}) {
  const events: EnginePaginationEvent[] = [];
  const engine = new PaginationEngine((event) => events.push(event));

  const totalChapters = options?.totalChapters ?? 1;
  const initialChapterIndex = options?.initialChapterIndex ?? 0;
  const paginationConfig = options?.paginationConfig ?? BASE_PAGINATION_CONFIG;
  const spreadConfig = options?.spreadConfig ?? BASE_SPREAD_CONFIG;

  runCommand(engine, {
    type: "init",
    totalChapters,
    paginationConfig,
    spreadConfig,
    initialChapterIndex,
    initialAnchor: options?.initialAnchor,
    firstChapterBlocks:
      options?.blocks ?? makeSpacerBlocks(initialChapterIndex),
  });

  return { engine, events };
}

function addChapter(
  engine: PaginationEngine,
  chapterIndex: number,
  blocks?: Block[],
): void {
  runCommand(engine, {
    type: "addChapter",
    chapterIndex,
    blocks: blocks ?? makeSpacerBlocks(chapterIndex),
  });
}

function lastEvent(
  events: EnginePaginationEvent[],
): EnginePaginationEvent | undefined {
  return events[events.length - 1];
}

function countEvents(
  events: EnginePaginationEvent[],
  type: EnginePaginationEvent["type"],
) {
  return events.filter((e) => e.type === type).length;
}

/** Indices of chapters emitted by partialReady/progress events. */
function getChapterOrder(events: EnginePaginationEvent[]): number[] {
  const result: number[] = [];
  for (const e of events) {
    if (e.type === "partialReady" || e.type === "progress") {
      result.push(e.chapterDiagnostics?.chapterIndex ?? -1);
    }
  }
  return result;
}

function getReadyEvent(events: EnginePaginationEvent[]) {
  return events.find(
    (e): e is Extract<EnginePaginationEvent, { type: "ready" }> =>
      e.type === "ready",
  );
}

function getPageContentEvent(events: EnginePaginationEvent[]) {
  return events.find(
    (e): e is Extract<EnginePaginationEvent, { type: "pageContent" }> =>
      e.type === "pageContent",
  );
}

function getLastEventOfType<T extends EnginePaginationEvent["type"]>(
  events: EnginePaginationEvent[],
  type: T,
) {
  return [...events]
    .reverse()
    .find(
      (event): event is Extract<EnginePaginationEvent, { type: T }> =>
        event.type === type,
    );
}

// ---------------------------------------------------------------------------
// 1. Init / addChapter lifecycle
// ---------------------------------------------------------------------------

describe("init + addChapter lifecycle", () => {
  it("emits partialReady after init when totalChapters > 1", () => {
    const { events } = createEngine({ totalChapters: 3 });
    expect(countEvents(events, "partialReady")).toBe(1);
    expect(countEvents(events, "ready")).toBe(0);

    const partial = events.find((e) => e.type === "partialReady");
    expect(partial?.type).toBe("partialReady");
    expect(partial?.intent).toEqual(REPLACE_INTENT);
    if (partial?.type === "partialReady") {
      expect(partial.spread.intent).toEqual(REPLACE_INTENT);
    }
  });

  it("emits ready immediately when totalChapters === 1", () => {
    const { events } = createEngine({ totalChapters: 1 });
    expect(countEvents(events, "ready")).toBe(1);
    expect(countEvents(events, "partialReady")).toBe(0);

    const ready = getReadyEvent(events);
    expect(ready?.intent).toEqual(REPLACE_INTENT);
    expect(ready?.spread.intent).toEqual(REPLACE_INTENT);
    expect(ready?.previousSpread).toBeNull();
  });

  it("transitions from partial to ready once all chapters are added", () => {
    const { engine, events } = createEngine({ totalChapters: 3 });
    addChapter(engine, 1);
    addChapter(engine, 2);

    expect(countEvents(events, "ready")).toBe(1);
    const ready = getLastEventOfType(events, "ready");
    expect(ready).toBeDefined();
    expect(ready?.intent).toEqual(REPLACE_INTENT);
    expect(ready?.spread.intent).toEqual(REPLACE_INTENT);
  });

  it("emits progress with both leaf and spread counters", () => {
    const { engine, events } = createEngine({ totalChapters: 3 });
    events.length = 0;

    addChapter(engine, 1);
    const progress = events.find(
      (e): e is Extract<EnginePaginationEvent, { type: "progress" }> =>
        e.type === "progress",
    );

    expect(progress).toBeDefined();
    expect(progress?.intent).toEqual(REPLACE_INTENT);
    expect(progress!.currentPage).toBeGreaterThanOrEqual(1);
    expect(progress!.totalPages).toBeGreaterThanOrEqual(progress!.currentPage);
    expect(progress!.currentSpread).toBeGreaterThanOrEqual(1);
    expect(progress!.totalSpreads).toBeGreaterThanOrEqual(
      progress!.currentSpread,
    );
  });

  it("emits partialReady when a loaded chapter fills the visible spread", () => {
    const { engine, events } = createEngine({
      totalChapters: 3,
      spreadConfig: { columns: 2, chapterFlow: "continuous" },
    });
    events.length = 0;

    addChapter(engine, 1);

    const partial = getLastEventOfType(events, "partialReady");
    expect(partial).toBeDefined();
    expect(partial?.spread.chapterIndexStart).toBe(0);
    expect(partial?.spread.chapterIndexEnd).toBe(1);
    expect(countEvents(events, "progress")).toBe(0);
  });

  it("spread in partialReady contains slot metadata", () => {
    const { events } = createEngine({ totalChapters: 2 });
    const partial = events.find(
      (e): e is Extract<EnginePaginationEvent, { type: "partialReady" }> =>
        e.type === "partialReady",
    );

    expect(partial).toBeDefined();
    expect(partial?.intent).toEqual(REPLACE_INTENT);
    expect(partial!.spread.slots.length).toBe(1);
    expect(partial!.spread.intent).toEqual(REPLACE_INTENT);
    expect(partial!.spread.currentPage).toBeGreaterThanOrEqual(1);
    expect(partial!.spread.totalPages).toBeGreaterThanOrEqual(1);
  });

  it("skips duplicate addChapter calls for the same index", () => {
    const { engine, events } = createEngine({ totalChapters: 2 });
    const eventsLenBefore = events.length;

    addChapter(engine, 0);
    expect(events.length).toBe(eventsLenBefore);
  });

  it("progress events overwrite stale navigation intent with replace", () => {
    const { engine, events } = createEngine({
      totalChapters: 3,
      blocks: makeLongTextBlocks("cause-regression"),
    });
    events.length = 0;

    runCommand(engine, {
      type: "nextSpread",
      intent: FORWARD_LINEAR_INTENT,
    });
    const navigationEvent = getPageContentEvent(events);
    expect(navigationEvent?.intent).toEqual(FORWARD_LINEAR_INTENT);
    expect(navigationEvent?.spread.intent).toEqual(FORWARD_LINEAR_INTENT);

    events.length = 0;
    addChapter(engine, 1);

    const progress = getLastEventOfType(events, "progress");
    expect(progress).toBeDefined();
    expect(progress?.intent).toEqual(REPLACE_INTENT);
  });
});

// ---------------------------------------------------------------------------
// 1b. updateChapter lifecycle
// ---------------------------------------------------------------------------

describe("updateChapter lifecycle", () => {
  it("re-layouts one loaded chapter and emits replace intent", async () => {
    const { engine, events } = createEngine({
      totalChapters: 2,
      blocks: makeLongTextBlocks("chapter-0"),
    });
    addChapter(engine, 1, makeLongTextBlocks("chapter-1"));

    events.length = 0;

    runCommand(engine, {
      type: "updateChapter",
      chapterIndex: 0,
      blocks: makeLongTextBlocks("chapter-0-updated"),
    });

    expect(countEvents(events, "partialReady")).toBe(1);
    expect(countEvents(events, "ready")).toBe(1);

    const partial = getLastEventOfType(events, "partialReady");
    const ready = getLastEventOfType(events, "ready");

    expect(partial?.intent).toEqual(REPLACE_INTENT);
    expect(partial?.spread.intent).toEqual(REPLACE_INTENT);
    expect(ready?.intent).toEqual(REPLACE_INTENT);
    expect(ready?.spread.intent).toEqual(REPLACE_INTENT);
  });

  it("keeps anchor chapter stable when another chapter is updated", async () => {
    const { engine, events } = createEngine({ totalChapters: 3 });
    addChapter(engine, 1, makeSpacerBlocks(1));
    addChapter(engine, 2, makeSpacerBlocks(2));

    runCommand(engine, {
      type: "goToChapter",
      chapterIndex: 2,
      intent: CHAPTER_JUMP_INTENT,
    });
    events.length = 0;

    runCommand(engine, {
      type: "updateChapter",
      chapterIndex: 0,
      blocks: makeLongTextBlocks("updated-ch-0"),
    });

    const ready = getLastEventOfType(events, "ready");
    expect(ready).toBeDefined();
    expect(ready?.intent).toEqual(REPLACE_INTENT);
    expect(ready?.spread.intent).toEqual(REPLACE_INTENT);
    expect(ready?.spread.chapterIndexStart).toBe(2);

    const first = ready ? firstPageSlot(ready.spread) : undefined;
    expect(first?.page.chapterIndex).toBe(2);
  });

  it("emits error when updateChapter targets an unloaded chapter", async () => {
    const { engine, events } = createEngine({ totalChapters: 3 });
    events.length = 0;

    runCommand(engine, {
      type: "updateChapter",
      chapterIndex: 2,
      blocks: makeSpacerBlocks(2),
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("error");
    expect(events[0]?.intent).toEqual(REPLACE_INTENT);
    if (events[0]?.type === "error") {
      expect(events[0].message).toContain("has not been loaded");
    }
  });

  it("emits error when updateChapter index is out of bounds", async () => {
    const { engine, events } = createEngine({ totalChapters: 2 });
    events.length = 0;

    runCommand(engine, {
      type: "updateChapter",
      chapterIndex: 99,
      blocks: makeSpacerBlocks(99),
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("error");
    expect(events[0]?.intent).toEqual(REPLACE_INTENT);
    if (events[0]?.type === "error") {
      expect(events[0].message).toContain("out of bounds");
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Navigation — nextSpread / prevSpread / goToPage / goToChapter
// ---------------------------------------------------------------------------

describe("navigation", () => {
  it("nextSpread advances to the next spread", () => {
    const { engine, events } = createEngine({
      blocks: makeFixedPageBlocks(0, 12),
      spreadConfig: { columns: 3, chapterFlow: "continuous" },
    });

    const ready = getReadyEvent(events)!;
    expect(ready.spread.totalPages).toBeGreaterThan(3);
    expect(ready.previousSpread).toBeNull();
    expect(ready.nextSpread?.currentSpread).toBe(2);

    events.length = 0;
    runCommand(engine, {
      type: "nextSpread",
      intent: FORWARD_LINEAR_INTENT,
    });

    const pageContent = getPageContentEvent(events);
    expect(pageContent).toBeDefined();
    expect(pageContent?.intent).toEqual(FORWARD_LINEAR_INTENT);
    expect(pageContent?.spread.intent).toEqual(FORWARD_LINEAR_INTENT);
    expect(pageContent!.spread.currentSpread).toBe(2);
    expect(pageContent?.previousSpread?.currentSpread).toBe(1);
    expect(pageContent?.nextSpread?.currentSpread).toBe(3);
  });

  it("does not expose a next spread at the end of the book", () => {
    const { engine, events } = createEngine({
      blocks: makeLongTextBlocks("long-text"),
      spreadConfig: { columns: 1, chapterFlow: "continuous" },
    });
    const ready = getReadyEvent(events)!;

    events.length = 0;
    runCommand(engine, {
      type: "goToPage",
      page: ready.spread.totalPages,
      intent: SCRUBBER_JUMP_INTENT,
    });

    const pageContent = getPageContentEvent(events)!;
    expect(pageContent.spread.currentSpread).toBe(
      pageContent.spread.totalSpreads,
    );
    expect(pageContent.previousSpread).not.toBeNull();
    expect(pageContent.nextSpread).toBeNull();
  });

  it("nextSpread should advance from a pre-split spacer anchor (regression)", () => {
    const { engine, events } = createEngine({
      blocks: makeSpacerSplitBlocks(),
      spreadConfig: { columns: 1, chapterFlow: "continuous" },
    });

    const ready = getReadyEvent(events)!;
    expect(ready.spread.totalPages).toBeGreaterThanOrEqual(2);
    expect(ready.spread.currentSpread).toBe(1);

    events.length = 0;
    runCommand(engine, {
      type: "nextSpread",
      intent: FORWARD_LINEAR_INTENT,
    });

    const pageContent = getPageContentEvent(events);
    expect(pageContent).toBeDefined();
    expect(pageContent?.intent).toEqual(FORWARD_LINEAR_INTENT);
    expect(pageContent?.spread.intent).toEqual(FORWARD_LINEAR_INTENT);
    expect(pageContent!.spread.currentSpread).toBe(2);
  });

  it("turns by the full spread width when the preferred anchor slot is right-hand", () => {
    const forward = createEngine({
      blocks: makeFixedPageBlocks(0, 8),
      spreadConfig: { columns: 2, chapterFlow: "continuous" },
    });

    forward.events.length = 0;
    runCommand(forward.engine, {
      type: "goToPage",
      page: 2,
      intent: SCRUBBER_JUMP_INTENT,
    });

    const rightAnchoredStart = getPageContentEvent(forward.events)!;
    expect(
      pageSlots(rightAnchoredStart.spread).map((slot) => slot.page.currentPage),
    ).toEqual([1, 2]);
    expect(pageSlots(rightAnchoredStart.spread).at(-1)?.slotIndex).toBe(1);

    forward.events.length = 0;
    runCommand(forward.engine, {
      type: "nextSpread",
      intent: FORWARD_LINEAR_INTENT,
    });

    const next = getPageContentEvent(forward.events)!;
    expect
      .soft(pageSlots(next.spread).map((slot) => slot.page.currentPage))
      .toEqual([3, 4]);

    const backward = createEngine({
      blocks: makeFixedPageBlocks(0, 8),
      spreadConfig: { columns: 2, chapterFlow: "continuous" },
    });

    backward.events.length = 0;
    runCommand(backward.engine, {
      type: "goToPage",
      page: 6,
      intent: SCRUBBER_JUMP_INTENT,
    });

    const leftTargetStart = getPageContentEvent(backward.events)!;
    expect(
      pageSlots(leftTargetStart.spread).map((slot) => slot.page.currentPage),
    ).toEqual([5, 6]);
    expect(pageSlots(leftTargetStart.spread).at(-1)?.slotIndex).toBe(1);

    backward.events.length = 0;
    runCommand(backward.engine, {
      type: "prevSpread",
      intent: BACKWARD_LINEAR_INTENT,
    });

    const prev = getPageContentEvent(backward.events)!;
    expect
      .soft(pageSlots(prev.spread).map((slot) => slot.page.currentPage))
      .toEqual([3, 4]);
  });

  it("prevSpread from the first spread emits pageUnavailable", () => {
    const { engine, events } = createEngine();
    events.length = 0;

    runCommand(engine, {
      type: "prevSpread",
      intent: BACKWARD_LINEAR_INTENT,
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("pageUnavailable");
    expect(events[0]?.intent).toEqual(BACKWARD_LINEAR_INTENT);
  });

  it("goToPage remains leaf-based and emits containing spread", () => {
    const { engine, events } = createEngine({
      blocks: makeLongTextBlocks("long-goto"),
      spreadConfig: { columns: 3, chapterFlow: "continuous" },
    });

    const readyEvent = getReadyEvent(events)!;
    expect(readyEvent.spread.totalPages).toBeGreaterThan(2);

    events.length = 0;
    runCommand(engine, {
      type: "goToPage",
      page: 2,
      intent: SCRUBBER_JUMP_INTENT,
    });

    const pageContent = getPageContentEvent(events)!;
    expect(pageContent.intent).toEqual(SCRUBBER_JUMP_INTENT);
    expect(pageContent.spread.intent).toEqual(SCRUBBER_JUMP_INTENT);
    expect(spreadContainsLeafPage(pageContent.spread, 2)).toBe(true);
    expect(pageContent.spread.totalPages).toBe(readyEvent.spread.totalPages);
  });

  it("goToPage to a non-existent page emits pageUnavailable", () => {
    const { engine, events } = createEngine();
    events.length = 0;

    runCommand(engine, {
      type: "goToPage",
      page: 999,
      intent: SCRUBBER_JUMP_INTENT,
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("pageUnavailable");
    expect(events[0]?.intent).toEqual(SCRUBBER_JUMP_INTENT);
  });

  it("goToChapter jumps to the chapter's first leaf page in a spread", () => {
    const { engine, events } = createEngine({ totalChapters: 3 });
    addChapter(engine, 1);
    addChapter(engine, 2);
    events.length = 0;

    runCommand(engine, {
      type: "goToChapter",
      chapterIndex: 2,
      intent: CHAPTER_JUMP_INTENT,
    });
    const pageContent = getPageContentEvent(events)!;
    expect(pageContent.intent).toEqual(CHAPTER_JUMP_INTENT);
    expect(pageContent.spread.intent).toEqual(CHAPTER_JUMP_INTENT);

    const first = firstPageSlot(pageContent.spread)!;
    expect(first.page.chapterIndex).toBe(2);
    expect(first.page.currentPageInChapter).toBe(1);
  });

  it("goToChapter emits chapterUnavailable for an unloaded chapter", () => {
    const { engine, events } = createEngine({ totalChapters: 3 });
    events.length = 0;

    runCommand(engine, {
      type: "goToChapter",
      chapterIndex: 2,
      intent: CHAPTER_JUMP_INTENT,
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("chapterUnavailable");
    expect(events[0]?.intent).toEqual(CHAPTER_JUMP_INTENT);
    if (events[0]?.type === "chapterUnavailable") {
      expect(events[0].chapterIndex).toBe(2);
    }
  });

  it("goToTarget lands on a later page for inline targets inside long blocks", () => {
    const { engine, events } = createEngine({
      blocks: makeInlineTargetedLongBlocks("midpoint"),
    });

    events.length = 0;
    runCommand(engine, {
      type: "goToTarget",
      chapterIndex: 0,
      targetId: "midpoint",
      intent: INTERNAL_LINK_JUMP_INTENT,
    });

    const pageContent = getPageContentEvent(events)!;
    expect(pageContent.intent).toEqual(INTERNAL_LINK_JUMP_INTENT);
    expect(pageContent.spread.intent).toEqual(INTERNAL_LINK_JUMP_INTENT);
    expect(pageContent.spread.currentPage).toBeGreaterThan(1);
  });

  it("goToTarget works inside multi-page preformatted blocks", () => {
    const { engine, events } = createEngine({
      blocks: makePreTargetedLongBlocks("mid-pre"),
    });

    events.length = 0;
    runCommand(engine, {
      type: "goToTarget",
      chapterIndex: 0,
      targetId: "mid-pre",
      intent: INTERNAL_LINK_JUMP_INTENT,
    });

    const pageContent = getPageContentEvent(events)!;
    expect(pageContent.intent).toEqual(INTERNAL_LINK_JUMP_INTENT);
    expect(pageContent.spread.currentPage).toBeGreaterThan(1);
  });

  it("goToTarget jumps to the first page containing a block-level target", () => {
    const { engine, events } = createEngine({
      blocks: makeBlockTargetBlocks("chapter-section"),
    });

    events.length = 0;
    runCommand(engine, {
      type: "goToTarget",
      chapterIndex: 0,
      targetId: "chapter-section",
      intent: INTERNAL_LINK_JUMP_INTENT,
    });

    const pageContent = getPageContentEvent(events)!;
    expect(pageContent.intent).toEqual(INTERNAL_LINK_JUMP_INTENT);
    expect(pageContent.spread.currentPage).toBeGreaterThan(1);
    const first = firstPageSlot(pageContent.spread)!;
    const blockIds = first.page.content.map((slice) => slice.blockId);
    expect(blockIds).toContain("block-target");
  });

  it("goToTarget falls back to chapter start when the target is missing", () => {
    const { engine, events } = createEngine({
      blocks: makeInlineTargetedLongBlocks("existing-target"),
    });

    events.length = 0;
    runCommand(engine, {
      type: "goToTarget",
      chapterIndex: 0,
      targetId: "missing-target",
      intent: INTERNAL_LINK_JUMP_INTENT,
    });

    const pageContent = getPageContentEvent(events)!;
    expect(pageContent.intent).toEqual(INTERNAL_LINK_JUMP_INTENT);
    expect(pageContent.spread.currentPage).toBe(1);
  });

  it("goToTarget emits chapterUnavailable for an unloaded chapter", () => {
    const { engine, events } = createEngine({ totalChapters: 2 });
    events.length = 0;

    runCommand(engine, {
      type: "goToTarget",
      chapterIndex: 1,
      targetId: "missing",
      intent: INTERNAL_LINK_JUMP_INTENT,
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("chapterUnavailable");
    expect(events[0]?.intent).toEqual(INTERNAL_LINK_JUMP_INTENT);
    if (events[0]?.type === "chapterUnavailable") {
      expect(events[0].chapterIndex).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Spread projection behavior
// ---------------------------------------------------------------------------

describe("spread projection", () => {
  it("continuous flow packs chapter boundaries into the same spread", () => {
    const { engine, events } = createEngine({
      totalChapters: 2,
      spreadConfig: { columns: 3, chapterFlow: "continuous" },
    });
    addChapter(engine, 1);

    const ready = getReadyEvent(events)!;
    const pages = pageSlots(ready.spread);

    expect(pages).toHaveLength(2);
    expect(pages[0]?.page.chapterIndex).toBe(0);
    expect(pages[1]?.page.chapterIndex).toBe(1);
  });

  it("align-leftmost inserts chapter-boundary gaps", () => {
    const { engine, events } = createEngine({
      totalChapters: 2,
      spreadConfig: { columns: 3, chapterFlow: "align-leftmost" },
    });
    addChapter(engine, 1);

    const ready = getReadyEvent(events)!;
    const gaps = gapSlots(ready.spread);

    expect(gaps).toHaveLength(2);
    expect(gaps.every((g) => g.reason === "chapter-boundary")).toBe(true);

    events.length = 0;
    runCommand(engine, {
      type: "goToChapter",
      chapterIndex: 1,
      intent: CHAPTER_JUMP_INTENT,
    });
    const chapterSpread = getPageContentEvent(events)!.spread;
    const chapterFirst = firstPageSlot(chapterSpread)!;

    expect(chapterFirst.page.chapterIndex).toBe(1);
    expect(chapterFirst.slotIndex).toBe(0);
  });

  it("uses unloaded gaps in partial states", () => {
    const { events } = createEngine({
      totalChapters: 2,
      spreadConfig: { columns: 3, chapterFlow: "continuous" },
    });

    const partial = events.find(
      (e): e is Extract<EnginePaginationEvent, { type: "partialReady" }> =>
        e.type === "partialReady",
    )!;

    const gaps = gapSlots(partial.spread);
    expect(gaps.length).toBeGreaterThan(0);
    expect(gaps.every((g) => g.reason === "unloaded")).toBe(true);
  });

  it("keeps the visible two-page spread stable when an earlier chapter loads", () => {
    const { engine, events } = createEngine({
      totalChapters: 2,
      initialChapterIndex: 1,
      blocks: makeFixedPageBlocks(1, 3),
      spreadConfig: { columns: 2, chapterFlow: "continuous" },
    });

    const partial = getLastEventOfType(events, "partialReady")!;
    expect(
      pageSlots(partial.spread).map((slot) => [
        slot.page.chapterIndex,
        slot.page.currentPageInChapter,
      ]),
    ).toEqual([
      [1, 1],
      [1, 2],
    ]);

    events.length = 0;
    addChapter(engine, 0, makeFixedPageBlocks(0, 1));

    const ready = getLastEventOfType(events, "ready")!;
    expect(
      pageSlots(ready.spread).map((slot) => [
        slot.page.chapterIndex,
        slot.page.currentPageInChapter,
      ]),
    ).toEqual([
      [1, 1],
      [1, 2],
    ]);
  });

  it("uses end-of-book gaps for the final partial spread", () => {
    const { events } = createEngine({
      totalChapters: 1,
      spreadConfig: { columns: 3, chapterFlow: "continuous" },
    });

    const ready = getReadyEvent(events)!;
    const gaps = gapSlots(ready.spread);

    expect(gaps).toHaveLength(2);
    expect(gaps.every((g) => g.reason === "end-of-book")).toBe(true);
  });

  it("keeps leaf counters while adding spread counters", () => {
    const { events } = createEngine({
      blocks: makeLongTextBlocks("long-spreads"),
      spreadConfig: { columns: 3, chapterFlow: "continuous" },
    });

    const ready = getReadyEvent(events)!;
    expect(ready.spread.currentPage).toBe(1);
    expect(ready.spread.totalPages).toBeGreaterThan(0);
    expect(ready.spread.currentSpread).toBe(1);
    expect(ready.spread.totalSpreads).toBe(
      Math.ceil(ready.spread.totalPages / 3),
    );
  });

  it("updateSpreadConfig re-emits immediately without relayout", () => {
    const { engine, events } = createEngine({
      blocks: makeLongTextBlocks("spread-update"),
      spreadConfig: { columns: 1, chapterFlow: "continuous" },
    });

    expect(getReadyEvent(events)).toBeDefined();
    events.length = 0;

    runCommand(engine, {
      type: "updateSpreadConfig",
      spreadConfig: { columns: 3, chapterFlow: "continuous" },
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("pageContent");
    expect(events[0]?.intent).toEqual(REPLACE_INTENT);

    const pageContent = getPageContentEvent(events)!;
    expect(pageContent.spread.intent).toEqual(REPLACE_INTENT);
    expect(pageContent.spread.slots.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 4. Anchor preservation across relayout
// ---------------------------------------------------------------------------

describe("anchor preservation across relayout", () => {
  it("keeps relayout anchored to the visible spread after an unresolved page request", async () => {
    const { engine, events } = createEngine({ totalChapters: 2 });

    events.length = 0;
    runCommand(engine, {
      type: "goToPage",
      page: 2,
      intent: SCRUBBER_JUMP_INTENT,
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("pageUnavailable");

    events.length = 0;
    runCommand(engine, {
      type: "updatePaginationConfig",
      paginationConfig: {
        ...BASE_PAGINATION_CONFIG,
        viewport: { width: 700, height: 900 },
      },
    });

    const partialReadyEvent = getLastEventOfType(events, "partialReady");
    const readyEvent = getReadyEvent(events);

    expect(partialReadyEvent?.spread.currentPage).toBe(1);
    expect(partialReadyEvent?.spread.chapterIndexStart).toBe(0);
    expect(readyEvent?.spread.currentPage).toBe(1);
    expect(readyEvent?.spread.chapterIndexStart).toBe(0);
  });

  it("falls back to the existing anchor when goToChapter targets an unloaded chapter", async () => {
    const { engine, events } = createEngine({ totalChapters: 5 });
    addChapter(engine, 1);
    addChapter(engine, 4);

    runCommand(engine, {
      type: "goToChapter",
      chapterIndex: 1,
      intent: CHAPTER_JUMP_INTENT,
    });
    events.length = 0;

    runCommand(engine, {
      type: "goToChapter",
      chapterIndex: 3,
      intent: CHAPTER_JUMP_INTENT,
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("chapterUnavailable");

    events.length = 0;
    runCommand(engine, {
      type: "updatePaginationConfig",
      paginationConfig: {
        ...BASE_PAGINATION_CONFIG,
        viewport: { width: 680, height: 820 },
      },
    });

    expect(getChapterOrder(events)).toEqual([1, 0, 4]);
    expect(countEvents(events, "partialReady")).toBe(1);
    expect(countEvents(events, "ready")).toBe(1);
  });

  it("keeps block-anchor fallback behavior when anchor has no text offset", () => {
    const { events } = createEngine({
      blocks: makeLongTextBlocks("text-fallback"),
      initialAnchor: {
        type: "block",
        chapterIndex: 0,
        blockId: "text-fallback",
      },
    });

    const readyEvent = getReadyEvent(events);
    expect(readyEvent).toBeDefined();
    expect(readyEvent?.spread.currentPage).toBe(1);
  });

  it("anchor survives an updatePaginationConfig relayout", async () => {
    const { engine, events } = createEngine({
      blocks: makeLongTextBlocks("anchor-stable"),
      spreadConfig: { columns: 3, chapterFlow: "continuous" },
    });

    runCommand(engine, {
      type: "nextSpread",
      intent: FORWARD_LINEAR_INTENT,
    });
    const pc = getPageContentEvent(events)!;
    expect(pc.spread.currentSpread).toBe(2);

    events.length = 0;

    runCommand(engine, {
      type: "updatePaginationConfig",
      paginationConfig: {
        ...BASE_PAGINATION_CONFIG,
        viewport: { width: 520, height: 900 },
      },
    });

    const readyEvent = getReadyEvent(events)!;
    expect(readyEvent.intent).toEqual(REPLACE_INTENT);
    expect(readyEvent.spread.intent).toEqual(REPLACE_INTENT);
    expect(readyEvent.spread.currentPage).toBeGreaterThan(1);
    expect(readyEvent.spread.currentSpread).toBeGreaterThan(1);
  });

  it("rapid pagination config changes keep position stable", async () => {
    const { engine, events } = createEngine({
      blocks: makeLongTextBlocks("anchor-rapid"),
    });

    runCommand(engine, {
      type: "nextSpread",
      intent: FORWARD_LINEAR_INTENT,
    });
    events.length = 0;

    runCommand(engine, {
      type: "updatePaginationConfig",
      paginationConfig: {
        ...BASE_PAGINATION_CONFIG,
        viewport: { width: 550, height: 880 },
      },
    });
    runCommand(engine, {
      type: "updatePaginationConfig",
      paginationConfig: {
        ...BASE_PAGINATION_CONFIG,
        viewport: { width: 600, height: 860 },
      },
    });

    const readyEvents = events.filter(
      (e): e is Extract<EnginePaginationEvent, { type: "ready" }> =>
        e.type === "ready",
    );
    expect(readyEvents.length).toBeGreaterThanOrEqual(1);
    expect(readyEvents.at(-1)!.intent).toEqual(REPLACE_INTENT);
    expect(readyEvents.at(-1)!.spread.intent).toEqual(REPLACE_INTENT);
    expect(readyEvents.at(-1)!.spread.currentPage).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// 5. Middle-out relayout order
// ---------------------------------------------------------------------------

describe("middle-out relayout order", () => {
  it("relayout starts from the current anchor's chapter", async () => {
    const { engine, events } = createEngine({ totalChapters: 5 });
    for (let i = 1; i < 5; i++) addChapter(engine, i);

    runCommand(engine, {
      type: "goToChapter",
      chapterIndex: 2,
      intent: CHAPTER_JUMP_INTENT,
    });
    events.length = 0;

    runCommand(engine, {
      type: "updatePaginationConfig",
      paginationConfig: {
        ...BASE_PAGINATION_CONFIG,
        viewport: { width: 700, height: 900 },
      },
    });

    expect(getChapterOrder(events)).toEqual([2, 3, 1, 4, 0]);
  });

  it("emits one partialReady and one ready per relayout", async () => {
    const { engine, events } = createEngine({ totalChapters: 5 });
    for (let i = 1; i < 5; i++) addChapter(engine, i);
    events.length = 0;

    runCommand(engine, {
      type: "updatePaginationConfig",
      paginationConfig: {
        ...BASE_PAGINATION_CONFIG,
        viewport: { width: 700, height: 900 },
      },
    });

    expect(countEvents(events, "partialReady")).toBe(1);
    expect(countEvents(events, "ready")).toBe(1);
    for (const event of events) {
      if (
        event.type !== "partialReady" &&
        event.type !== "progress" &&
        event.type !== "ready"
      ) {
        continue;
      }
      expect(event.intent).toEqual(REPLACE_INTENT);
    }
    expect(lastEvent(events)?.type).toBe("ready");
  });
});

// ---------------------------------------------------------------------------
// 6. Stepwise relayout jobs
// ---------------------------------------------------------------------------

describe("stepwise relayout jobs", () => {
  it("relayouts one chapter per step and emits ready when finished", () => {
    const { engine, events } = createEngine({ totalChapters: 5 });
    for (let i = 1; i < 5; i++) addChapter(engine, i);

    runCommand(engine, {
      type: "goToChapter",
      chapterIndex: 2,
      intent: CHAPTER_JUMP_INTENT,
    });
    events.length = 0;

    const work = engine.createWork({
      type: "updatePaginationConfig",
      paginationConfig: {
        ...BASE_PAGINATION_CONFIG,
        viewport: { width: 700, height: 900 },
      },
    });

    work.next();
    expect(getChapterOrder(events)).toEqual([2]);
    expect(countEvents(events, "partialReady")).toBe(1);
    expect(countEvents(events, "ready")).toBe(0);

    work.next();
    expect(getChapterOrder(events)).toEqual([2, 3]);
    expect(countEvents(events, "ready")).toBe(0);

    runWork(work);
    expect(getChapterOrder(events)).toEqual([2, 3, 1, 4, 0]);
    expect(countEvents(events, "ready")).toBe(1);
    expect(work.next().done).toBe(true);
    expect(lastEvent(events)?.type).toBe("ready");
  });

  it("builds a deferred relayout plan when the job first steps", () => {
    const { engine, events } = createEngine({ totalChapters: 5 });
    for (let i = 1; i < 5; i++) addChapter(engine, i);

    const work = engine.createWork({
      type: "updatePaginationConfig",
      paginationConfig: {
        ...BASE_PAGINATION_CONFIG,
        viewport: { width: 700, height: 900 },
      },
    });

    runCommand(engine, {
      type: "goToChapter",
      chapterIndex: 3,
      intent: CHAPTER_JUMP_INTENT,
    });
    events.length = 0;

    runWork(work);

    expect(getChapterOrder(events)).toEqual([3, 4, 2, 1, 0]);
    expect(countEvents(events, "ready")).toBe(1);
  });

  it("re-prepares all loaded chapters after a preempted font relayout", () => {
    const totalChapters = 3;
    const fontOnlyConfig: PaginationConfig = {
      ...BASE_PAGINATION_CONFIG,
      fontConfig: { ...BASE_FONT_CONFIG, baseSizePx: 34 },
      layoutTheme: { ...BASE_LAYOUT_THEME, baseFontSizePx: 34 },
    };
    const finalConfig: PaginationConfig = {
      ...fontOnlyConfig,
      viewport: { width: 430, height: 860 },
    };

    const { engine, events } = createEngine({
      totalChapters,
      blocks: makeLongTextBlocks("bug-repro-0"),
    });
    addChapter(engine, 1, makeLongTextBlocks("bug-repro-1"));
    addChapter(engine, 2, makeLongTextBlocks("bug-repro-2"));

    events.length = 0;

    const preemptedWork = engine.createWork({
      type: "updatePaginationConfig",
      paginationConfig: fontOnlyConfig,
    });
    preemptedWork.next();

    expect(countEvents(events, "partialReady")).toBe(1);
    expect(countEvents(events, "ready")).toBe(0);

    events.length = 0;
    runCommand(engine, {
      type: "updatePaginationConfig",
      paginationConfig: finalConfig,
    });
    const interruptedReady = getReadyEvent(events);
    expect(interruptedReady).toBeDefined();

    const control = createEngine({
      totalChapters,
      blocks: makeLongTextBlocks("ctrl-0"),
    });
    addChapter(control.engine, 1, makeLongTextBlocks("ctrl-1"));
    addChapter(control.engine, 2, makeLongTextBlocks("ctrl-2"));
    control.events.length = 0;

    runCommand(control.engine, {
      type: "updatePaginationConfig",
      paginationConfig: finalConfig,
    });
    const cleanReady = getReadyEvent(control.events);
    expect(cleanReady).toBeDefined();

    const getPreparedBodyFontsByChapter = (target: PaginationEngine) => {
      const preparedByChapter = (
        target as unknown as {
          preparedByChapter: Array<Array<{
            type: string;
            items?: Array<{ kind: string; font?: string }>;
          }> | null>;
        }
      ).preparedByChapter;

      return preparedByChapter.map((prepared) => {
        const textBlock = prepared?.find((block) => block.type === "text");
        const textItem = textBlock?.items?.find((item) => item.kind === "text");
        return textItem?.font ?? "";
      });
    };

    const interruptedFonts = getPreparedBodyFontsByChapter(engine);
    const cleanFonts = getPreparedBodyFontsByChapter(control.engine);

    expect(interruptedFonts.every((font) => font.includes("34px"))).toBe(true);
    expect(cleanFonts.every((font) => font.includes("34px"))).toBe(true);
    expect(interruptedFonts).toEqual(cleanFonts);
  });
});

// ---------------------------------------------------------------------------
// 7. updatePaginationConfig no-op when unchanged
// ---------------------------------------------------------------------------

describe("updatePaginationConfig no-op", () => {
  it("emits ready when config is identical", async () => {
    const { engine, events } = createEngine({ totalChapters: 2 });
    addChapter(engine, 1);
    events.length = 0;

    runCommand(engine, {
      type: "updatePaginationConfig",
      paginationConfig: BASE_PAGINATION_CONFIG,
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("ready");
  });

  it("font/layout changes still produce a ready event", async () => {
    const { engine, events } = createEngine({ totalChapters: 2 });
    addChapter(engine, 1);

    events.length = 0;
    runCommand(engine, {
      type: "updatePaginationConfig",
      paginationConfig: {
        ...BASE_PAGINATION_CONFIG,
        fontConfig: { ...BASE_FONT_CONFIG, baseSizePx: 20 },
        layoutTheme: { ...BASE_LAYOUT_THEME, baseFontSizePx: 20 },
      },
    });

    expect(countEvents(events, "ready")).toBe(1);
  });
});

describe("highlight opening location", () => {
  it("emits its first spread at the highlighted run", () => {
    const blocks = makeLongTextBlocks("before-highlight");
    blocks.push({
      type: "text",
      id: "highlight-block",
      tag: "p",
      runs: [
        {
          kind: "text",
          text: "Target highlight.",
          bold: false,
          italic: false,
          isCode: false,
          highlightMarks: [{ id: "opening-highlight" }],
        },
      ],
    });
    const events: EnginePaginationEvent[] = [];
    const engine = new PaginationEngine((event) => events.push(event));
    runCommand(engine, {
      type: "init",
      totalChapters: 2,
      initialChapterIndex: 1,
      initialHighlightId: "opening-highlight",
      paginationConfig: BASE_PAGINATION_CONFIG,
      spreadConfig: BASE_SPREAD_CONFIG,
      firstChapterBlocks: blocks,
      intent: { kind: "jump", source: "highlight" },
    });
    const first = getLastEventOfType(events, "partialReady");
    expect(first?.spread.chapterIndexStart).toBe(1);
    expect(
      first?.spread.slots.flatMap((slot) =>
        slot.kind === "page"
          ? slot.page.content.map((slice) => slice.blockId)
          : [],
      ),
    ).toContain("highlight-block");
    expect(first?.spread.currentPage).toBeGreaterThan(1);
    addChapter(engine, 0);
    expect(
      getReadyEvent(events)?.spread.slots.flatMap((slot) =>
        slot.kind === "page"
          ? slot.page.content.map((slice) => slice.blockId)
          : [],
      ),
    ).toContain("highlight-block");
    runCommand(engine, {
      type: "goToChapter",
      chapterIndex: 0,
      intent: CHAPTER_JUMP_INTENT,
    });
    expect(getPageContentEvent(events)?.spread.chapterIndexStart).toBe(0);
    events.length = 0;
    runCommand(engine, {
      type: "goToTarget",
      chapterIndex: 1,
      targetId: "opening-highlight",
      targetKind: "highlight",
      intent: { kind: "jump", source: "highlight" },
    });
    const jumped = getPageContentEvent(events)!;
    expect(jumped.spread.intent).toEqual({ kind: "jump", source: "highlight" });
    expect(
      jumped.spread.slots.flatMap((slot) =>
        slot.kind === "page"
          ? slot.page.content.map((slice) => slice.blockId)
          : [],
      ),
    ).toContain("highlight-block");
  });
});

it("locates a batch of notebook anchors without navigating the reader", () => {
  const { engine, events } = createEngine();
  events.length = 0;
  runCommand(engine, {
    type: "locateAnchors",
    scope: "default",
    requestId: 7,
    anchors: [
      {
        id: "note",
        anchor: { type: "block", chapterIndex: 0, blockId: "spacer-0" },
      },
      {
        id: "missing",
        anchor: { type: "block", chapterIndex: 4, blockId: "missing" },
      },
    ],
  });
  expect(events).toEqual([
    {
      type: "anchorsLocated",
      scope: "default",
      requestId: 7,
      pages: { note: 1, missing: null },
    },
  ]);
});

describe("content anchor return navigation", () => {
  it("returns to the same text anchor after pagination changes", () => {
    const { engine, events } = createEngine({
      blocks: makeLongTextBlocks("return-text"),
    });
    runCommand(engine, {
      type: "goToPage",
      page: 4,
      intent: SCRUBBER_JUMP_INTENT,
    });
    const arrival = lastEvent(events);
    if (arrival?.type !== "pageContent")
      throw new Error("Expected page content");
    expect(arrival.anchor.type).toBe("text");
    const anchor = arrival.anchor;
    runCommand(engine, {
      type: "goToPage",
      page: 1,
      intent: SCRUBBER_JUMP_INTENT,
    });
    runCommand(engine, {
      type: "updatePaginationConfig",
      paginationConfig: {
        ...BASE_PAGINATION_CONFIG,
        viewport: { width: 310, height: 430 },
      },
    });
    runCommand(engine, {
      type: "goToAnchor",
      anchor,
      intent: { kind: "history", targetIndex: 1 },
    });
    const returned = lastEvent(events);
    if (returned?.type !== "pageContent")
      throw new Error("Expected returned content");
    expect(returned.anchor).toEqual(anchor);
    expect(returned.spread.currentPage).not.toBe(arrival.spread.currentPage);
    expect(
      returned.spread.slots.some(
        (slot) =>
          slot.kind === "page" &&
          slot.page.content.some((slice) => slice.blockId === anchor.blockId),
      ),
    ).toBe(true);
  });

  it("rejects missing anchors without moving the reader", () => {
    const { engine, events } = createEngine({
      blocks: makeFixedPageBlocks(0, 5),
    });
    runCommand(engine, {
      type: "goToPage",
      page: 3,
      intent: SCRUBBER_JUMP_INTENT,
    });
    runCommand(engine, {
      type: "goToAnchor",
      anchor: { type: "block", chapterIndex: 0, blockId: "missing" },
      intent: { kind: "history", targetIndex: 0 },
    });
    expect(lastEvent(events)?.type).toBe("pageUnavailable");
    runCommand(engine, { type: "nextSpread", intent: FORWARD_LINEAR_INTENT });
    const next = lastEvent(events);
    if (next?.type !== "pageContent") throw new Error("Expected next page");
    expect(next.spread.currentPage).toBe(4);
  });
});

it("restores an anchor in the first slot while preceding chapters arrive", () => {
  const { engine, events } = createEngine({
    totalChapters: 2,
    initialChapterIndex: 1,
    blocks: makeFixedPageBlocks(1, 6),
    spreadConfig: { columns: 2, chapterFlow: "continuous" },
    initialAnchor: { type: "block", chapterIndex: 1, blockId: "spacer-1-3" },
  });
  addChapter(engine, 0, makeFixedPageBlocks(0, 3));
  const ready = getReadyEvent(events);
  expect(ready?.spread.currentPage).toBe(7);
  expect(ready?.spread.slots[0]).toMatchObject({
    kind: "page",
    page: { currentPage: 7 },
  });
});
