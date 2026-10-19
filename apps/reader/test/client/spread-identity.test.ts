import { SpreadStage } from "@/features/reader/SpreadStage";
import { getSpreadContentKey } from "@/features/reader/spread-identity";
import type {
  PaginationConfig,
  ResolvedSpread,
  SpreadConfig,
} from "@/lib/pagination-v2";
import { act, createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

const PAGINATION_CONFIG: PaginationConfig = {
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
  viewport: { width: 600, height: 800 },
};

const SPREAD_CONFIG: SpreadConfig = {
  columns: 1,
  chapterFlow: "continuous",
};

/** A one-page spread showing `text`, numbered `currentSpread` in the book. */
function makeSpread(
  currentSpread: number,
  text: string,
  blockId = "text-4",
): ResolvedSpread {
  return {
    slots: [
      {
        kind: "page",
        slotIndex: 0,
        page: {
          currentPage: currentSpread,
          totalPages: 100,
          currentPageInChapter: 1,
          totalPagesInChapter: 3,
          chapterIndex: 11,
          content: [
            {
              type: "text",
              blockId,
              tag: "p",
              lineHeight: 24,
              textAlign: "left",
              renderMode: "native",
              lines: [
                {
                  fragments: [
                    {
                      kind: "text",
                      text,
                      font: '16px "Inter"',
                      leadingGap: 0,
                      isCode: false,
                    },
                  ],
                  startOffset: {
                    itemIndex: 0,
                    segmentIndex: 0,
                    graphemeIndex: 0,
                  },
                  isLastInBlock: true,
                },
              ],
            },
          ],
        },
      },
    ],
    intent: { kind: "replace" },
    currentPage: currentSpread,
    totalPages: 100,
    currentSpread,
    totalSpreads: 100,
    chapterIndexStart: 11,
    chapterIndexEnd: 11,
  };
}

function renderStage(spread: ResolvedSpread) {
  return createElement(SpreadStage, {
    spread,
    spreadConfig: SPREAD_CONFIG,
    columnSpacingPx: 0,
    paginationConfig: PAGINATION_CONFIG,
    disableAnimations: true,
    paddingTopPx: 0,
    paddingBottomPx: 0,
    paddingLeftPx: 0,
    paddingRightPx: 0,
  });
}

describe("spread identity", () => {
  it("names a spread by what it shows, not by its number", () => {
    expect(getSpreadContentKey(makeSpread(1, "The Lobster Quadrille"))).toBe(
      getSpreadContentKey(makeSpread(52, "The Lobster Quadrille")),
    );
    expect(
      getSpreadContentKey(makeSpread(52, "The Lobster Quadrille")),
    ).not.toBe(
      getSpreadContentKey(makeSpread(53, "“Oh, you sing,”", "text-9")),
    );
  });

  it("keeps the page and a selection on it when the spread is renumbered", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    flushSync(() =>
      root.render(renderStage(makeSpread(1, "The Lobster Quadrille"))),
    );
    const paragraph = container.querySelector("[data-reader-block-id]")!;
    const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
    let text: Node | null = null;
    while (walker.nextNode())
      if (walker.currentNode.textContent?.includes("Lobster"))
        text = walker.currentNode;
    expect(text?.textContent).toBe("The Lobster Quadrille");
    const range = document.createRange();
    range.setStart(text!, 4);
    range.setEnd(text!, 11);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);

    // Laying out the earlier chapters renumbers the open spread.
    flushSync(() =>
      root.render(renderStage(makeSpread(52, "The Lobster Quadrille"))),
    );
    expect(container.querySelector("[data-reader-block-id]")).toBe(paragraph);
    expect(
      container
        .querySelector("[data-reader-current-page]")
        ?.getAttribute("data-reader-current-page"),
    ).toBe("52");
    expect(getSelection()!.toString()).toBe("Lobster");

    getSelection()!.removeAllRanges();
    act(() => root.unmount());
    container.remove();
  });
});
