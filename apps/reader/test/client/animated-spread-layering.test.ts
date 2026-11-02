import { AnimatedSpread } from "@/features/reader/AnimatedSpread";
import type {
  PaginationConfig,
  ResolvedSpread,
  SpreadConfig,
  SpreadIntent,
} from "@/lib/pagination-v2";
import { AnimatePresence } from "motion/react";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
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

function makeSpread(
  currentSpread: number,
  intent: SpreadIntent,
): ResolvedSpread {
  return {
    slots: [
      {
        kind: "page",
        slotIndex: 0,
        page: {
          currentPage: currentSpread,
          totalPages: 3,
          currentPageInChapter: currentSpread,
          totalPagesInChapter: 3,
          chapterIndex: 0,
          content: [],
        },
      },
    ],
    intent,
    currentPage: currentSpread,
    totalPages: 3,
    currentSpread,
    totalSpreads: 3,
    chapterIndexStart: 0,
    chapterIndexEnd: 0,
  };
}

function renderSpread(spread: ResolvedSpread, disableAnimations: boolean) {
  const direction =
    spread.intent.kind === "linear" ? spread.intent.direction : "instant";

  return createElement(
    AnimatePresence,
    { custom: direction, initial: false, mode: "sync" },
    createElement(AnimatedSpread, {
      key: spread.currentSpread,
      spread,
      spreadConfig: SPREAD_CONFIG,
      columnSpacingPx: 0,
      paginationConfig: PAGINATION_CONFIG,
      disableAnimations,
      paddingTopPx: 0,
      paddingBottomPx: 0,
      paddingLeftPx: 0,
      paddingRightPx: 0,
    }),
  );
}

function getAnimatedLayer(container: HTMLElement, page: number): HTMLElement {
  const pageSlot = container.querySelector(
    `[data-reader-current-page='${page}']`,
  );
  const layer = pageSlot?.closest(".absolute");
  if (!(layer instanceof HTMLElement)) {
    throw new Error(`Missing animated layer for page ${page}`);
  }
  return layer;
}

describe("AnimatedSpread swipe handoff layering", () => {
  it("keeps incoming A above retained B during a disabled backward transition", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    flushSync(() => {
      root.render(renderSpread(makeSpread(2, { kind: "replace" }), true));
    });
    flushSync(() => {
      root.render(
        renderSpread(
          makeSpread(1, { kind: "linear", direction: "backward" }),
          true,
        ),
      );
    });

    const incomingA = getAnimatedLayer(container, 1);
    const retainedB = getAnimatedLayer(container, 2);
    expect(Number(incomingA.style.zIndex)).toBeGreaterThan(
      Number(retainedB.style.zIndex),
    );

    act(() => root.unmount());
    container.remove();
  });

  it("fades incoming A in over the outgoing B on an animated tap transition", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    flushSync(() => {
      root.render(renderSpread(makeSpread(2, { kind: "replace" }), false));
    });
    flushSync(() => {
      root.render(
        renderSpread(
          makeSpread(1, { kind: "linear", direction: "backward" }),
          false,
        ),
      );
    });

    const incomingA = getAnimatedLayer(container, 1);
    const outgoingB = getAnimatedLayer(container, 2);
    expect(Number(incomingA.style.zIndex)).toBeGreaterThan(
      Number(outgoingB.style.zIndex),
    );

    act(() => root.unmount());
    container.remove();
  });
});
